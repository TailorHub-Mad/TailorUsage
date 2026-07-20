import { useStore } from "../store";
import {
  setPreferences as savePreferences,
  setLaunchAtLogin as saveLaunchAtLogin,
  setHideFromDock as saveHideFromDock,
} from "../lib/api";
import type { Preferences, ProviderId } from "../lib/types";

const TRAY_SOURCE_OPTIONS: { label: string; value: Preferences["tray_source"] }[] = [
  { label: "Claude", value: "claude" },
  { label: "OpenAI", value: "openai" },
];

const PROVIDER_OPTIONS: { label: string; value: ProviderId }[] = [
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

  const toggleProvider = async (provider: ProviderId) => {
    const isVisible = preferences.visible_providers.includes(provider);
    if (isVisible && preferences.visible_providers.length === 1) return;

    const visibleProviders = isVisible
      ? preferences.visible_providers.filter((value) => value !== provider)
      : [...preferences.visible_providers, provider];
    const update: Partial<Preferences> = { visible_providers: visibleProviders };

    if (isVisible && preferences.tray_source === provider) {
      update.tray_source = visibleProviders[0];
    }

    await updatePrefs(update);
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
    <div className="settings-panel">
      <div className="settings-header">
        <span className="settings-title">Settings</span>
        <button
          onClick={onClose}
          className="icon-button"
          title="Close settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="settings-list">
        <div className="settings-row">
          <p>Launch at login</p>
          <button
            onClick={handleLaunchAtLoginToggle}
            aria-label={launchAtLogin ? "Disable launch at login" : "Enable launch at login"}
            className={`switch-control ${launchAtLogin ? "is-enabled" : "is-disabled"}`}
          >
            <div className="switch-thumb" />
          </button>
        </div>

        <div className="settings-row">
          <p>Hide from dock</p>
          <button
            onClick={handleHideFromDockToggle}
            aria-label={hideFromDock ? "Show in dock" : "Hide from dock"}
            className={`switch-control ${hideFromDock ? "is-enabled" : "is-disabled"}`}
          >
            <div className="switch-thumb" />
          </button>
        </div>

        <div className="settings-row settings-row-wide">
          <p>Show providers</p>
          <div className="segmented-control">
            {PROVIDER_OPTIONS.map((provider) => {
              const isVisible = preferences.visible_providers.includes(provider.value);
              const isOnlyVisibleProvider = isVisible && preferences.visible_providers.length === 1;

              return (
                <button
                  key={provider.value}
                  type="button"
                  onClick={() => toggleProvider(provider.value)}
                  aria-label={`${isVisible ? "Hide" : "Show"} ${provider.label} provider`}
                  aria-pressed={isVisible}
                  disabled={isOnlyVisibleProvider}
                  title={isOnlyVisibleProvider ? "At least one provider must remain visible" : undefined}
                  className={`segment-option provider-option ${isVisible ? "is-selected" : ""} ${
                    isOnlyVisibleProvider ? "is-locked" : ""
                  }`}
                >
                  <span
                    className={`check-indicator ${isVisible ? "is-checked" : ""}`}
                    aria-hidden="true"
                  >
                    {isVisible && (
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6.25 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {provider.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="settings-row settings-row-wide">
          <p>Tray percentage source</p>
          <div className="segmented-control">
            {TRAY_SOURCE_OPTIONS.filter((opt) => preferences.visible_providers.includes(opt.value)).map((opt) => (
              <button
                key={opt.value}
                onClick={() => updatePrefs({ tray_source: opt.value })}
                className={`segment-option ${
                  preferences.tray_source === opt.value ? "is-selected" : ""
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row settings-row-wide">
          <p>Notify when usage above</p>
          <div className="segmented-control">
            {NOTIFICATION_THRESHOLD_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => updatePrefs({ notification_threshold: opt.value })}
                className={`segment-option ${
                  preferences.notification_threshold === opt.value ? "is-selected" : ""
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
