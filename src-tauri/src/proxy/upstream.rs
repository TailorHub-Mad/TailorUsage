use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use reqwest::header::{HeaderValue, AUTHORIZATION};
use sha1::{Digest, Sha1};
use std::net::SocketAddr;
use std::time::Instant;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::proxy::logger;
use crate::proxy::sse_parser;
use crate::proxy::types::{LogEntry, Provider, StreamAccumulator};

const WEBSOCKET_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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

fn should_inject_openai_auth(provider: Provider, headers: &reqwest::header::HeaderMap) -> bool {
    provider == Provider::Openai && !headers.contains_key(AUTHORIZATION)
}

fn is_websocket_handshake_header(name: &str) -> bool {
    name.eq_ignore_ascii_case("connection")
        || name.eq_ignore_ascii_case("upgrade")
        || name.eq_ignore_ascii_case("sec-websocket-key")
        || name.eq_ignore_ascii_case("sec-websocket-version")
        || name.eq_ignore_ascii_case("sec-websocket-protocol")
        || name.eq_ignore_ascii_case("sec-websocket-extensions")
}

fn collect_upstream_headers(
    provider: Provider,
    headers: &hyper::HeaderMap,
    skip_websocket_headers: bool,
) -> reqwest::header::HeaderMap {
    let mut upstream_headers = reqwest::header::HeaderMap::new();

    for (name, value) in headers {
        // Skip host — reqwest and tungstenite set the correct Host based on the upstream URL.
        if name.as_str().eq_ignore_ascii_case("host") {
            continue;
        }
        // Skip Accept-Encoding — reqwest does not have compression features enabled,
        // so forwarding this header causes Anthropic/OpenAI to respond with compressed
        // bytes that we cannot decompress. The raw bytes are then unparseable by the
        // SSE token extractor, resulting in all token counts being logged as 0.
        if name.as_str().eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        if skip_websocket_headers && is_websocket_handshake_header(name.as_str()) {
            continue;
        }
        if let Ok(n) = reqwest::header::HeaderName::from_bytes(name.as_str().as_bytes()) {
            if let Ok(v) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                upstream_headers.insert(n, v);
            }
        }
    }

    if let Some(token) = anthropic_oauth_bearer_from_x_api_key(provider, headers) {
        upstream_headers.remove("x-api-key");

        let auth_value = format!("Bearer {}", token);
        if let Ok(value) = HeaderValue::from_str(&auth_value) {
            upstream_headers.insert(AUTHORIZATION, value);
        }
    }

    if should_inject_openai_auth(provider, &upstream_headers) {
        if let Some(api_key) = logger::read_openai_api_key() {
            let auth_value = format!("Bearer {}", api_key);
            if let Ok(value) = HeaderValue::from_str(&auth_value) {
                upstream_headers.insert(AUTHORIZATION, value);
            }
        }
    }

    upstream_headers
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
        &["data", "response", "body", "model"],
        &["request", "model"],
        &["request", "body", "model"],
    ]
    .iter()
    .find_map(|path| string_at_path(value, path))
}

fn header_contains_token(headers: &hyper::HeaderMap, name: &str, expected: &str) -> bool {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .any(|token| token.eq_ignore_ascii_case(expected))
        })
        .unwrap_or(false)
}

fn is_websocket_upgrade_request<B>(req: &Request<B>) -> bool {
    req.method() == Method::GET
        && header_contains_token(req.headers(), "connection", "upgrade")
        && header_contains_token(req.headers(), "upgrade", "websocket")
        && req.headers().contains_key("sec-websocket-key")
        && req.headers().contains_key("sec-websocket-version")
}

