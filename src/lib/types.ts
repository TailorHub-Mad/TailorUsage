export interface LogRecord {
  ts: string;
  request_id: string;
  developer_id: string;
  repo: string;
  model: string;
  status: number;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  stop_reason: string;
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
  shareDiagnostics: boolean;
}

export interface Preferences {
  poll_interval: number;
  tray_display: "cost" | "tokens";
}
