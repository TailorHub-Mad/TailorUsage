use bytes::Bytes;
use http_body_util::Full;
use hyper::{Request, Response};
use std::time::Instant;

use crate::proxy::logger;
use crate::proxy::sse_parser;
use crate::proxy::types::{LogEntry, Provider, StreamAccumulator};

/// Headers that must NOT be logged (but ARE forwarded to upstream).
#[allow(dead_code)]
const SENSITIVE_HEADERS: &[&str] = &["authorization", "x-api-key", "cookie"];

/// Forward a request to the real upstream API, tap the response for logging.
pub async fn forward(
    provider: Provider,
    req: Request<hyper::body::Incoming>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let start = Instant::now();
    let method = req.method().clone();
    let uri_path = req.uri().path().to_string();

    // Collect headers for upstream (keep sensitive ones for the real request)
    let mut upstream_headers = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers() {
        // Skip host — reqwest sets the correct Host based on the upstream URL.
        // Forwarding the client's "127.0.0.1:8788" host causes 403s on real APIs.
        if name.as_str().eq_ignore_ascii_case("host") {
            continue;
        }
        if let Ok(n) = reqwest::header::HeaderName::from_bytes(name.as_str().as_bytes()) {
            if let Ok(v) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                upstream_headers.insert(n, v);
            }
        }
    }

    // Buffer request body
    let body_bytes = match http_body_util::BodyExt::collect(req.into_body()).await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return Ok(error_response(502, &format!("Failed to read request body: {}", e)));
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
        .and_then(|j| j.get("model"))
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();

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
    let upstream_url = format!("{}{}", provider.upstream_host(), uri_path);

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
            return Ok(error_response(502, &format!("Failed to read upstream response: {}", e)));
        }
    };

    let latency_ms = start.elapsed().as_millis() as u64;

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
                    acc.model = v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string());
                    if let Some(usage) = v.get("usage") {
                        acc.input_tokens = usage.get("input_tokens").and_then(|t| t.as_u64());
                        acc.output_tokens = usage.get("output_tokens").and_then(|t| t.as_u64());
                    }
                    acc.stop_reason = v.get("stop_reason").and_then(|s| s.as_str()).map(|s| s.to_string());
                }
                Provider::Openai => {
                    acc.model = v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string());
                    if let Some(usage) = v.get("usage") {
                        acc.input_tokens = usage.get("prompt_tokens").and_then(|t| t.as_u64());
                        acc.output_tokens = usage.get("completion_tokens").and_then(|t| t.as_u64());
                    }
                    if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
                        if let Some(first) = choices.first() {
                            acc.stop_reason = first.get("finish_reason").and_then(|s| s.as_str()).map(|s| s.to_string());
                        }
                    }
                }
            }
        }
    }

    // Log the request
    let model = acc.model.unwrap_or(req_model);
    let entry = LogEntry {
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        request_id: uuid::Uuid::new_v4().to_string(),
        developer_id: logger::get_developer_id(),
        repo: logger::get_repo_name(),
        provider,
        endpoint: uri_path,
        model,
        stream: is_stream,
        status,
        latency_ms,
        input_tokens: acc.input_tokens.unwrap_or(0),
        output_tokens: acc.output_tokens.unwrap_or(0),
        stop_reason: acc.stop_reason.unwrap_or_default(),
        share_diagnostics: logger::read_share_diagnostics(),
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

fn error_response(status: u16, msg: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(
            serde_json::json!({ "error": msg }).to_string(),
        )))
        .unwrap()
}
