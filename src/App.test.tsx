import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useStore } from "./store";

const apiMocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  getAppVersion: vi.fn(),
  getHideFromDock: vi.fn(),
  getLaunchAtLogin: vi.fn(),
  getPreferences: vi.fn(),
}));

vi.mock("./components/PopoverPanel", () => ({
  PopoverPanel: () => <div>Popover</div>,
}));

vi.mock("./lib/api", () => apiMocks);

function resetStore() {
  useStore.setState({
    isAuthenticated: false,
    cookie: null,
    metrics: null,
    claudeUsage: null,
    claudeUsageError: null,
    codexUsage: null,
    codexUsageError: null,
    codexReadStatus: { status: "ok", detail: null },
    openAiLogDiagnostic: null,
    todayLogs: [],
    weekLogs: [],
    proxyStatus: { running: false, enabled: false },
    preferences: {
      poll_interval: 900000,
      tray_display: "tokens",
      tray_source: "claude",
      notification_threshold: null,
      visible_providers: ["claude", "openai"],
    },
    updateInfo: null,
    appVersion: "",
    launchAtLogin: false,
    hideFromDock: false,
    loading: false,
    error: null,
  });
}

describe("App", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    apiMocks.getAppVersion.mockResolvedValue("0.7.0");
    apiMocks.checkForUpdate.mockResolvedValue({
      available: false,
      latest_version: "",
      download_url: "",
    });
    apiMocks.getPreferences.mockResolvedValue({
      poll_interval: 300000,
      tray_display: "cost",
      tray_source: "openai",
      notification_threshold: 80,
      visible_providers: ["openai"],
    });
    apiMocks.getLaunchAtLogin.mockResolvedValue(true);
    apiMocks.getHideFromDock.mockResolvedValue(true);
  });

  it("hydrates persisted settings on startup", async () => {
    render(<App />);

    expect(screen.getByText("Popover")).toBeInTheDocument();

    await waitFor(() => {
      expect(useStore.getState().preferences).toEqual({
        poll_interval: 300000,
        tray_display: "cost",
        tray_source: "openai",
        notification_threshold: 80,
        visible_providers: ["openai"],
      });
      expect(useStore.getState().launchAtLogin).toBe(true);
      expect(useStore.getState().hideFromDock).toBe(true);
    });
  });
});
