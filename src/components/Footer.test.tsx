import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Footer } from "./Footer";
import { useStore } from "../store";

const apiMocks = vi.hoisted(() => ({
  clearAuthCookie: vi.fn(),
  setPreferences: vi.fn(),
  openLogsFolder: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("../lib/api", () => apiMocks);

function resetStore() {
  useStore.setState({
    isAuthenticated: true,
    cookie: "cookie-123",
    metrics: null,
    claudeUsage: null,
    claudeUsageError: null,
    codexUsage: null,
    codexUsageError: null,
    todayLogs: [],
    weekLogs: [],
    proxyStatus: { running: false, enabled: false },
    preferences: { poll_interval: 900000, tray_display: "tokens" },
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
    apiMocks.clearAuthCookie.mockResolvedValue(undefined);
    apiMocks.setPreferences.mockResolvedValue(undefined);
    apiMocks.openLogsFolder.mockResolvedValue(undefined);
    apiMocks.openUrl.mockResolvedValue(undefined);
  });

  it("opens the local logs folder from the footer", async () => {
    const user = userEvent.setup();
    render(<Footer />);

    await user.click(screen.getByRole("button", { name: "Open Logs" }));

    expect(apiMocks.openLogsFolder).toHaveBeenCalledTimes(1);
  });
});
