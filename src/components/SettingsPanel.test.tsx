import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { useStore } from "../store";

const apiMocks = vi.hoisted(() => ({
  openLogsFolder: vi.fn(),
  setPreferences: vi.fn(),
  setLaunchAtLogin: vi.fn(),
  setHideFromDock: vi.fn(),
}));

vi.mock("../lib/api", () => apiMocks);

function resetStore() {
  useStore.setState({
    isAuthenticated: false,
    cookie: null,
    metrics: null,
    claudeUsage: null,
    claudeUsageError: null,
    codexUsage: null,
    codexUsageError: null,
    todayLogs: [],
    weekLogs: [],
    proxyStatus: { running: false, enabled: false },
    preferences: {
      poll_interval: 900000,
      tray_display: "tokens",
      tray_source: "claude",
      notification_threshold: null,
    },
    updateInfo: null,
    appVersion: "0.3.0",
    launchAtLogin: false,
    hideFromDock: false,
    loading: false,
    error: null,
  });
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    apiMocks.openLogsFolder.mockResolvedValue(undefined);
    apiMocks.setPreferences.mockResolvedValue(undefined);
    apiMocks.setLaunchAtLogin.mockResolvedValue(undefined);
    apiMocks.setHideFromDock.mockResolvedValue(undefined);
  });

  it("opens the logs folder from the debug link", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Open Logs" }));

    expect(apiMocks.openLogsFolder).toHaveBeenCalledTimes(1);
  });
});
