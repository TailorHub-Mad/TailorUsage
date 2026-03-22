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

function isoDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("usePolling", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("hydrates dashboard state from local logs and API data", async () => {
    const today = isoDate(0);
    const yesterday = isoDate(-1);

    apiMocks.readLocalLogs.mockImplementation(async (date: string) => {
      if (date === today) {
        return [
          {
            ts: `${today}T10:00:00.000Z`,
            request_id: "local-today-1",
            developer_id: "dev-a",
            repo: "tailor-bar",
            model: "claude-sonnet-4",
            input_tokens: 1000,
            output_tokens: 500,
          },
        ];
      }

      return [];
    });
    apiMocks.fetchMetrics.mockResolvedValue({
      metrics: [
        {
          developer_id: "dev-a",
          total_tokens_1h: 1500,
          opus_tokens_1h: 0,
          opus_streak: 0,
          last_updated: `${today}T10:00:00.000Z`,
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
                  ts: `${yesterday}T10:00:00.000Z`,
                  request_id: "remote-yesterday-1",
                  developer_id: "dev-a",
                  repo: "tailor-bar",
                  model: "claude-sonnet-4",
                  input_tokens: 200,
                  output_tokens: 100,
                },
                {
                  ts: `${yesterday}T11:00:00.000Z`,
                  request_id: "remote-yesterday-2",
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
      expect(useStore.getState().weekLogs).toHaveLength(2);
    });

    expect(useStore.getState().metrics?.developer_id).toBe("dev-a");
    expect(useStore.getState().weekLogs.every((log) => log.developer_id === "dev-a")).toBe(true);
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

  it("merges local today logs into week activity when API data is empty", async () => {
    const today = isoDate(0);
    const yesterday = isoDate(-1);

    apiMocks.readLocalLogs.mockImplementation(async (date: string) => {
      if (date === today) {
        return [
          {
            ts: `${today}T10:00:00.000Z`,
            request_id: "local-1",
            developer_id: "dev-a",
            repo: "tailor-bar",
            model: "claude-sonnet-4",
            input_tokens: 1000,
            output_tokens: 500,
          },
        ];
      }

      if (date === yesterday) {
        return [
          {
            ts: `${yesterday}T09:00:00.000Z`,
            request_id: "local-yesterday-1",
            developer_id: "dev-a",
            repo: "tailor-bar",
            model: "claude-sonnet-4",
            input_tokens: 700,
            output_tokens: 300,
          },
        ];
      }

      return [];
    });
    apiMocks.fetchMetrics.mockResolvedValue({
      metrics: [
        {
          developer_id: "dev-a",
          total_tokens_1h: 1500,
          opus_tokens_1h: 0,
          opus_streak: 0,
          last_updated: `${today}T10:00:00.000Z`,
          warning_flag: false,
        },
      ],
    });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);
    apiMocks.getProxySettings.mockResolvedValue({ share_diagnostics: false });

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(useStore.getState().weekLogs).toHaveLength(2);
    });

    expect(useStore.getState().weekLogs.map((log) => log.request_id)).toEqual([
      "local-yesterday-1",
      "local-1",
    ]);
  });

  it("prefers a known developer id over unknown local entries", async () => {
    const today = isoDate(0);
    const yesterday = isoDate(-1);

    apiMocks.readLocalLogs.mockImplementation(async (date: string) => {
      if (date === today) {
        return [
          {
            ts: `${today}T08:00:00.000Z`,
            request_id: "unknown-local-1",
            developer_id: "unknown",
            repo: "unknown",
            model: "claude-sonnet-4",
            input_tokens: 10,
            output_tokens: 5,
          },
          {
            ts: `${today}T09:00:00.000Z`,
            request_id: "known-local-1",
            developer_id: "dev-a",
            repo: "tailor-bar",
            model: "claude-sonnet-4",
            input_tokens: 10,
            output_tokens: 5,
          },
        ];
      }

      if (date === yesterday) {
        return [
          {
            ts: `${yesterday}T09:00:00.000Z`,
            request_id: "known-local-2",
            developer_id: "dev-a",
            repo: "tailor-bar",
            model: "claude-sonnet-4",
            input_tokens: 10,
            output_tokens: 5,
          },
        ];
      }

      return [];
    });
    apiMocks.fetchMetrics.mockResolvedValue({
      metrics: [
        {
          developer_id: "dev-a",
          total_tokens_1h: 15,
          opus_tokens_1h: 0,
          opus_streak: 0,
          last_updated: `${today}T10:00:00.000Z`,
          warning_flag: false,
        },
      ],
    });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);
    apiMocks.getProxySettings.mockResolvedValue({ share_diagnostics: false });

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(useStore.getState().weekLogs).toHaveLength(2);
    });

    expect(useStore.getState().weekLogs.every((log) => log.developer_id === "dev-a")).toBe(true);
    expect(useStore.getState().weekLogs.every((log) => log.repo === "tailor-bar")).toBe(true);
  });
});
