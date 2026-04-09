import { useState } from "react";
import { useStore } from "../store";
import {
  clearAuthCookie,
  setPreferences as savePreferences,
  openLogsFolder,
  openUrl,
} from "../lib/api";
import type { Preferences } from "../lib/types";

const POLL_OPTIONS = [
  { label: "5m", value: 300000 },
  { label: "15m", value: 900000 },
  { label: "30m", value: 1800000 },
  { label: "1h", value: 3600000 },
];

export function Footer({ onRefresh }: { onRefresh?: () => void }) {
  const { preferences, setPreferences, signOut, updateInfo, appVersion } = useStore();
  const [spinning, setSpinning] = useState(false);

  const updatePrefs = async (update: Partial<Preferences>) => {
    const newPrefs = { ...preferences, ...update };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
  };

  const handleSignOut = async () => {
    await clearAuthCookie();
    signOut();
  };

  const handleRefresh = async () => {
    setSpinning(true);
    await onRefresh?.();
    setTimeout(() => setSpinning(false), 600);
  };

  const handleUpdate = () => {
    if (updateInfo?.download_url) {
      openUrl(updateInfo.download_url).catch(() => {});
    }
  };

  const handleOpenLogs = () => {
    openLogsFolder().catch(() => {});
  };

  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        {POLL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => updatePrefs({ poll_interval: opt.value })}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              preferences.poll_interval === opt.value
                ? "bg-gray-100 text-gray-700 font-medium"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {appVersion && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">v{appVersion}</span>
            {updateInfo?.available && (
              <button
                onClick={handleUpdate}
                title={`Update to v${updateInfo.latest_version}`}
                className="text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
              >
                ↑ v{updateInfo.latest_version}
              </button>
            )}
          </div>
        )}
        <button
          onClick={handleRefresh}
          title="Refresh now"
          className="text-gray-400 hover:text-gray-600 transition-colors"
          style={{ lineHeight: 1 }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transition: "transform 0.6s ease",
              transform: spinning ? "rotate(360deg)" : "rotate(0deg)",
            }}
          >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
        <button
          onClick={handleOpenLogs}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Open Logs
        </button>
        <button
          onClick={handleSignOut}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
