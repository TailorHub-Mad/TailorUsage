import { useStore } from "../store";
import {
  setPreferences as savePreferences,
  setLaunchAtLogin as saveLaunchAtLogin,
  setHideFromDock as saveHideFromDock,
  openLogsFolder,
} from "../lib/api";
import type { Preferences } from "../lib/types";

const TRAY_SOURCE_OPTIONS: { label: string; value: Preferences["tray_source"] }[] = [
  { label: "Claude", value: "claude" },
  { label: "OpenAI", value: "openai" },
];

const NOTIFICATION_THRESHOLD_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Off", value: null },
  { label: "70%", value: 70 },
  { label: "80%", value: 80 },
  { label: "90%", value: 90 },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { preferences, setPreferences, launchAtLogin, setLaunchAtLogin, hideFromDock, setHideFromDock } = useStore();

  const updatePrefs = async (update: Partial<Preferences>) => {
    const newPrefs = { ...preferences, ...update };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
  };

  const handleLaunchAtLoginToggle = async () => {
    const next = !launchAtLogin;
    setLaunchAtLogin(next);
    await saveLaunchAtLogin(next).catch(() => setLaunchAtLogin(!next));
  };

  const handleHideFromDockToggle = async () => {
    const next = !hideFromDock;
    setHideFromDock(next);
    await saveHideFromDock(next).catch(() => setHideFromDock(!next));
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-gray-900">Settings</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          title="Close settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Launch at login</p>
          <button
            onClick={handleLaunchAtLoginToggle}
            aria-label={launchAtLogin ? "Disable launch at login" : "Enable launch at login"}
            className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${
              launchAtLogin ? "bg-green-400" : "bg-gray-200"
            }`}
          >
            <div
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                launchAtLogin ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Hide from dock</p>
          <button
            onClick={handleHideFromDockToggle}
            aria-label={hideFromDock ? "Show in dock" : "Hide from dock"}
            className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${
              hideFromDock ? "bg-green-400" : "bg-gray-200"
            }`}
          >
            <div
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                hideFromDock ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Tray percentage source</p>
          <div className="flex gap-1.5">
            {TRAY_SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => updatePrefs({ tray_source: opt.value })}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                  preferences.tray_source === opt.value
                    ? "bg-gray-100 text-gray-700 font-medium"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Notify when usage above</p>
          <div className="flex gap-1.5">
            {NOTIFICATION_THRESHOLD_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => updatePrefs({ notification_threshold: opt.value })}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                  preferences.notification_threshold === opt.value
                    ? "bg-gray-100 text-gray-700 font-medium"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Debug logs</p>
          <button
            onClick={() => openLogsFolder().catch(() => {})}
            className="text-xs font-medium text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors hover:text-gray-700 cursor-pointer"
          >
            Open Logs
          </button>
        </div>
      </div>
    </div>
  );
}
