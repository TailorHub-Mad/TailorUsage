import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";
import { useStore } from "../store";

const apiMocks = vi.hoisted(() => ({
  fetchMetrics: vi.fn(),
  fetchUsage: vi.fn(),
  readLocalLogs: vi.fn(),
  getProxyEnabled: vi.fn(),
  getProxySettings: vi.fn(),
  setTrayTitle: vi.fn(),
  clearAuthCookie: vi.fn(),
}));

vi.mock("../lib/api", () => apiMocks);

function resetStore() {
  useStore.setState({
    isAuthenticated: true,
    cookie: "cookie-123",
    metrics: null,
    todayLogs: [],
    weekLogs: [],
    proxyStatus: { running: false, enabled: false, shareDiagnostics: false },
    preferences: { poll_interval: 60000, tray_display: "cost" },
    loading: false,
    error: null,
  });
}

describe("usePolling", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("hydrates dashboard state from local logs and API data", async () => {
    apiMocks.readLocalLogs.mockResolvedValue([
      {
        ts: "2026-03-20T10:00:00.000Z",
        developer_id: "dev-a",
        repo: "tailor-bar",
        model: "claude-sonnet-4",
        input_tokens: 1000,
        output_tokens: 500,
      },
    ]);
    apiMocks.fetchMetrics.mockResolvedValue({
      metrics: [
        {
          developer_id: "dev-a",
          total_tokens_1h: 1500,
          opus_tokens_1h: 0,
          opus_streak: 0,
          last_updated: "2026-03-20T10:00:00.000Z",
          warning_flag: false,
        },
      ],
    });
    apiMocks.fetchUsage.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              data: [
                {
                  ts: "2026-03-19T10:00:00.000Z",
                  developer_id: "dev-a",
                  repo: "tailor-bar",
                  model: "claude-sonnet-4",
                  input_tokens: 200,
                  output_tokens: 100,
                },
                {
                  ts: "2026-03-19T11:00:00.000Z",
                  developer_id: "dev-b",
                  repo: "other-repo",
                  model: "gpt-4o",
                  input_tokens: 999,
                  output_tokens: 999,
                },
              ],
            });
          }, 10);
        }),
    );
    apiMocks.getProxyEnabled.mockResolvedValue(true);
    apiMocks.getProxySettings.mockResolvedValue({ share_diagnostics: true });

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(useStore.getState().todayLogs).toHaveLength(1);
      expect(useStore.getState().weekLogs).toHaveLength(1);
    });

    expect(useStore.getState().metrics?.developer_id).toBe("dev-a");
    expect(useStore.getState().weekLogs[0]?.developer_id).toBe("dev-a");
    expect(useStore.getState().proxyStatus).toEqual({
      running: true,
      enabled: true,
      shareDiagnostics: true,
    });
    expect(apiMocks.setTrayTitle).toHaveBeenCalledWith("$0.01");
    expect(useStore.getState().error).toBeNull();
  });

  it("clears auth and signs out after an unauthorized retry failure", async () => {
    vi.useFakeTimers();
    apiMocks.readLocalLogs.mockResolvedValue([]);
    apiMocks.fetchMetrics.mockRejectedValue(new Error("unauthorized"));
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);
    apiMocks.getProxySettings.mockResolvedValue({ share_diagnostics: false });

    const { unmount } = renderHook(() => usePolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(apiMocks.clearAuthCookie).toHaveBeenCalledTimes(1);
    expect(useStore.getState().isAuthenticated).toBe(false);

    expect(apiMocks.fetchMetrics).toHaveBeenCalledTimes(2);
    expect(useStore.getState().cookie).toBeNull();
    expect(useStore.getState().error).toBeNull();

    unmount();
    vi.useRealTimers();
  });
});
