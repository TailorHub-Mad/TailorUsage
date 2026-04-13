use bytes::Bytes;
use http_body_util::Full;
use hyper::{Request, Response};
use reqwest::header::{HeaderValue, AUTHORIZATION};
use std::net::SocketAddr;
use std::time::Instant;

use crate::proxy::logger;
use crate::proxy::sse_parser;
use crate::proxy::types::{LogEntry, Provider, StreamAccumulator};

fn sanitize_anthropic_response_summary(value: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "top_level_keys": value
            .as_object()
            .map(|object| object.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default(),
        "type": value.get("type").and_then(|kind| kind.as_str()),
        "model": value.get("model").and_then(|model| model.as_str()),
        "usage": value.get("usage").map(|usage| serde_json::json!({
            "input_tokens": usage.get("input_tokens").and_then(|v| v.as_u64()),
            "output_tokens": usage.get("output_tokens").and_then(|v| v.as_u64()),
            "cache_creation_input_tokens": usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64()),
            "cache_read_input_tokens": usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64()),
        })),
        "stop_reason": value.get("stop_reason").and_then(|stop_reason| stop_reason.as_str()),
    })
}

fn maybe_write_anthropic_token_diagnostics(
    provider: Provider,
    endpoint: &str,
    status: u16,
    is_stream: bool,
    req_model: &str,
    acc: &StreamAccumulator,
    resp_bytes: &Bytes,
) {
    if provider != Provider::Anthropic || status >= 300 {
        return;
    }

    let input_tokens = acc.input_tokens.unwrap_or(0);
    let output_tokens = acc.output_tokens.unwrap_or(0);
    if input_tokens > 0 || output_tokens > 0 {
        return;
    }

    let payload = if is_stream {
        let text = String::from_utf8_lossy(resp_bytes);
        serde_json::json!({
            "response_kind": "anthropic_sse",
            "sse_summary": sse_parser::summarize_anthropic_sse(&text),
        })
    } else if let Ok(value) = serde_json::from_slice::<serde_json::Value>(resp_bytes) {
        serde_json::json!({
            "response_kind": "anthropic_json",
            "response_summary": sanitize_anthropic_response_summary(&value),
        })
    } else {
        serde_json::json!({
            "response_kind": "anthropic_non_json",
            "raw_preview": String::from_utf8_lossy(resp_bytes)
                .chars()
                .take(240)
                .collect::<String>(),
        })
    };

    logger::write_anthropic_token_diagnostics(&serde_json::json!({
        "captured_at": chrono::Utc::now().to_rfc3339(),
        "endpoint": endpoint,
        "request_model": req_model,
        "stream": is_stream,
        "status": status,
        "logged_input_tokens": input_tokens,
        "logged_output_tokens": output_tokens,
        "payload": payload,
    }));
}

fn meaningful_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && !value.eq_ignore_ascii_case("unknown")
                && !value.eq_ignore_ascii_case("null")
                && !value.eq_ignore_ascii_case("undefined")
        })
        .map(str::to_string)
}

fn anthropic_oauth_bearer_from_x_api_key(
    provider: Provider,
    headers: &hyper::HeaderMap,
) -> Option<String> {
    if provider != Provider::Anthropic {
        return None;
    }

    let token = headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)?;

    // OpenCode sends Anthropic OAuth access tokens through the apiKey field when a
    // custom base URL is configured. Anthropic expects those tokens as bearer auth,
    // not as x-api-key headers.
    if token.starts_with("sk-ant-oat") {
        Some(token.to_string())
    } else {
        None
    }
}

fn string_at_path(value: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut current = value;

    for key in path {
        current = current.get(*key)?;
    }

    meaningful_string(current.as_str())
}