fn websocket_accept_key(key: &str) -> String {
    let mut sha1 = Sha1::new();
    sha1.update(key.trim().as_bytes());
    sha1.update(WEBSOCKET_GUID.as_bytes());
    BASE64_STANDARD.encode(sha1.finalize())
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

fn upstream_websocket_url(provider: Provider, upstream_path: &str) -> String {
    let scheme = if provider.upstream_host().starts_with("https://") {
        "wss://"
    } else {
        "ws://"
    };
    let host = provider
        .upstream_host()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    format!("{}{}{}", scheme, host, upstream_path)
}

fn extract_openai_response_fields(v: &serde_json::Value, acc: &mut StreamAccumulator) {
    if acc.model.is_none() {
        acc.model = extract_openai_model(v);
    }

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
        if let Some(usage) = v
            .get("response")
            .and_then(|r| r.get("usage"))
            .or_else(|| v.get("data").and_then(|d| d.get("usage")))
            .or_else(|| {
                v.get("data")
                    .and_then(|d| d.get("response").and_then(|r| r.get("usage")))
            })
        {
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
                .or_else(|| v.get("data").and_then(|d| d.get("status")))
                .or_else(|| {
                    v.get("data")
                        .and_then(|d| d.get("response").and_then(|r| r.get("status")))
                })
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

fn append_log_entry(
    provider: Provider,
    local_addr: SocketAddr,
    peer_addr: SocketAddr,
    endpoint: String,
    model: String,
    stream: bool,
    status: u16,
    latency_ms: u64,
    acc: &StreamAccumulator,
    error_message: Option<String>,
) {
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
        endpoint,
        model,
        stream,
        status,
        latency_ms,
        input_tokens: acc.input_tokens.unwrap_or(0),
        output_tokens: acc.output_tokens.unwrap_or(0),
        stop_reason: acc.stop_reason.clone().unwrap_or_default(),
        error_message,
    };

    logger::append_log(&entry);
}

fn websocket_message_text(message: &Message) -> Option<&str> {
    match message {
        Message::Text(text) => Some(text.as_ref()),
        Message::Binary(bytes) => std::str::from_utf8(bytes).ok(),
        _ => None,
    }
}

fn update_openai_accumulator_from_websocket_message(
    message: &Message,
    acc: &mut StreamAccumulator,
    req_model: &mut String,
) {
    let Some(text) = websocket_message_text(message) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    if req_model.is_empty() {
        if let Some(model) = extract_openai_model(&value) {
            *req_model = model;
        }
    }

    extract_openai_response_fields(&value, acc);
}

async fn proxy_websocket_tunnel<ClientIo>(
    provider: Provider,
    local_addr: SocketAddr,
    peer_addr: SocketAddr,
    endpoint: String,
    mut req_model: String,
    client_ws: WebSocketStream<ClientIo>,
    upstream_ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
) where
    ClientIo: AsyncRead + AsyncWrite + Unpin,
{
    let started = Instant::now();
    let mut acc = StreamAccumulator::default();
    let (mut client_sink, mut client_stream) = client_ws.split();
    let (mut upstream_sink, mut upstream_stream) = upstream_ws.split();
    let mut client_closed = false;
    let mut upstream_closed = false;
    let mut error_message = None;

    while !(client_closed && upstream_closed) {
        tokio::select! {
            message = client_stream.next(), if !client_closed => {
                match message {
                    Some(Ok(message)) => {
                        update_openai_accumulator_from_websocket_message(&message, &mut acc, &mut req_model);
                        let is_close = message.is_close();
                        if let Err(error) = upstream_sink.send(message).await {
                            error_message = Some(error.to_string());
                            break;
                        }
                        if is_close {
                            client_closed = true;
                        }
                    }
                    Some(Err(error)) => {
                        error_message = Some(error.to_string());
                        break;
                    }
                    None => {
                        client_closed = true;
                        if let Err(error) = upstream_sink.close().await {
                            error_message = Some(error.to_string());
                            break;
                        }
                    }
                }
            }
            message = upstream_stream.next(), if !upstream_closed => {
                match message {
                    Some(Ok(message)) => {
                        update_openai_accumulator_from_websocket_message(&message, &mut acc, &mut req_model);
                        let is_close = message.is_close();
                        if let Err(error) = client_sink.send(message).await {
                            error_message = Some(error.to_string());
                            break;
                        }
                        if is_close {
                            upstream_closed = true;
                        }
                    }
                    Some(Err(error)) => {
                        error_message = Some(error.to_string());
                        break;
                    }
                    None => {
                        upstream_closed = true;
                        if let Err(error) = client_sink.close().await {
                            error_message = Some(error.to_string());
                            break;
                        }
                    }
                }
            }
            else => break,
        }
    }

    let model = acc
        .model
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or(req_model);

    append_log_entry(
        provider,
        local_addr,
        peer_addr,
        endpoint,
        model,
        true,
        StatusCode::SWITCHING_PROTOCOLS.as_u16(),
        started.elapsed().as_millis() as u64,
        &acc,
        error_message,
    );
}

async fn forward_websocket(
    provider: Provider,
    local_addr: SocketAddr,
    peer_addr: SocketAddr,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let raw_uri_path = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    let upstream_path = normalize_upstream_path(provider, req.uri());
    let upstream_url = upstream_websocket_url(provider, &upstream_path);
    let upstream_headers = collect_upstream_headers(provider, req.headers(), true);

    let sec_websocket_key = match req
        .headers()
        .get("sec-websocket-key")
        .and_then(|value| value.to_str().ok())
    {
        Some(value) => value.to_string(),
        None => return Ok(error_response(400, "Missing Sec-WebSocket-Key header")),
    };

    let on_upgrade = hyper::upgrade::on(req);

    let mut upstream_request = match upstream_url.into_client_request() {
        Ok(request) => request,
        Err(error) => {
            return Ok(error_response(
                502,
                &format!("Failed to build upstream websocket request: {}", error),
            ));
        }
    };
    for (name, value) in &upstream_headers {
        upstream_request
            .headers_mut()
            .insert(name.clone(), value.clone());
    }

    let (upstream_ws, upstream_response) = match connect_async(upstream_request).await {
        Ok(result) => result,
        Err(error) => {
            return Ok(error_response(
                502,
                &format!("Failed to connect upstream websocket: {}", error),
            ));
        }
    };

    let selected_protocol = upstream_response
        .headers()
        .get("sec-websocket-protocol")
        .cloned();
    let accept_key = websocket_accept_key(&sec_websocket_key);

    tokio::spawn(async move {
        let upgraded = match on_upgrade.await {
            Ok(upgraded) => upgraded,
            Err(error) => {
                log::error!("Failed websocket upgrade for {:?}: {}", provider, error);
                return;
            }
        };
        let client_ws = WebSocketStream::from_raw_socket(
            TokioIo::new(upgraded),
            tokio_tungstenite::tungstenite::protocol::Role::Server,
            None,
        )
        .await;

        proxy_websocket_tunnel(
            provider,
            local_addr,
            peer_addr,
            raw_uri_path,
            String::new(),
            client_ws,
            upstream_ws,
        )
        .await;
    });

    let mut builder = Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-accept", accept_key);
    if let Some(protocol) = selected_protocol {
        builder = builder.header("sec-websocket-protocol", protocol);
    }

    Ok(builder
        .body(Full::new(Bytes::new()))
        .unwrap_or_else(|_| error_response(500, "Failed to build websocket upgrade response")))
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
    if provider == Provider::Openai && is_websocket_upgrade_request(&req) {
        return forward_websocket(provider, local_addr, peer_addr, req).await;
    }

    let start = Instant::now();
    let method = req.method().clone();
    let raw_uri_path = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    let upstream_path = normalize_upstream_path(provider, req.uri());
    let upstream_headers = collect_upstream_headers(provider, req.headers(), false);

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
    } else if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&resp_bytes) {
        if status < 300 {
            // Non-streaming success: extract model, token counts, and stop reason
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
        } else {
            // Non-streaming error: still try to read the model from the response body
            // so it counts towards Top Models metrics even when the request failed
            match provider {
                Provider::Anthropic => {
                    acc.model = v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string());
                }
                Provider::Openai => {
                    acc.model = extract_openai_model(&v);
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
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or(req_model);
    append_log_entry(
        provider,
        local_addr,
        peer_addr,
        raw_uri_path,
        model,
        is_stream,
        status,
        latency_ms,
        &acc,
        error_message,
    );

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
    use super::{
        anthropic_oauth_bearer_from_x_api_key, extract_openai_model,
        extract_openai_response_fields, is_websocket_upgrade_request, meaningful_string,
        should_inject_openai_auth, websocket_accept_key,
    };
    use crate::proxy::types::{Provider, StreamAccumulator};
    use hyper::{HeaderMap, Request};
    use reqwest::header::{HeaderMap as ReqwestHeaderMap, AUTHORIZATION};

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
    fn extracts_usage_from_response_completed_payloads() {
        let mut acc = StreamAccumulator::default();
        let payload = serde_json::json!({
            "type": "response.completed",
            "data": {
                "response": {
                    "model": "gpt-5.4",
                    "status": "completed",
                    "usage": {
                        "input_tokens": 120,
                        "output_tokens": 40
                    }
                }
            }
        });

        extract_openai_response_fields(&payload, &mut acc);

        assert_eq!(acc.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(acc.input_tokens, Some(120));
        assert_eq!(acc.output_tokens, Some(40));
        assert_eq!(acc.stop_reason.as_deref(), Some("completed"));
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

    #[test]
    fn only_injects_openai_auth_when_client_auth_is_missing() {
        let mut headers = ReqwestHeaderMap::new();
        assert!(should_inject_openai_auth(Provider::Openai, &headers));
        assert!(!should_inject_openai_auth(Provider::Anthropic, &headers));

        headers.insert(AUTHORIZATION, "Bearer client-token".parse().unwrap());
        assert!(!should_inject_openai_auth(Provider::Openai, &headers));
    }

    #[test]
    fn detects_websocket_upgrade_requests() {
        let request = Request::builder()
            .method("GET")
            .header("connection", "keep-alive, Upgrade")
            .header("upgrade", "websocket")
            .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
            .header("sec-websocket-version", "13")
            .body(())
            .unwrap();

        assert!(is_websocket_upgrade_request(&request));
    }

    #[test]
    fn generates_rfc_websocket_accept_keys() {
        assert_eq!(
            websocket_accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
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
