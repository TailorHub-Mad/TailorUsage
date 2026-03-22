import { useEffect, useRef } from "react";
import { useStore } from "../store";
import {
  fetchMetrics,
  fetchUsage,
  readLocalLogs,
  getProxyEnabled,
  getProxySettings,
  setTrayTitle,
  clearAuthCookie,
} from "../lib/api";
import { calculateCost } from "../lib/cost";
import { formatCost, formatTokens } from "../lib/format";
import { normalizeLogRecords } from "../lib/logs";
import type { LogRecord, DeveloperMetrics } from "../lib/types";

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
    isAuthenticated,
    cookie,
    preferences,
    setMetrics,
    setTodayLogs,
    setWeekLogs,
    setProxyStatus,
    setLoading,
    setError,
    signOut,
  } = useStore();

  const slowIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fastIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<(() => Promise<void>) | null>(null);
  // Current user's developer_id — derived from local logs (most reliable source)
  const myIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !cookie) return;

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
        const totalTokens = todayLogs.reduce(
          (sum, l) => sum + l.input_tokens + l.output_tokens,
          0,
        );
        const title =
          preferences.tray_display === "cost"
            ? formatCost(cost)
            : formatTokens(totalTokens);
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

        const [metricsRes, weekRes, localWeekRaw, proxyEnabled, proxySettings] =
          await Promise.all([
            fetchMetricsWithRetry(cookie).catch((e: unknown) => {
              if (isUnauthorizedError(e)) throw e;
              return null;
            }),
            fetchUsage(cookie, weekStartStr(), todayStr()).catch(() => null),
            Promise.all(currentWeekDateStrings().map((date) => readLocalLogs(date).catch(() => []))),
            getProxyEnabled().catch(() => null),
            getProxySettings().catch(() => ({ share_diagnostics: false })),
          ]);

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

        // Only update proxy status if the IPC call succeeded (null = failed, preserve existing state)
        if (proxyEnabled !== null) {
          setProxyStatus({
            running: proxyEnabled as boolean,
            enabled: proxyEnabled as boolean,
            shareDiagnostics:
              (proxySettings as { share_diagnostics?: boolean })
                .share_diagnostics ?? false,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "unauthorized") {
          await clearAuthCookie();
          signOut();
          return;
        }
        setError(msg);
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
    isAuthenticated,
    cookie,
    preferences.poll_interval,
    preferences.tray_display,
    setMetrics,
    setTodayLogs,
    setWeekLogs,
    setProxyStatus,
    setLoading,
    setError,
    signOut,
  ]);

  return {
    refresh: () => pollRef.current?.(),
  };
}
