export interface LogRecord {
  ts: string | number;
  request_id: string;
  developer_id: string;
  repo: string;
  repo_source?: string;
  repo_pid?: number;
  repo_cwd?: string;
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
}

export interface DeveloperMetrics {
  developer_id: string;
  total_tokens_1h: number;
  opus_tokens_1h: number;
  opus_streak: number;
  last_updated: string;
  warning_flag: boolean;
}

export interface ClaudeUsageWindow {
  utilization: number;
  resets_at: string;
}

export interface ClaudeExtraUsage {
  is_enabled: boolean;
  used_credits: number;
  monthly_limit: number;
  currency: string;
}

export interface ClaudeUsage {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
  seven_day_opus?: ClaudeUsageWindow | null;
  extra_usage?: ClaudeExtraUsage | null;
}

export interface CodexUsageWindow {
  used_percent: number;
  reset_at: number;
  limit_window_seconds: number;
}

export interface CodexRateLimit {
  primary_window?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
}

export interface CodexCredits {
  has_credits: boolean;
  unlimited: boolean;
  balance: number;
}

export interface CodexUsage {
  plan_type?: string;
  rate_limit?: CodexRateLimit | null;
  code_review_rate_limit?: {
    primary_window?: CodexUsageWindow | null;
  } | null;
  credits?: CodexCredits | null;
}

export interface ProxyStatus {
  running: boolean;
  enabled: boolean;
}

export interface Preferences {
  poll_interval: number;
  tray_display: "cost" | "tokens";
  tray_source: "claude" | "openai";
  notification_threshold: number | null;
}

export interface UpdateInfo {
  available: boolean;
  latest_version: string;
  download_url: string;
}
