use crate::proxy::types::StreamAccumulator;

fn sanitize_usage(value: Option<&serde_json::Value>) -> serde_json::Value {
    let Some(value) = value else {
        return serde_json::Value::Null;
    };

    serde_json::json!({
        "input_tokens": value.get("input_tokens").and_then(|v| v.as_u64()),
        "output_tokens": value.get("output_tokens").and_then(|v| v.as_u64()),
        "cache_creation_input_tokens": value
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64()),
        "cache_read_input_tokens": value
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64()),
    })
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
    ]
    .iter()
    .find_map(|path| string_at_path(value, path))
}

/// Parse a single Anthropic SSE event and update the accumulator.
///
/// Anthropic SSE format:
///   event: message_start  → data has usage.input_tokens, model
///   event: message_delta  → data has usage.output_tokens, stop_reason
pub fn parse_anthropic_event(event_type: &str, data: &str, acc: &mut StreamAccumulator) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
        return;
    };

    match event_type {
        "message_start" => {
            if let Some(msg) = v.get("message") {
                if let Some(model) = msg.get("model").and_then(|m| m.as_str()) {
                    acc.model = Some(model.to_string());
                }
                if let Some(usage) = msg.get("usage") {
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
                }
            }
        }
        "message_delta" => {
            if let Some(usage) = v.get("usage") {
                if let Some(output) = usage.get("output_tokens").and_then(|t| t.as_u64()) {
                    acc.output_tokens = Some(output);
                }
            }
            if let Some(stop) = v
                .get("delta")
                .and_then(|d| d.get("stop_reason"))
                .and_then(|s| s.as_str())
            {
                acc.stop_reason = Some(stop.to_string());
            }
        }
        _ => {}
    }
}

/// Parse a single OpenAI SSE data line and update the accumulator.
///
/// OpenAI SSE format:
///   data: {"id":...,"model":"gpt-4o",...,"choices":[...],"usage":null}
///   Final chunk may have "usage": { "prompt_tokens": N, "completion_tokens": N }
///   choices[0].finish_reason is non-null in the final choice chunk
pub fn parse_openai_chunk(data: &str, acc: &mut StreamAccumulator) {
    if data.trim() == "[DONE]" {
        return;
    }

    let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
        return;
    };

    // Model from first chunk
    if acc.model.is_none() {
        if let Some(model) = extract_openai_model(&v) {
            acc.model = Some(model);
        }
    }

    // finish_reason from choices
    if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
        if let Some(first) = choices.first() {
            if let Some(reason) = first.get("finish_reason").and_then(|r| r.as_str()) {
                acc.stop_reason = Some(reason.to_string());
            }
        }
    }

    // Usage from final chunk (when stream_options.include_usage is true)
    if let Some(usage) = v.get("usage") {
        if !usage.is_null() {
            if let Some(prompt) = usage.get("prompt_tokens").and_then(|t| t.as_u64()) {
                acc.input_tokens = Some(prompt);
            }
            if let Some(completion) = usage.get("completion_tokens").and_then(|t| t.as_u64()) {
                acc.output_tokens = Some(completion);
            }
        }
    }

    if let Some(usage) = v
        .get("response")
        .and_then(|r| r.get("usage"))
        .filter(|u| !u.is_null())
    {
        if let Some(input) = usage.get("input_tokens").and_then(|t| t.as_u64()) {
            acc.input_tokens = Some(input);
        }
        if let Some(output) = usage.get("output_tokens").and_then(|t| t.as_u64()) {
            acc.output_tokens = Some(output);
        }
    }
}

