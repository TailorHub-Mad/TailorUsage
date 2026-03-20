import { useState } from "react";
import { useStore } from "../../store";
import { startProxy, stopProxy, setProxySettings } from "../../lib/api";
import { latestLogForProvider } from "../../lib/logs";

function formatLastSeen(ts: string | number | null) {
  if (!ts) return "No local traffic yet";
  const numericTs = typeof ts === "number" ? ts : Number(ts);
  const date = Number.isFinite(numericTs)
    ? new Date(numericTs)
    : new Date(String(ts));
  if (Number.isNaN(date.getTime())) return "Timestamp unavailable";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ProxyToggle() {
  const { proxyStatus, todayLogs, setProxyStatus } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anthropicLogs = todayLogs.filter((log) => !log.provider || log.provider === "anthropic");
  const openaiLogs = todayLogs.filter((log) => log.provider === "openai");
  const latestOpenaiLog = latestLogForProvider(todayLogs, "openai");
  const latestAnyLog = latestLogForProvider(todayLogs);
  const latestOpenaiFailure = [...openaiLogs].reverse().find((log) => log.status >= 400) ?? null;
  const showDiagnostics = proxyStatus.enabled || todayLogs.length > 0;

  const handleProxyToggle = async () => {
    setLoading(true);
    setError(null);
    try {
      if (proxyStatus.enabled) {
        await stopProxy();
        setProxyStatus({ ...proxyStatus, enabled: false, running: false });
      } else {
        await startProxy();
        setProxyStatus({ ...proxyStatus, enabled: true, running: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // "already running" means Rust state is ahead of UI — sync instead of error
      if (msg.toLowerCase().includes("already running")) {
        setProxyStatus({ ...proxyStatus, enabled: true, running: true });
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDiagnosticsToggle = async () => {
    if (!proxyStatus.enabled) return;
    const newVal = !proxyStatus.shareDiagnostics;
    try {
      await setProxySettings(newVal);
      setProxyStatus({ ...proxyStatus, shareDiagnostics: newVal });
    } catch (e) {
      console.error("Failed to update proxy settings:", e);
    }
  };

  return (
    <div className="px-4 py-3 space-y-2">
      {/* Main proxy toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              proxyStatus.enabled ? "bg-green-400" : "bg-gray-300"
            }`}
          />
          <span className="text-sm text-gray-600">
            {loading ? "Starting..." : proxyStatus.enabled ? "Proxy Active" : "Proxy Off"}
          </span>
        </div>
        <button
          onClick={handleProxyToggle}
          disabled={loading}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            proxyStatus.enabled ? "bg-green-400" : "bg-gray-200"
          } ${loading ? "opacity-50" : ""}`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              proxyStatus.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Port status indicators */}
      {proxyStatus.enabled && (
        <div className="flex gap-3 text-xs text-gray-400">
          <span>Anthropic :8787</span>
          <span>OpenAI :8788</span>
        </div>
      )}

      {/* Diagnostics sub-toggle */}
      {proxyStatus.enabled && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Share diagnostics</span>
          <button
            onClick={handleDiagnosticsToggle}
            className={`relative w-7 h-4 rounded-full transition-colors ${
              proxyStatus.shareDiagnostics ? "bg-green-400" : "bg-gray-200"
            }`}
          >
            <div
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                proxyStatus.shareDiagnostics ? "translate-x-3" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      )}

      {/* Hint */}
      {proxyStatus.enabled && (
        <p className="text-xs text-gray-300">
          Open a new terminal for proxy to take effect.
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {showDiagnostics && (
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Local proxy diagnostics</span>
            <span className="text-[11px] text-gray-400">today.jsonl</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-white px-2.5 py-2 border border-gray-100">
              <div className="text-gray-400">Anthropic calls</div>
              <div className="mt-1 text-sm font-semibold text-gray-700">{anthropicLogs.length}</div>
            </div>
            <div className="rounded-lg bg-white px-2.5 py-2 border border-gray-100">
              <div className="text-gray-400">OpenAI calls</div>
              <div className="mt-1 text-sm font-semibold text-gray-700">{openaiLogs.length}</div>
            </div>
          </div>

          <div className="text-[11px] text-gray-500 space-y-1">
            <div>
              Last local request: <span className="text-gray-700">{formatLastSeen(latestAnyLog?.ts ?? null)}</span>
            </div>
            <div>
              Last OpenAI request: <span className="text-gray-700">{latestOpenaiLog ? `${formatLastSeen(latestOpenaiLog.ts)} - ${latestOpenaiLog.model || latestOpenaiLog.endpoint}` : "None seen today"}</span>
            </div>
          </div>

          {latestOpenaiFailure?.error_message && (
            <p className="text-[11px] leading-relaxed text-rose-600">
              Latest OpenAI error: {latestOpenaiFailure.error_message}
            </p>
          )}

          {proxyStatus.enabled && openaiLogs.length === 0 && (
            <p className="text-[11px] text-amber-600 leading-relaxed">
              Proxy is on, but no OpenAI traffic has been logged today. If GPT-5.4 usage is not moving, your client may not be using <code className="font-mono">OPENAI_BASE_URL=http://127.0.0.1:8788/v1</code>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
