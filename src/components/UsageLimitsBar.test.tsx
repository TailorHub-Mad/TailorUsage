import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageLimitsBar } from "./UsageLimitsBar";
import { useStore } from "../store";

const apiMocks = vi.hoisted(() => ({
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
    preferences: { poll_interval: 900000, tray_display: "cost", tray_source: "claude" },
    loading: false,
    error: null,
  });
}

describe("UsageLimitsBar", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    apiMocks.openUrl.mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders exact Claude session and weekly usage when available", () => {
    useStore.setState({
      claudeUsage: {
        five_hour: { utilization: 17, resets_at: "2026-03-26T15:47:00.000Z" },
        seven_day: { utilization: 23, resets_at: "2026-03-27T13:00:00.000Z" },
      },
      todayLogs: [
        {
          ts: "2026-03-26T10:00:00.000Z",
          request_id: "req-1",
          developer_id: "dev-a",
          repo: "tailor-bar",
          model: "claude-sonnet-4",
          status: 200,
          latency_ms: 100,
          input_tokens: 400,
          output_tokens: 128,
          stop_reason: "end_turn",
        },
      ],
      weekLogs: [
        {
          ts: "2026-03-25T10:00:00.000Z",
          request_id: "req-2",
          developer_id: "dev-a",
          repo: "tailor-bar",
          model: "claude-sonnet-4",
          status: 200,
          latency_ms: 100,
          input_tokens: 1000,
          output_tokens: 500,
          stop_reason: "end_turn",
        },
      ],
    });

    render(<UsageLimitsBar />);

    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getAllByText("Local estimate")).toHaveLength(2);
    expect(screen.getByText("17%")).toBeInTheDocument();
    expect(screen.getByText("23%")).toBeInTheDocument();
    expect(screen.getByText("Resets in 3h 47m")).toBeInTheDocument();
    expect(screen.getByText("Resets in 1d 1h")).toBeInTheDocument();
  });

  it("renders exact Codex usage, reviews, and credits when available", () => {
    const sessionResetAt = Math.floor(new Date("2026-03-26T16:21:00.000Z").getTime() / 1000);
    const weeklyResetAt = Math.floor(new Date("2026-04-01T11:00:00.000Z").getTime() / 1000);
    const reviewsResetAt = Math.floor(new Date("2026-04-02T11:00:00.000Z").getTime() / 1000);

    useStore.setState({
      codexUsage: {
        rate_limit: {
          primary_window: { used_percent: 6, reset_at: sessionResetAt, limit_window_seconds: 18000 },
          secondary_window: { used_percent: 6, reset_at: weeklyResetAt, limit_window_seconds: 604800 },
        },
        code_review_rate_limit: {
          primary_window: { used_percent: 0, reset_at: reviewsResetAt, limit_window_seconds: 604800 },
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: 1000,
        },
      },
      todayLogs: [
        {
          ts: "2026-03-26T10:00:00.000Z",
          request_id: "req-3",
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "openai",
          model: "gpt-5-codex",
          status: 200,
          latency_ms: 100,
          input_tokens: 400,
          output_tokens: 128,
          stop_reason: "end_turn",
        },
      ],
      weekLogs: [
        {
          ts: "2026-03-25T10:00:00.000Z",
          request_id: "req-4",
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "openai",
          model: "gpt-5-codex",
          status: 200,
          latency_ms: 100,
          input_tokens: 1000,
          output_tokens: 500,
          stop_reason: "end_turn",
        },
      ],
    });

    render(<UsageLimitsBar />);

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Reviews")).toBeInTheDocument();
    expect(screen.getByText("Credits")).toBeInTheDocument();
    expect(screen.getAllByText("6%")).toHaveLength(2);
    expect(screen.getAllByText("0%")).toHaveLength(3);
    expect(screen.getByText("Resets in 4h 21m")).toBeInTheDocument();
    expect(screen.getByText("Resets in 6d 23h")).toBeInTheDocument();
    expect(screen.getByText("1,000 remaining")).toBeInTheDocument();
    expect(screen.getByText("1,000 left")).toBeInTheDocument();
  });

  it("renders a provider error when Claude usage is rate limited", () => {
    useStore.setState({
      claudeUsageError: "Usage request failed (HTTP 429). Try again later.",
      codexUsage: {
        rate_limit: {
          primary_window: {
            used_percent: 9,
            reset_at: Math.floor(new Date("2026-03-26T16:09:00.000Z").getTime() / 1000),
            limit_window_seconds: 18000,
          },
        },
      },
    });

    render(<UsageLimitsBar />);

    expect(screen.getByText("Usage request failed (HTTP 429). Try again later.")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("9%")).toBeInTheDocument();
  });

  it("renders a Claude login CTA when Claude credentials are missing", () => {
    useStore.setState({
      claudeUsageError: "Login required",
    });

    render(<UsageLimitsBar />);

    expect(screen.getByText("Log in to Claude")).toBeInTheDocument();
    expect(screen.getByText("Connect your Claude session to view live limits.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(apiMocks.openUrl).toHaveBeenCalledWith("https://claude.ai/login");
  });

  it("renders an OpenAI login CTA when OpenAI credentials are missing", () => {
    useStore.setState({
      codexUsageError: "Login required",
    });

    render(<UsageLimitsBar />);

    expect(screen.getByText("Log in to OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Connect your OpenAI session to view live limits.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(apiMocks.openUrl).toHaveBeenCalledWith("https://chatgpt.com/auth/login");
  });
});