pub fn summarize_anthropic_sse(buf: &str) -> serde_json::Value {
    let mut events = Vec::new();
    let mut current_event = String::new();
    let mut current_data = String::new();

    let flush = |events: &mut Vec<serde_json::Value>, event_type: &str, data: &str| {
        if data.is_empty() {
            return;
        }

        let summary = match serde_json::from_str::<serde_json::Value>(data) {
            Ok(value) => serde_json::json!({
                "event": event_type,
                "top_level_keys": value
                    .as_object()
                    .map(|object| object.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default(),
                "message_usage": sanitize_usage(value.get("message").and_then(|message| message.get("usage"))),
                "usage": sanitize_usage(value.get("usage")),
                "delta_stop_reason": value
                    .get("delta")
                    .and_then(|delta| delta.get("stop_reason"))
                    .and_then(|stop_reason| stop_reason.as_str()),
                "message_model": value
                    .get("message")
                    .and_then(|message| message.get("model"))
                    .and_then(|model| model.as_str()),
                "type": value.get("type").and_then(|kind| kind.as_str()),
            }),
            Err(_) => serde_json::json!({
                "event": event_type,
                "invalid_json": true,
                "raw_preview": data.chars().take(240).collect::<String>(),
            }),
        };

        events.push(summary);
    };

    for line in buf.lines() {
        if line.starts_with("event: ") {
            current_event = line[7..].trim().to_string();
        } else if line.starts_with("data: ") {
            current_data = line[6..].to_string();
        } else if line.is_empty() {
            flush(&mut events, &current_event, &current_data);
            current_event.clear();
            current_data.clear();
        }
    }

    if !current_data.is_empty() {
        flush(&mut events, &current_event, &current_data);
    }

    serde_json::json!({
        "event_count": events.len(),
        "events": events,
    })
}

#[cfg(test)]
mod tests {
    use super::{extract_openai_model, parse_openai_chunk, summarize_anthropic_sse};
    use crate::proxy::types::StreamAccumulator;

    #[test]
    fn extracts_nested_openai_model_from_sse_chunk() {
        let chunk = serde_json::json!({
            "model": "unknown",
            "response": {
                "body": {
                    "model": "gpt-5.4"
                }
            }
        });

        assert_eq!(extract_openai_model(&chunk), Some("gpt-5.4".to_string()));
    }

    #[test]
    fn parses_model_and_usage_from_openai_chunk() {
        let mut acc = StreamAccumulator::default();

        parse_openai_chunk(
            r#"{"response":{"model":"gpt-5.4","usage":{"input_tokens":120,"output_tokens":30}}}"#,
            &mut acc,
        );

        assert_eq!(acc.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(acc.input_tokens, Some(120));
        assert_eq!(acc.output_tokens, Some(30));
    }

    #[test]
    fn summarizes_anthropic_usage_events_without_content() {
        let summary = summarize_anthropic_sse(
            concat!(
                "event: message_start\n",
                "data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-sonnet-4-6\",\"usage\":{\"input_tokens\":12,\"cache_creation_input_tokens\":3}}}\n\n",
                "event: message_delta\n",
                "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":34},\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n"
            ),
        );

        assert_eq!(summary["event_count"], 2);
        assert_eq!(summary["events"][0]["message_usage"]["input_tokens"], 12);
        assert_eq!(summary["events"][1]["usage"]["output_tokens"], 34);
        assert_eq!(summary["events"][1]["delta_stop_reason"], "end_turn");
    }
}

/// Parse raw SSE bytes for a given provider.
/// Returns events extracted from the buffer.
/// `remainder` should be carried over between calls for partial lines.
pub fn parse_sse_buffer(
    buf: &str,
    provider: crate::proxy::types::Provider,
    acc: &mut StreamAccumulator,
) {
    let mut current_event = String::new();
    let mut current_data = String::new();

    for line in buf.lines() {
        if line.starts_with("event: ") {
            current_event = line[7..].trim().to_string();
        } else if line.starts_with("data: ") {
            current_data = line[6..].to_string();
        } else if line.is_empty() {
            // End of event
            if !current_data.is_empty() {
                match provider {
                    crate::proxy::types::Provider::Anthropic => {
                        parse_anthropic_event(&current_event, &current_data, acc);
                    }
                    crate::proxy::types::Provider::Openai => {
                        parse_openai_chunk(&current_data, acc);
                    }
                }
            }
            current_event.clear();
            current_data.clear();
        }
    }

    // Handle trailing data without empty line terminator
    if !current_data.is_empty() {
        match provider {
            crate::proxy::types::Provider::Anthropic => {
                parse_anthropic_event(&current_event, &current_data, acc);
            }
            crate::proxy::types::Provider::Openai => {
                parse_openai_chunk(&current_data, acc);
            }
        }
    }
}
