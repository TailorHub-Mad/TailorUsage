import { useEffect, useRef } from "react";
import { useStore } from "../store";
import {
  fetchClaudeUsage,
  fetchCodexUsage,
  fetchMetrics,
  fetchUsage,
  readLocalLogs,
  getProxyEnabled,
  setTrayTitle,
  forwardLogsToDashboard,
} from "../lib/api";
import { calculateCost } from "../lib/cost";
import { formatCost } from "../lib/format";
import { DAILY_LIMIT, formatResetTime, formatUsagePercent, totalTokens } from "../lib/usage";
import { normalizeLogRecords } from "../lib/logs";
import type { LogRecord, DeveloperMetrics, ClaudeUsage, CodexUsage } from "../lib/types";

function parseStatusCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

function parseRetryAfterTimestamp(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  // Format: claude_usage_failed:<status>:<unix_seconds>
  const match = message.match(/claude_usage_failed:[^:]+:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isProviderLoginRequiredError(provider: "claude" | "openai", error: unknown): boolean {
  const message = rawErrorMessage(error);
  const statusCode = parseStatusCode(error);

  if (provider === "claude" && message === "claude_credentials_missing") return true;
  if (provider === "openai" && message === "codex_credentials_missing") return true;

  return statusCode === 401 || statusCode === 403;
}

function formatProviderUsageError(provider: "claude" | "openai", error: unknown): string {
  if (isProviderLoginRequiredError(provider, error)) {
    return "Login required";
  }

  const statusCode = parseStatusCode(error);
  if (statusCode) {
    const retryAt = parseRetryAfterTimestamp(error);
    const resetSuffix = retryAt ? ` ${formatResetTime(retryAt)}` : " Try again later.";
    return `Usage request failed (HTTP ${statusCode}).${resetSuffix}`;
  }

  return "Usage request failed. Try again later.";
}

function latestProvider(logs: LogRecord[]): "anthropic" | "openai" | null {
  const latestLog = [...logs].sort((a, b) => {
    const aTime = typeof a.ts === "number" ? a.ts : new Date(String(a.ts)).getTime();
    const bTime = typeof b.ts === "number" ? b.ts : new Date(String(b.ts)).getTime();
    return bTime - aTime;
  })[0];

  if (!latestLog) return null;
  return latestLog.provider === "openai" ? "openai" : "anthropic";
}

function formatTrayTitle(
  cost: number,
  logs: LogRecord[],
  trayDisplay: "cost" | "tokens",
  traySource: "auto" | "claude" | "openai",
  claudeUsage: ClaudeUsage | null,
  codexUsage: CodexUsage | null,
): string {
  if (trayDisplay === "cost") {
    return formatCost(cost);
  }

  const claudeUtilization = claudeUsage?.five_hour?.utilization;
  const codexUtilization = codexUsage?.rate_limit?.primary_window?.used_percent;

  let prioritize: "anthropic" | "openai";
  if (traySource === "openai") {
    prioritize = "openai";
  } else if (traySource === "claude") {
    prioritize = "anthropic";
  } else {
    prioritize = latestProvider(logs) ?? "anthropic";
  }

  if (prioritize === "openai") {
    if (typeof codexUtilization === "number") return `${Math.round(codexUtilization)}%`;
    if (typeof claudeUtilization === "number") return `${Math.round(claudeUtilization)}%`;
  } else {
    if (typeof claudeUtilization === "number") return `${Math.round(claudeUtilization)}%`;
    if (typeof codexUtilization === "number") return `${Math.round(codexUtilization)}%`;
  }

  return formatUsagePercent(totalTokens(logs), DAILY_LIMIT);
}

function mergeLogs(primary: LogRecord[], secondary: LogRecord[]): LogRecord[] {
  const merged = new Map<string, LogRecord>();

  for (const log of [...primary, ...secondary]) {
    merged.set(log.request_id, log);
  }

  return [...merged.values()].sort((a, b) => {
    const aTime = typeof a.ts === "number" ? a.ts : new Date(String(a.ts)).getTime();
    const bTime = typeof b.ts === "number" ? b.ts : new Date(String(b.ts)).getTime();
    return aTime - bTime;
  });
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isKnownDeveloperId(value: string | null | undefined): value is string {
  return Boolean(value && value.trim() && value !== "unknown");
}

function preferredDeveloperId(logs: LogRecord[]): string | null {
  const known = logs.find((log) => isKnownDeveloperId(log.developer_id));
  return known?.developer_id ?? logs[0]?.developer_id ?? null;
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error
    ? error.message === "unauthorized"
    : String(error) === "unauthorized";
}

async function fetchMetricsWithRetry(cookie: string) {
  try {
    return await fetchMetrics(cookie);
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
    return fetchMetrics(cookie);
  }
}

function todayStr(): string {
  return formatDate(new Date());
}

function currentWeekStart(): Date {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function weekStartStr(): string {
  const d = currentWeekStart();
  return formatDate(d);
}

function currentWeekDateStrings(): string[] {
  const start = currentWeekStart();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return formatDate(date);
  });
}

export function usePolling() {
  const {
    cookie,
    preferences,
    setMetrics,
    setClaudeUsage,
    setClaudeUsageError,
    setCodexUsage,
    setCodexUsageError,
    setTodayLogs,
    setWeekLogs,
    setProxyStatus,
    setLoading,
    setError,
  } = useStore();

  const slowIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fastIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<(() => Promise<void>) | null>(null);
  // Current user's developer_id — derived from local logs (most reliable source)
  const myIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Fast poll: read today's logs directly from the local proxy JSONL file
    const pollLocalLogs = async () => {
      try {
        const raw = await readLocalLogs(todayStr());
        const todayLogs = normalizeLogRecords(raw);
        setTodayLogs(todayLogs);

        // Derive current user's developer_id from local logs
        const localDeveloperId = preferredDeveloperId(todayLogs);
        if (isKnownDeveloperId(localDeveloperId) || !myIdRef.current) {
          myIdRef.current = localDeveloperId;
        }

        // Keep tray title in sync
        const cost = calculateCost(todayLogs);
        const title = formatTrayTitle(
          cost,
          todayLogs,
          preferences.tray_display,
          preferences.tray_source,
          useStore.getState().claudeUsage,
          useStore.getState().codexUsage,
        );
        setTrayTitle(title);
      } catch {
        // local log read failure is non-fatal — fall back to API data
      }
    };

    // Slow poll: fetch week history + local week logs + proxy status from the API
    const pollApi = async () => {
      try {
        setLoading(true);
        setError(null);

        const [metricsRes, weekRes, claudeUsageResult, codexUsageResult, localWeekRaw, proxyEnabled] =
          await Promise.all([
            cookie
              ? fetchMetricsWithRetry(cookie).catch((e: unknown) => {
                  if (isUnauthorizedError(e)) throw e;
                  return null;
                })
              : Promise.resolve(null),
            cookie
              ? fetchUsage(cookie, weekStartStr(), todayStr()).catch(() => null)
              : Promise.resolve(null),
            fetchClaudeUsage()
              .then((data) => ({ data, error: null }))
              .catch((error: unknown) => ({ data: null, error })),
            fetchCodexUsage()
              .then((data) => ({ data, error: null }))
              .catch((error: unknown) => ({ data: null, error })),
            Promise.all(currentWeekDateStrings().map((date) => readLocalLogs(date).catch(() => []))),
            getProxyEnabled().catch(() => null),
          ]);

        setClaudeUsage((claudeUsageResult.data as ClaudeUsage | null) ?? null);
        setClaudeUsageError(
          claudeUsageResult.error ? formatProviderUsageError("claude", claudeUsageResult.error) : null,
        );
        setCodexUsage((codexUsageResult.data as CodexUsage | null) ?? null);
        setCodexUsageError(
          codexUsageResult.error ? formatProviderUsageError("openai", codexUsageResult.error) : null,
        );

        const normalizedLocalWeekLogs = normalizeLogRecords(localWeekRaw.flat());

        const localWeekDeveloperId = preferredDeveloperId(normalizedLocalWeekLogs);
        if (isKnownDeveloperId(localWeekDeveloperId) || !myIdRef.current) {
          myIdRef.current = localWeekDeveloperId;
        }

        if (metricsRes) {
          const metricsArr = (metricsRes as { metrics?: DeveloperMetrics[] })
            .metrics;
          if (metricsArr && metricsArr.length > 0) {
            setMetrics(metricsArr[0]);
            // Fall back to metrics for developer_id if local logs are empty
            if (!isKnownDeveloperId(myIdRef.current)) {
              myIdRef.current = metricsArr[0].developer_id;
            }
          }
        }

        const allWeekLogs = ((weekRes as { data?: LogRecord[] })?.data ??
          []) as LogRecord[];
        const normalizedWeekLogs = normalizeLogRecords(allWeekLogs as unknown[]);

        // Filter to current user's logs only
        const remoteWeekLogs = myIdRef.current
          ? normalizedWeekLogs.filter((l) => l.developer_id === myIdRef.current)
          : normalizedWeekLogs;
        const localWeekLogs = myIdRef.current
          ? normalizedLocalWeekLogs.filter((l) => l.developer_id === myIdRef.current)
          : normalizedLocalWeekLogs;
        setWeekLogs(mergeLogs(remoteWeekLogs, localWeekLogs));

        const latestTodayLogs = useStore.getState().todayLogs;
        setTrayTitle(
          formatTrayTitle(
            calculateCost(latestTodayLogs),
            latestTodayLogs,
            preferences.tray_display,
            preferences.tray_source,
            (claudeUsageResult.data as ClaudeUsage | null) ?? null,
            (codexUsageResult.data as CodexUsage | null) ?? null,
          ),
        );

        // Only update proxy status if the IPC call succeeded (null = failed, preserve existing state)
        if (proxyEnabled !== null) {
          setProxyStatus({
            running: proxyEnabled as boolean,
            enabled: proxyEnabled as boolean,
          });
        }

        // Forward any new proxy logs to the shared dashboard (fire-and-forget)
        forwardLogsToDashboard().catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };

    const poll = async () => {
      await Promise.all([pollLocalLogs(), pollApi()]);
    };

    pollRef.current = poll;

    poll();

    // Fast: re-read local log file every 5 seconds
    fastIntervalRef.current = setInterval(pollLocalLogs, 5000);

    // Slow: re-fetch API (week history, proxy status) at user-configured interval
    slowIntervalRef.current = setInterval(pollApi, preferences.poll_interval);

    return () => {
      if (fastIntervalRef.current) clearInterval(fastIntervalRef.current);
      if (slowIntervalRef.current) clearInterval(slowIntervalRef.current);
    };
  }, [
    cookie,
    preferences.poll_interval,
    preferences.tray_display,
    preferences.tray_source,
    setMetrics,
    setClaudeUsage,
    setClaudeUsageError,
    setCodexUsage,
    setCodexUsageError,
    setTodayLogs,
    setWeekLogs,
    setProxyStatus,
    setLoading,
    setError,
  ]);

  return {
    refresh: () => pollRef.current?.(),
  };
}