fn extract_openai_model(value: &serde_json::Value) -> Option<String> {
    [
        &["model"][..],
        &["response", "model"],
        &["response", "response", "model"],
        &["response", "body", "model"],
        &["data", "model"],
        &["data", "response", "model"],
        &["request", "model"],
        &["request", "body", "model"],
    ]
    .iter()
    .find_map(|path| string_at_path(value, path))
}

fn normalize_upstream_path(provider: Provider, uri: &hyper::Uri) -> String {
    let path_and_query = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or_else(|| uri.path());

    match provider {
        Provider::Anthropic => path_and_query.to_string(),
        Provider::Openai => {
            if path_and_query == "/v1" || path_and_query.starts_with("/v1/") {
                path_and_query.to_string()
            } else if let Some((path, query)) = path_and_query.split_once('?') {
                format!("/v1{}?{}", path, query)
            } else {
                format!("/v1{}", path_and_query)
            }
        }
    }
}

fn extract_openai_response_fields(v: &serde_json::Value, acc: &mut StreamAccumulator) {
    acc.model = extract_openai_model(v);

    if let Some(usage) = v.get("usage") {
        acc.input_tokens = usage
            .get("prompt_tokens")
            .or_else(|| usage.get("input_tokens"))
            .and_then(|t| t.as_u64());
        acc.output_tokens = usage
            .get("completion_tokens")
            .or_else(|| usage.get("output_tokens"))
            .and_then(|t| t.as_u64());
    }

    if acc.input_tokens.is_none() || acc.output_tokens.is_none() {
        if let Some(usage) = v.get("response").and_then(|r| r.get("usage")) {
            if acc.input_tokens.is_none() {
                acc.input_tokens = usage.get("input_tokens").and_then(|t| t.as_u64());
            }
            if acc.output_tokens.is_none() {
                acc.output_tokens = usage.get("output_tokens").and_then(|t| t.as_u64());
            }
        }
    }

    acc.stop_reason = v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|first| first.get("finish_reason"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            v.get("response")
                .and_then(|r| r.get("status"))
                .and_then(|s| s.as_str())
                .map(|s| s.to_string())
        });
}

fn extract_error_message(resp_bytes: &Bytes) -> Option<String> {
    let text = String::from_utf8_lossy(resp_bytes).trim().to_string();
    if text.is_empty() {
        return None;
    }

    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(resp_bytes) {
        if let Some(message) = v
            .get("error")
            .and_then(|error| error.get("message").or_else(|| error.get("error")))
            .and_then(|value| value.as_str())
        {
            return Some(message.trim().chars().take(240).collect());
        }

        if let Some(message) = v.get("error").and_then(|value| value.as_str()) {
            return Some(message.trim().chars().take(240).collect());
        }

        if let Some(message) = v.get("message").and_then(|value| value.as_str()) {
            return Some(message.trim().chars().take(240).collect());
        }
    }

    Some(text.chars().take(240).collect())
}

/// Headers that must NOT be logged (but ARE forwarded to upstream).
#[allow(dead_code)]
const SENSITIVE_HEADERS: &[&str] = &["authorization", "x-api-key", "cookie"];

