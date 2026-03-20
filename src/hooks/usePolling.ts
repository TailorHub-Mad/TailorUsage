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
  return new Date().toISOString().slice(0, 10);
}

function weekAgoStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
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
        if (todayLogs.length > 0) {
          myIdRef.current = todayLogs[0].developer_id;
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

    // Slow poll: fetch week history + proxy status from the API
    const pollApi = async () => {
      try {
        setLoading(true);
        setError(null);

        const [metricsRes, weekRes, proxyEnabled, proxySettings] =
          await Promise.all([
            fetchMetricsWithRetry(cookie).catch((e: unknown) => {
              if (isUnauthorizedError(e)) throw e;
              return null;
            }),
            fetchUsage(cookie, weekAgoStr(), todayStr()).catch(() => null),
            getProxyEnabled().catch(() => null),
            getProxySettings().catch(() => ({ share_diagnostics: false })),
          ]);

        if (metricsRes) {
          const metricsArr = (metricsRes as { metrics?: DeveloperMetrics[] })
            .metrics;
          if (metricsArr && metricsArr.length > 0) {
            setMetrics(metricsArr[0]);
            // Fall back to metrics for developer_id if local logs are empty
            if (!myIdRef.current) {
              myIdRef.current = metricsArr[0].developer_id;
            }
          }
        }

        const allWeekLogs = ((weekRes as { data?: LogRecord[] })?.data ??
          []) as LogRecord[];
        const normalizedWeekLogs = normalizeLogRecords(allWeekLogs as unknown[]);

        // Filter to current user's logs only
        const weekLogs = myIdRef.current
          ? normalizedWeekLogs.filter((l) => l.developer_id === myIdRef.current)
          : normalizedWeekLogs;
        setWeekLogs(weekLogs);

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
