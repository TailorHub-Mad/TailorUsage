import { useState } from "react";
import { useStore } from "../../store";
import { startProxy, stopProxy, setProxySettings } from "../../lib/api";

export function ProxyToggle() {
  const { proxyStatus, setProxyStatus } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    </div>
  );
}
