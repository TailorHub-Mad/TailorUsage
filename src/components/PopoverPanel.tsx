import { useStore } from "../store";
import { usePolling } from "../hooks/usePolling";
import { UsageLimitsBar } from "./UsageLimitsBar";
import { ProxySwitch, ProxyToggle, useProxyToggleControl } from "./sections/ProxyToggle";
import { RealtimeSection } from "./sections/RealtimeSection";
import { TodaySection } from "./sections/TodaySection";
import { WeekSection } from "./sections/WeekSection";
import { Footer } from "./Footer";
import tailorLogo from "../../src-tauri/icons/new-icon.png";

export function PopoverPanel() {
  const { refresh } = usePolling();
  const { loading, error, proxyStatus } = useStore();
  const { loading: proxyLoading, error: proxyError, handleProxyToggle } = useProxyToggleControl();

  return (
    <div className="h-full p-2 flex flex-col">
      {/* Card with drop shadow */}
      <div
        className="flex-1 bg-white rounded-2xl flex flex-col overflow-hidden"
        style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)" }}
      >
        {/* Loading bar */}
        {loading && (
          <div className="h-0.5 bg-gray-100 overflow-hidden rounded-t-2xl">
            <div className="h-full w-1/3 bg-gray-400 animate-pulse" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-50 text-red-500 text-xs border-b border-red-100">
            {error}
          </div>
        )}

        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <img src={tailorLogo} alt="Tailor" className="h-7 w-7 rounded-md object-contain" />
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                proxyStatus.enabled ? "bg-green-400" : "bg-red-400"
              }`}
            />
            <span className="text-sm text-gray-600">
              {proxyStatus.enabled ? "Proxy Active" : "Proxy inactive"}
            </span>
            <ProxySwitch
              enabled={proxyStatus.enabled}
              loading={proxyLoading}
              onToggle={handleProxyToggle}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <UsageLimitsBar />
          <RealtimeSection />
          <Divider />
          <TodaySection />
          <Divider />
          <WeekSection />
          <Divider />
          <ProxyToggle error={proxyError} />
        </div>

        <div className="border-t border-gray-100">
          <Footer onRefresh={refresh} />
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-gray-100 mx-4" />;
}
