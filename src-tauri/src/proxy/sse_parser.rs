use crate::proxy::types::StreamAccumulator;

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
                    if let Some(input) = usage.get("input_tokens").and_then(|t| t.as_u64()) {
                        acc.input_tokens = Some(input);
                    }
                }
            }
        }
        "message_delta" => {
            if let Some(usage) = v.get("usage") {
                if let Some(output) = usage.get("output_tokens").and_then(|t| t.as_u64()) {
                    acc.output_tokens = Some(output);
                }
            }
            if let Some(stop) = v.get("delta")
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
        if let Some(model) = v.get("model").and_then(|m| m.as_str()) {
            acc.model = Some(model.to_string());
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
