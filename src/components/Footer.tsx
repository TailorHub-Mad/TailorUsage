import { useStore } from "../store";
import { clearAuthCookie, setPreferences as savePreferences } from "../lib/api";
import type { Preferences } from "../lib/types";

const POLL_OPTIONS = [
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "5m", value: 300000 },
];

export function Footer() {
  const { preferences, setPreferences, signOut } = useStore();

  const updatePrefs = async (update: Partial<Preferences>) => {
    const newPrefs = { ...preferences, ...update };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
  };

  const handleSignOut = async () => {
    await clearAuthCookie();
    signOut();
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
        <span className="text-gray-200 text-xs">|</span>
        <button
          onClick={() =>
            updatePrefs({
              tray_display: preferences.tray_display === "cost" ? "tokens" : "cost",
            })
          }
          className="px-2 py-1 text-xs rounded-md text-gray-400 hover:text-gray-600 transition-colors"
          title="Toggle tray display: cost or tokens"
        >
          {preferences.tray_display === "cost" ? "$ tray" : "T tray"}
        </button>
      </div>

      <button
        onClick={handleSignOut}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
