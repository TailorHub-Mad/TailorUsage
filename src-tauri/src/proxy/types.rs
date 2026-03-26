use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
}

impl Provider {
    pub fn upstream_host(&self) -> &'static str {
        match self {
            Provider::Anthropic => "https://api.anthropic.com",
            Provider::Openai => "https://api.openai.com",
        }
    }

    #[allow(dead_code)]
    pub fn default_port(&self) -> u16 {
        match self {
            Provider::Anthropic => 8787,
            Provider::Openai => 8788,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub ts: u64,
    pub request_id: String,
    pub developer_id: String,
    pub repo: String,
    pub provider: Provider,
    pub endpoint: String,
    pub model: String,
    pub stream: bool,
    pub status: u16,
    pub latency_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub stop_reason: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProxyConfig {
    pub anthropic_port: u16,
    pub openai_port: u16,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            anthropic_port: 8787,
            openai_port: 8788,
        }
    }
}

/// Accumulated state while parsing an SSE stream.
#[derive(Debug, Default)]
pub struct StreamAccumulator {
    pub model: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub stop_reason: Option<String>,
}
