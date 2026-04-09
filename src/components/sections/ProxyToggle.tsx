import { useState } from "react";
import { useStore } from "../../store";
import { startProxy, stopProxy } from "../../lib/api";

type ProxySwitchProps = {
  enabled: boolean;
  loading?: boolean;
  onToggle: () => void;
};

export function ProxySwitch({ enabled, loading = false, onToggle }: ProxySwitchProps) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      aria-label={enabled ? "Disable proxy" : "Enable proxy"}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        enabled ? "bg-green-400" : "bg-red-300"
      } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

type ProxyToggleProps = {
  error?: string | null;
};

export function useProxyToggleControl() {
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
      if (msg.toLowerCase().includes("already running")) {
        setProxyStatus({ ...proxyStatus, enabled: true, running: true });
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, handleProxyToggle };
}

export function ProxyToggle({ error = null }: ProxyToggleProps) {
  const { proxyStatus } = useStore();

  return (
    <div className="px-4 py-3 space-y-2">
      {/* Port status indicators */}
      {proxyStatus.enabled && (
        <div className="flex gap-3 text-xs text-gray-400">
          <span>Anthropic :8787</span>
          <span>OpenAI :8788</span>
        </div>
      )}

      {/* Hint */}
      <p className="text-xs text-gray-300">
        Open a new terminal for {proxyStatus.enabled ? "proxy" : "this change"} to take effect.
      </p>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
