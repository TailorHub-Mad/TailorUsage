import { useStore } from "../../store";
import { setProxySettings } from "../../lib/api";

export function ProxyToggle() {
  const { proxyStatus, setProxyStatus } = useStore();
  const isActive = proxyStatus.running && proxyStatus.shareDiagnostics;

  const handleToggle = async () => {
    if (!proxyStatus.running) return;
    const newVal = !proxyStatus.shareDiagnostics;
    try {
      await setProxySettings(newVal);
      setProxyStatus({ ...proxyStatus, shareDiagnostics: newVal });
    } catch (e) {
      console.error("Failed to update proxy settings:", e);
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${isActive ? "bg-green-400" : "bg-gray-300"}`}
        />
        <span className="text-sm text-gray-600">
          {proxyStatus.running ? "Proxy" : "Proxy not running"}
        </span>
      </div>
      {proxyStatus.running && (
        <button
          onClick={handleToggle}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            proxyStatus.shareDiagnostics ? "bg-green-400" : "bg-gray-200"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              proxyStatus.shareDiagnostics ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      )}
    </div>
  );
}
