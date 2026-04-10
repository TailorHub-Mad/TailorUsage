import { useStore } from "../store";
import { setPreferences as savePreferences } from "../lib/api";
import type { Preferences } from "../lib/types";

const TRAY_SOURCE_OPTIONS: { label: string; value: Preferences["tray_source"] }[] = [
  { label: "Auto", value: "auto" },
  { label: "Claude", value: "claude" },
  { label: "OpenAI", value: "openai" },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { preferences, setPreferences } = useStore();

  const updatePrefs = async (update: Partial<Preferences>) => {
    const newPrefs = { ...preferences, ...update };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
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
        <div>
          <p className="text-xs text-gray-500 mb-2">Tray percentage source</p>
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
          <p className="text-xs text-gray-400 mt-1.5">
            {preferences.tray_source === "auto"
              ? "Shows the most recently active provider"
              : preferences.tray_source === "claude"
              ? "Always shows Claude utilization"
              : "Always shows OpenAI utilization"}
          </p>
        </div>
      </div>
    </div>
  );
}
