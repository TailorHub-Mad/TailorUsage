import { useRef, useEffect, useState } from "react";
import { useStore } from "../store";
import { usePolling } from "../hooks/usePolling";
import { UsageLimitsBar } from "./UsageLimitsBar";
import { ProxySwitch, ProxyToggle, ProxyMessage, useProxyToggleControl } from "./sections/ProxyToggle";
import { WeekSection } from "./sections/WeekSection";
import { Footer } from "./Footer";
import { SettingsPanel } from "./SettingsPanel";
import { resizeWindow, openUrl } from "../lib/api";
import tailorLogo from "../../src-tauri/icons/new-icon.png";

const OUTER_PADDING = 16;

export function PopoverPanel() {
  const { refresh } = usePolling();
  const { loading, error, proxyStatus, updateInfo } = useStore();
  const { loading: proxyLoading, error: proxyError, showMessage, handleProxyToggle } = useProxyToggleControl();
  const [showSettings, setShowSettings] = useState(false);
  const [mainContentHeight, setMainContentHeight] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0].contentRect.height;
      resizeWindow(height + OUTER_PADDING * 2).catch(() => {});
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="p-4">
      {/* Card with drop shadow */}
      <div
        ref={cardRef}
        className="bg-white rounded-xl flex flex-col overflow-hidden"
        style={{ boxShadow: "0 8px 20px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.07)" }}
      >
        {/* Loading bar */}
        {loading && (
          <div className="h-0.5 bg-gray-100 overflow-hidden rounded-t-xl">
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
          <div className="flex items-center gap-2">
            <img src={tailorLogo} alt="Tailor" className="h-7 w-7 rounded-md object-contain" />
            <span className="text-sm font-semibold text-gray-900 tracking-tight">TailorUsage</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                proxyStatus.enabled ? "bg-green-400" : "bg-red-400"
              }`}
            />
            <span className="text-sm text-gray-600">
              {proxyStatus.enabled ? "Proxy active" : "Proxy inactive"}
            </span>
            <ProxySwitch
              enabled={proxyStatus.enabled}
              loading={proxyLoading}
              onToggle={handleProxyToggle}
            />
          </div>
        </div>

        {/* Temporary message below toggle */}
        <div className="px-4 h-2">
          {showMessage && <ProxyMessage show={showMessage} />}
        </div>

        {/* Update banner */}
        {updateInfo?.available && (
          <button
            onClick={() => openUrl(updateInfo.download_url).catch(() => {})}
            className="mx-3 mt-2 flex cursor-pointer items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 transition-colors hover:bg-amber-100 border border-amber-200/70"
          >
            <div className="flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>v{updateInfo.latest_version} available</span>
            </div>
            <span className="font-medium">Download update →</span>
          </button>
        )}

        {showSettings ? (
          <div className="border-t border-gray-100" style={mainContentHeight ? { minHeight: mainContentHeight } : {}}>
            <SettingsPanel onClose={() => setShowSettings(false)} />
          </div>
        ) : (
          <div ref={mainContentRef}>
            <UsageLimitsBar />
            <Divider />
            <WeekSection />
            <ProxyToggle error={proxyError} />
          </div>
        )}

        <div className="border-t border-gray-100">
          <Footer onRefresh={refresh} onSettings={() => {
            if (!showSettings && mainContentRef.current) {
              setMainContentHeight(mainContentRef.current.offsetHeight);
            }
            setShowSettings((s) => !s);
          }} />
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-gray-100 mx-4" />;
}