/// Forward a request to the real upstream API, tap the response for logging.
pub async fn forward(
    provider: Provider,
    local_addr: SocketAddr,
    peer_addr: SocketAddr,
    req: Request<hyper::body::Incoming>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let start = Instant::now();
    let method = req.method().clone();
    let raw_uri_path = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    let upstream_path = normalize_upstream_path(provider, req.uri());

    // Collect headers for upstream (keep sensitive ones for the real request)
    let mut upstream_headers = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers() {
        // Skip host — reqwest sets the correct Host based on the upstream URL.
        // Forwarding the client's "127.0.0.1:8788" host causes 403s on real APIs.
        if name.as_str().eq_ignore_ascii_case("host") {
            continue;
        }
        // Skip Accept-Encoding — reqwest does not have compression features enabled,
        // so forwarding this header causes Anthropic/OpenAI to respond with compressed
        // bytes that we cannot decompress. The raw bytes are then unparseable by the
        // SSE token extractor, resulting in all token counts being logged as 0.
        // Without this header the upstream responds with plain-text SSE that we can parse.
        if name.as_str().eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        if let Ok(n) = reqwest::header::HeaderName::from_bytes(name.as_str().as_bytes()) {
            if let Ok(v) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                upstream_headers.insert(n, v);
            }
        }
    }

    if let Some(token) = anthropic_oauth_bearer_from_x_api_key(provider, req.headers()) {
        upstream_headers.remove("x-api-key");

        let auth_value = format!("Bearer {}", token);
        if let Ok(value) = HeaderValue::from_str(&auth_value) {
            upstream_headers.insert(AUTHORIZATION, value);
        }
    }

    if provider == Provider::Openai {
        if let Some(api_key) = logger::read_openai_api_key() {
            let auth_value = format!("Bearer {}", api_key);
            if let Ok(value) = HeaderValue::from_str(&auth_value) {
                upstream_headers.insert(AUTHORIZATION, value);
            }
        }
    }

    // Buffer request body
    let body_bytes = match http_body_util::BodyExt::collect(req.into_body()).await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return Ok(error_response(
                502,
                &format!("Failed to read request body: {}", e),
            ));
        }
    };

    // Parse request body for model and stream flag
    let body_json: Option<serde_json::Value> = serde_json::from_slice(&body_bytes).ok();
    let is_stream = body_json
        .as_ref()
        .and_then(|j| j.get("stream"))
        .and_then(|s| s.as_bool())
        .unwrap_or(false);
    let req_model = body_json
        .as_ref()
        .and_then(extract_openai_model)
        .unwrap_or_default();

    // For OpenAI streaming requests, inject stream_options to get usage in final chunk
    let send_body = if provider == Provider::Openai && is_stream {
        if let Some(mut json) = body_json.clone() {
            json.as_object_mut().map(|obj| {
                obj.insert(
                    "stream_options".to_string(),
                    serde_json::json!({ "include_usage": true }),
                );
            });
            Bytes::from(serde_json::to_vec(&json).unwrap_or_else(|_| body_bytes.to_vec()))
        } else {
            body_bytes.clone()
        }
    } else {
        body_bytes.clone()
    };

    // Build upstream URL
    let upstream_url = format!("{}{}", provider.upstream_host(), upstream_path);

    // Forward via reqwest
    let client = reqwest::Client::new();
    let upstream_resp = match client
        .request(method, &upstream_url)
        .headers(upstream_headers)
        .body(send_body.to_vec())
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(error_response(502, &format!("Upstream error: {}", e)));
        }
    };

    let status = upstream_resp.status().as_u16();
    let resp_headers = upstream_resp.headers().clone();

    // Read full response body (both streaming and non-streaming)
    let resp_bytes = match upstream_resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return Ok(error_response(
                502,
                &format!("Failed to read upstream response: {}", e),
            ));
        }
    };

    let latency_ms = start.elapsed().as_millis() as u64;
    let error_message = if status >= 400 {
        extract_error_message(&resp_bytes)
    } else {
        None
    };

    // Parse response for token counts
    let mut acc = StreamAccumulator::default();

    if is_stream {
        let text = String::from_utf8_lossy(&resp_bytes);
        sse_parser::parse_sse_buffer(&text, provider, &mut acc);
    } else if status < 300 {
        // Non-streaming: parse JSON response directly
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&resp_bytes) {
            match provider {
                Provider::Anthropic => {
                    acc.model = v
                        .get("model")
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string());
                    if let Some(usage) = v.get("usage") {
                        let input = usage
                            .get("input_tokens")
                            .and_then(|t| t.as_u64())
                            .unwrap_or(0);
                        let cache_creation = usage
                            .get("cache_creation_input_tokens")
                            .and_then(|t| t.as_u64())
                            .unwrap_or(0);
                        let cache_read = usage
                            .get("cache_read_input_tokens")
                            .and_then(|t| t.as_u64())
                            .unwrap_or(0);
                        acc.input_tokens = Some(input + cache_creation + cache_read);
                        acc.output_tokens = usage.get("output_tokens").and_then(|t| t.as_u64());
                    }
                    acc.stop_reason = v
                        .get("stop_reason")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                }
                Provider::Openai => {
                    extract_openai_response_fields(&v, &mut acc);
                }
            }
        }
    }

    maybe_write_anthropic_token_diagnostics(
        provider,
        &raw_uri_path,
        status,
        is_stream,
        &req_model,
        &acc,
        &resp_bytes,
    );

    // Log the request
    let model = acc
        .model
        .filter(|value| !value.is_empty())
        .unwrap_or(req_model);
    let repo_attribution = logger::get_repo_attribution_for_connection(local_addr, peer_addr);
    let entry = LogEntry {
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        request_id: uuid::Uuid::new_v4().to_string(),
        developer_id: logger::get_developer_id(),
        repo: repo_attribution.repo,
        repo_source: repo_attribution.source,
        repo_pid: repo_attribution.pid,
        repo_cwd: repo_attribution.cwd.map(|path| path.display().to_string()),
        provider,
        endpoint: raw_uri_path,
        model,
        stream: is_stream,
        status,
        latency_ms,
        input_tokens: acc.input_tokens.unwrap_or(0),
        output_tokens: acc.output_tokens.unwrap_or(0),
        stop_reason: acc.stop_reason.unwrap_or_default(),
        error_message,
    };

    logger::append_log(&entry);

    // Build response to send back to the client
    let mut builder = Response::builder().status(status);
    for (name, value) in &resp_headers {
        // Skip transfer-encoding since we're sending the full body
        if name.as_str().eq_ignore_ascii_case("transfer-encoding") {
            continue;
        }
        // Don't forward content-length as we may have modified the body
        if name.as_str().eq_ignore_ascii_case("content-length") {
            continue;
        }
        if let Ok(n) = hyper::header::HeaderName::from_bytes(name.as_str().as_bytes()) {
            if let Ok(v) = hyper::header::HeaderValue::from_bytes(value.as_bytes()) {
                builder = builder.header(n, v);
            }
        }
    }

    Ok(builder
        .body(Full::new(resp_bytes))
        .unwrap_or_else(|_| error_response(500, "Failed to build response")))
}

