import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthScreen } from "./AuthScreen";
import { useStore } from "../store";

const apiMocks = vi.hoisted(() => ({
  setAuthCookie: vi.fn(),
  startAuthFlow: vi.fn(),
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
    preferences: { poll_interval: 900000, tray_display: "cost" },
    loading: false,
    error: null,
  });
}

describe("AuthScreen", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("starts the hosted auth flow", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);

    await user.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(apiMocks.startAuthFlow).toHaveBeenCalledTimes(1);
  });

  it("accepts a trimmed manual cookie and authenticates the store", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);

    await user.click(screen.getByRole("button", { name: "Enter session cookie manually" }));
    await user.type(screen.getByPlaceholderText("Paste cookie value..."), "  session-cookie  ");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(apiMocks.setAuthCookie).toHaveBeenCalledWith("session-cookie");
    expect(useStore.getState().isAuthenticated).toBe(true);
    expect(useStore.getState().cookie).toBe("session-cookie");
  });

  it("ignores empty manual cookie submissions", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);

    await user.click(screen.getByRole("button", { name: "Enter session cookie manually" }));
    await user.type(screen.getByPlaceholderText("Paste cookie value..."), "   ");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(apiMocks.setAuthCookie).not.toHaveBeenCalled();
    expect(useStore.getState().isAuthenticated).toBe(false);
  });
});
