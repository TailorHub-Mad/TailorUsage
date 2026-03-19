import { useEffect, useRef } from "react";
import { useStore } from "../store";
import {
  fetchMetrics,
  fetchUsage,
  checkProxyRunning,
  getProxySettings,
  setTrayTitle,
  clearAuthCookie,
} from "../lib/api";
import { calculateCost } from "../lib/cost";
import { formatCost, formatTokens } from "../lib/format";
import type { LogRecord, DeveloperMetrics } from "../lib/types";

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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !cookie) return;

    const poll = async () => {
      try {
        setLoading(true);
        setError(null);

        const [metricsRes, todayRes, weekRes, proxyRunning, proxySettings] =
          await Promise.all([
            fetchMetrics(cookie).catch((e: Error) => {
              if (e.message === "unauthorized") throw e;
              return null;
            }),
            fetchUsage(cookie, todayStr(), todayStr()).catch(() => null),
            fetchUsage(cookie, weekAgoStr(), todayStr()).catch(() => null),
            checkProxyRunning().catch(() => false),
            getProxySettings().catch(() => ({ share_diagnostics: false })),
          ]);

        if (metricsRes) {
          // Extract first developer's metrics (personal use)
          const metricsArr = (metricsRes as { metrics?: DeveloperMetrics[] })
            .metrics;
          if (metricsArr && metricsArr.length > 0) {
            setMetrics(metricsArr[0]);
          }
        }

        const todayLogs = ((todayRes as { data?: LogRecord[] })?.data ??
          []) as LogRecord[];
        const weekLogs = ((weekRes as { data?: LogRecord[] })?.data ??
          []) as LogRecord[];
        setTodayLogs(todayLogs);
        setWeekLogs(weekLogs);

        setProxyStatus({
          running: proxyRunning as boolean,
          shareDiagnostics:
            (proxySettings as { share_diagnostics?: boolean })
              .share_diagnostics ?? false,
        });

        // Update tray title
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

    pollRef.current = poll;

    // Initial fetch
    poll();

    // Set up interval
    intervalRef.current = setInterval(poll, preferences.poll_interval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
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
