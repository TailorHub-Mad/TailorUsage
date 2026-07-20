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
    <div className="app-shell">
      <div
        ref={cardRef}
        className="terminal-panel"
      >
        {loading && (
          <div className="loading-track">
            <div className="loading-beam" />
          </div>
        )}

        {error && (
          <div className="global-error">
            {error}
          </div>
        )}

        <div className="panel-header">
          <div className="brand-lockup">
            <div className="brand-mark">
              <img src={tailorLogo} alt="Tailor" />
            </div>
            <span className="brand-name">TailorUsage</span>
          </div>
          <div className="proxy-control">
            <div
              className={`status-light ${proxyStatus.enabled ? "is-active" : "is-inactive"}`}
            />
            <span className="proxy-status">
              {proxyStatus.enabled ? "Proxy active" : "Proxy inactive"}
            </span>
            <ProxySwitch
              enabled={proxyStatus.enabled}
              loading={proxyLoading}
              onToggle={handleProxyToggle}
            />
          </div>
        </div>

        <div className="proxy-message-slot">
          {showMessage && <ProxyMessage show={showMessage} />}
        </div>

        {updateInfo?.available && (
          <button
            onClick={() => openUrl(updateInfo.download_url).catch(() => {})}
            className="update-banner"
          >
            <div className="update-title">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>v{updateInfo.latest_version} available</span>
            </div>
            <span className="update-action">Download update →</span>
          </button>
        )}

        {showSettings ? (
          <div className="panel-content settings-content" style={mainContentHeight ? { minHeight: mainContentHeight } : {}}>
            <SettingsPanel onClose={() => setShowSettings(false)} />
          </div>
        ) : (
          <div ref={mainContentRef} className="panel-content">
            <UsageLimitsBar />
            <Divider />
            <WeekSection />
            <ProxyToggle error={proxyError} />
          </div>
        )}

        <div className="panel-footer">
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
  return <div className="section-divider" />;
}
