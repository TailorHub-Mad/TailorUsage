import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";
import { useStore } from "../store";

const apiMocks = vi.hoisted(() => ({
  fetchClaudeUsage: vi.fn(),
  fetchCodexUsage: vi.fn(),
  fetchMetrics: vi.fn(),
  fetchUsage: vi.fn(),
  readLocalLogs: vi.fn(),
  getProxyEnabled: vi.fn(),
  setTrayTitle: vi.fn(),
  forwardLogsToDashboard: vi.fn(),
}));

vi.mock("../lib/api", () => apiMocks);

function resetStore() {
  useStore.setState({
    isAuthenticated: false,
    cookie: "cookie-123",
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
    apiMocks.forwardLogsToDashboard.mockResolvedValue(0);
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
    apiMocks.fetchClaudeUsage.mockResolvedValue(null);
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
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
    });
    expect(apiMocks.setTrayTitle).toHaveBeenCalledWith("$0.01");
    expect(useStore.getState().error).toBeNull();
  });

  it("shows daily usage percent in the tray when token display is selected", async () => {
    const today = isoDate(0);

    useStore.setState({
      preferences: { poll_interval: 900000, tray_display: "tokens" },
    });

    apiMocks.readLocalLogs.mockResolvedValue([
      {
        ts: `${today}T10:00:00.000Z`,
        request_id: "local-today-1",
        developer_id: "dev-a",
        repo: "tailor-bar",
        model: "claude-sonnet-4",
        input_tokens: 1000,
        output_tokens: 500,
      },
    ]);
    apiMocks.fetchClaudeUsage.mockResolvedValue(null);
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
    apiMocks.fetchMetrics.mockResolvedValue({ metrics: [] });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(apiMocks.setTrayTitle).toHaveBeenCalledWith("<1%");
    });
  });

  it("uses exact Claude session usage in the tray when available", async () => {
    const today = isoDate(0);

    useStore.setState({
      preferences: { poll_interval: 900000, tray_display: "tokens" },
    });

    apiMocks.readLocalLogs.mockResolvedValue([
      {
        ts: `${today}T10:00:00.000Z`,
        request_id: "local-today-1",
        developer_id: "dev-a",
        repo: "tailor-bar",
        model: "claude-sonnet-4",
        input_tokens: 1000,
        output_tokens: 500,
      },
    ]);
    apiMocks.fetchClaudeUsage.mockResolvedValue({
      five_hour: { utilization: 17, resets_at: "2026-03-26T18:00:00.000Z" },
      seven_day: { utilization: 23, resets_at: "2026-03-28T18:00:00.000Z" },
    });
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
    apiMocks.fetchMetrics.mockResolvedValue({ metrics: [] });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(apiMocks.setTrayTitle).toHaveBeenCalledWith("17%");
    });
  });

  it("uses exact Codex session usage when the latest activity is openai", async () => {
    const today = isoDate(0);

    useStore.setState({
      preferences: { poll_interval: 900000, tray_display: "tokens" },
    });

    apiMocks.readLocalLogs.mockResolvedValue([
      {
        ts: `${today}T10:00:00.000Z`,
        request_id: "local-claude-1",
        developer_id: "dev-a",
        repo: "tailor-bar",
        provider: "anthropic",
        model: "claude-sonnet-4",
        input_tokens: 100,
        output_tokens: 100,
      },
      {
        ts: `${today}T11:00:00.000Z`,
        request_id: "local-codex-1",
        developer_id: "dev-a",
        repo: "tailor-bar",
        provider: "openai",
        model: "gpt-5-codex",
        input_tokens: 100,
        output_tokens: 100,
      },
    ]);
    apiMocks.fetchClaudeUsage.mockResolvedValue({
      five_hour: { utilization: 17, resets_at: "2026-03-26T18:00:00.000Z" },
    });
    apiMocks.fetchCodexUsage.mockResolvedValue({
      rate_limit: {
        primary_window: { used_percent: 6, reset_at: 1774556460, limit_window_seconds: 18000 },
      },
    });
    apiMocks.fetchMetrics.mockResolvedValue({ metrics: [] });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(apiMocks.setTrayTitle).toHaveBeenCalledWith("6%");
    });
  });

  it("stores a Claude 429 as a provider usage error without failing the whole poll", async () => {
    const today = isoDate(0);

    apiMocks.readLocalLogs.mockResolvedValue([
      {
        ts: `${today}T10:00:00.000Z`,
        request_id: "local-today-1",
        developer_id: "dev-a",
        repo: "tailor-bar",
        model: "claude-sonnet-4",
        input_tokens: 1000,
        output_tokens: 500,
      },
    ]);
    apiMocks.fetchClaudeUsage.mockRejectedValue(new Error("claude_usage_failed:429 Too Many Requests"));
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
    apiMocks.fetchMetrics.mockResolvedValue({ metrics: [] });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(useStore.getState().claudeUsageError).toBe(
        "Usage request failed (HTTP 429). Try again later.",
      );
    });

    expect(useStore.getState().error).toBeNull();
  });

  it("includes reset time in Claude 429 error when retry-after timestamp is present", async () => {
    const today = isoDate(0);
    const retryAt = Math.floor(Date.now() / 1000) + 3 * 60 * 60; // 3h from now

    apiMocks.readLocalLogs.mockResolvedValue([
      {
        ts: `${today}T10:00:00.000Z`,
        request_id: "local-today-2",
        developer_id: "dev-a",
        repo: "tailor-bar",
        model: "claude-sonnet-4",
        input_tokens: 100,
        output_tokens: 50,
      },
    ]);
    apiMocks.fetchClaudeUsage.mockRejectedValue(
      new Error(`claude_usage_failed:429 Too Many Requests:${retryAt}`),
    );
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
    apiMocks.fetchMetrics.mockResolvedValue({ metrics: [] });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    renderHook(() => usePolling());

    await waitFor(() => {
      const err = useStore.getState().claudeUsageError;
      expect(err).toMatch(/Usage request failed \(HTTP 429\)\. Resets in/);
    });
  });

  it("marks Claude usage as login required when credentials are missing", async () => {
    apiMocks.readLocalLogs.mockResolvedValue([]);
    apiMocks.fetchClaudeUsage.mockRejectedValue(new Error("claude_credentials_missing"));
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
    apiMocks.fetchMetrics.mockResolvedValue({ metrics: [] });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(useStore.getState().claudeUsageError).toBe("Login required");
    });
  });

  it("marks OpenAI usage as login required on unauthorized responses", async () => {
    apiMocks.readLocalLogs.mockResolvedValue([]);
    apiMocks.fetchClaudeUsage.mockResolvedValue(null);
    apiMocks.fetchCodexUsage.mockRejectedValue(new Error("codex_usage_failed:401 Unauthorized"));
    apiMocks.fetchMetrics.mockResolvedValue({ metrics: [] });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(useStore.getState().codexUsageError).toBe("Login required");
    });
  });

  it("keeps polling local and provider usage when no dashboard cookie is present", async () => {
    vi.useFakeTimers();
    useStore.setState({ cookie: null });
    apiMocks.readLocalLogs.mockResolvedValue([
      {
        ts: `${isoDate(0)}T10:00:00.000Z`,
        request_id: "local-only-1",
        developer_id: "dev-a",
        repo: "tailor-bar",
        model: "claude-sonnet-4",
        input_tokens: 100,
        output_tokens: 25,
      },
    ]);
    apiMocks.fetchClaudeUsage.mockResolvedValue(null);
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
    apiMocks.fetchMetrics.mockResolvedValue({ metrics: [] });
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    const { unmount } = renderHook(() => usePolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(apiMocks.fetchMetrics).not.toHaveBeenCalled();
    expect(apiMocks.fetchUsage).not.toHaveBeenCalled();
    expect(useStore.getState().todayLogs).toHaveLength(1);
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
    apiMocks.fetchClaudeUsage.mockResolvedValue(null);
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

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
    apiMocks.fetchClaudeUsage.mockResolvedValue(null);
    apiMocks.fetchCodexUsage.mockResolvedValue(null);
    apiMocks.fetchUsage.mockResolvedValue({ data: [] });
    apiMocks.getProxyEnabled.mockResolvedValue(false);

    renderHook(() => usePolling());

    await waitFor(() => {
      expect(useStore.getState().weekLogs).toHaveLength(2);
    });

    expect(useStore.getState().weekLogs.every((log) => log.developer_id === "dev-a")).toBe(true);
    expect(useStore.getState().weekLogs.every((log) => log.repo === "tailor-bar")).toBe(true);
  });
});
