import type { LogRecord } from "./types";

type RawLogRecord = Record<string, unknown>;

function asRecord(value: unknown): RawLogRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawLogRecord)
    : null;
}

function getPath(source: unknown, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    const record = asRecord(current);
    if (!record || !(key in record)) return undefined;
    current = record[key];
  }
  return current;
}

function getString(source: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const value = getPath(source, path);
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function getNumber(source: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const value = getPath(source, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeProvider(raw: unknown): LogRecord["provider"] {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "anthropic" || value === "openai") return value;
  return undefined;
}

function inferProvider(endpoint: string, model: string): LogRecord["provider"] {
  const endpointValue = endpoint.toLowerCase();
  const modelValue = model.toLowerCase();

  if (endpointValue.includes("/v1/messages") || modelValue.includes("claude")) {
    return "anthropic";
  }

  if (
    endpointValue.includes("/responses") ||
    endpointValue.includes("/chat/completions") ||
    endpointValue.includes("/completions") ||
    endpointValue.includes("/models") ||
    modelValue.includes("gpt") ||
    modelValue.includes("o1") ||
    modelValue.includes("o3") ||
    modelValue.includes("o4")
  ) {
    return "openai";
  }

  return undefined;
}

function normalizeTimestamp(source: unknown): string | number {
  const timestamp = getNumber(source, [
    ["ts"],
    ["timestamp"],
    ["created_at"],
    ["createdAt"],
    ["time"],
  ]);

  if (timestamp !== null) return timestamp;

  return (
    getString(source, [["ts"], ["timestamp"], ["created_at"], ["createdAt"], ["time"]]) ??
    Date.now()
  );
}

export function logTime(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeLogRecord(raw: unknown): LogRecord | null {
  const record = asRecord(raw);
  if (!record) return null;

  const endpoint = getString(record, [["endpoint"], ["path"], ["url_path"], ["request", "path"]]) ?? "";
  const model = getString(record, [["model"], ["model_name"], ["response", "model"], ["request", "model"]]) ?? "";
  const provider =
    normalizeProvider(record.provider) ??
    inferProvider(endpoint, model);

  const inputTokens = getNumber(record, [
    ["input_tokens"],
    ["inputTokens"],
    ["prompt_tokens"],
    ["promptTokens"],
    ["usage", "input_tokens"],
    ["usage", "prompt_tokens"],
    ["response", "usage", "input_tokens"],
    ["response", "usage", "prompt_tokens"],
  ]) ?? 0;

  const outputTokens = getNumber(record, [
    ["output_tokens"],
    ["outputTokens"],
    ["completion_tokens"],
    ["completionTokens"],
    ["usage", "output_tokens"],
    ["usage", "completion_tokens"],
    ["response", "usage", "output_tokens"],
    ["response", "usage", "completion_tokens"],
  ]) ?? 0;

  return {
    ts: normalizeTimestamp(record),
    request_id:
      getString(record, [["request_id"], ["requestId"], ["id"], ["response", "id"]]) ??
      crypto.randomUUID(),
    developer_id:
      getString(record, [["developer_id"], ["developerId"], ["user_email"], ["userEmail"], ["email"]]) ??
      "unknown",
    repo: getString(record, [["repo"], ["repository"], ["project"]]) ?? "unknown",
    provider,
    endpoint,
    model,
    stream: Boolean(getPath(record, ["stream"]) ?? getPath(record, ["request", "stream"])),
    status:
      getNumber(record, [["status"], ["status_code"], ["statusCode"], ["response", "status"]]) ??
      0,
    latency_ms:
      getNumber(record, [["latency_ms"], ["latencyMs"], ["duration_ms"], ["durationMs"]]) ??
      0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    stop_reason:
      getString(record, [["stop_reason"], ["stopReason"], ["finish_reason"], ["response", "status"]]) ??
      "",
    error_message:
      getString(record, [["error_message"], ["errorMessage"], ["error", "message"], ["message"]]) ??
      undefined,
  };
}

export function normalizeLogRecords(rawLogs: unknown[]): LogRecord[] {
  return rawLogs
    .map((raw) => normalizeLogRecord(raw))
    .filter((log): log is LogRecord => log !== null)
    .sort((a, b) => logTime(a.ts) - logTime(b.ts));
}

export function latestLogForProvider(
  logs: LogRecord[],
  provider?: LogRecord["provider"],
): LogRecord | null {
  const filtered = provider ? logs.filter((log) => log.provider === provider) : logs;
  return filtered.reduce<LogRecord | null>((latest, log) => {
    if (!latest) return log;
    return logTime(log.ts) > logTime(latest.ts) ? log : latest;
  }, null);
}
