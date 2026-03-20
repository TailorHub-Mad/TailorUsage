export interface LogRecord {
  ts: string | number;
  request_id: string;
  developer_id: string;
  repo: string;
  provider?: "anthropic" | "openai";
  endpoint?: string;
  model: string;
  stream?: boolean;
  status: number;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  stop_reason: string;
  error_message?: string;
  share_diagnostics?: boolean;
}

export interface DeveloperMetrics {
  developer_id: string;
  total_tokens_1h: number;
  opus_tokens_1h: number;
  opus_streak: number;
  last_updated: string;
  warning_flag: boolean;
}

export interface ProxyStatus {
  running: boolean;
  enabled: boolean;
  shareDiagnostics: boolean;
}

export interface Preferences {
  poll_interval: number;
  tray_display: "cost" | "tokens";
}
