import { useState, useEffect } from "react";
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
      className={`switch-control ${enabled ? "is-enabled" : "is-disabled"} ${
        loading ? "is-loading" : ""
      }`}
    >
      <div
        className="switch-thumb"
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
  const [showMessage, setShowMessage] = useState(false);

  useEffect(() => {
    if (showMessage) {
      const timer = setTimeout(() => setShowMessage(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [showMessage]);

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
      setShowMessage(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("already running")) {
        setProxyStatus({ ...proxyStatus, enabled: true, running: true });
        setShowMessage(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, showMessage, handleProxyToggle };
}

export function ProxyToggle({ error = null }: ProxyToggleProps) {
  return (
    <div className={`proxy-error-slot ${error ? "has-error" : ""}`}>
      {error && (
        <p>{error}</p>
      )}
    </div>
  );
}

export function ProxyMessage({ show }: { show: boolean }) {
  const { proxyStatus } = useStore();
  const [isVisible, setIsVisible] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (show) {
      setIsMounted(true);
      setIsVisible(true);
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => setIsMounted(false), 400);
      return () => clearTimeout(timer);
    }
  }, [show]);

  if (!isMounted) return null;

  return (
    <p className={`proxy-message ${
      isVisible ? "is-visible" : ""
    }`}>
      Open a new terminal for {proxyStatus.enabled ? "proxy" : "this change"} to take effect.
    </p>
  );
}