#[cfg(test)]
mod tests {
    use super::{anthropic_oauth_bearer_from_x_api_key, extract_openai_model, meaningful_string};
    use crate::proxy::types::Provider;
    use hyper::HeaderMap;

    #[test]
    fn ignores_placeholder_model_values() {
        assert_eq!(meaningful_string(Some("unknown")), None);
        assert_eq!(
            meaningful_string(Some(" gpt-5.4 ")),
            Some("gpt-5.4".to_string())
        );
    }

    #[test]
    fn extracts_nested_openai_models() {
        let payload = serde_json::json!({
            "model": "unknown",
            "response": {
                "body": {
                    "model": "gpt-5.4"
                }
            }
        });

        assert_eq!(extract_openai_model(&payload), Some("gpt-5.4".to_string()));
    }

    #[test]
    fn rewrites_anthropic_oauth_tokens_from_x_api_key() {
        let mut headers = HeaderMap::new();
        headers.insert("x-api-key", "sk-ant-oat01-example".parse().unwrap());

        assert_eq!(
            anthropic_oauth_bearer_from_x_api_key(Provider::Anthropic, &headers),
            Some("sk-ant-oat01-example".to_string())
        );
        assert_eq!(
            anthropic_oauth_bearer_from_x_api_key(Provider::Openai, &headers),
            None
        );
    }
}

fn error_response(status: u16, msg: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(
            serde_json::json!({ "error": msg }).to_string(),
        )))
        .unwrap()
}
