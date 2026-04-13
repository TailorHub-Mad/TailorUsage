import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Footer } from "./Footer";
import { useStore } from "../store";

const apiMocks = vi.hoisted(() => ({
  setPreferences: vi.fn(),
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
    preferences: { poll_interval: 900000, tray_display: "tokens", tray_source: "claude" },
    updateInfo: null,
    appVersion: "0.3.0",
    loading: false,
    error: null,
  });
}

describe("Footer", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    apiMocks.setPreferences.mockResolvedValue(undefined);
  });

  it("updates the polling interval preference", async () => {
    const user = userEvent.setup();
    render(<Footer />);

    await user.click(screen.getByRole("button", { name: "5m" }));

    expect(apiMocks.setPreferences).toHaveBeenCalledWith({
      poll_interval: 300000,
      tray_display: "tokens",
      tray_source: "claude",
    });
    expect(useStore.getState().preferences.poll_interval).toBe(300000);
  });
});
