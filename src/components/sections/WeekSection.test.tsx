import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeekSection } from "./WeekSection";
import { useStore } from "../../store";

function resetStore() {
  useStore.setState({
    isAuthenticated: false,
    cookie: null,
    metrics: null,
    todayLogs: [],
    weekLogs: [],
    proxyStatus: { running: false, enabled: false, shareDiagnostics: false },
    preferences: { poll_interval: 60000, tray_display: "cost" },
    loading: false,
    error: null,
  });
}

describe("WeekSection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a weekly activity chart when there are calls this week", () => {
    useStore.setState({
      weekLogs: [
        ...Array.from({ length: 4 }, (_, index) => ({
          ts: `2026-03-16T10:0${index}:00.000Z`,
          request_id: `req-mon-${index}`,
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "claude-sonnet-4",
          stream: false,
          status: 200,
          latency_ms: 120,
          input_tokens: 100,
          output_tokens: 50,
          stop_reason: "end_turn",
        })),
        ...Array.from({ length: 8 }, (_, index) => ({
          ts: `2026-03-17T10:${`${index}`.padStart(2, "0")}:00.000Z`,
          request_id: `req-tue-${index}`,
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "claude-sonnet-4",
          stream: false,
          status: 200,
          latency_ms: 120,
          input_tokens: 100,
          output_tokens: 50,
          stop_reason: "end_turn",
        })),
        ...Array.from({ length: 12 }, (_, index) => ({
          ts: `2026-03-19T10:${`${index}`.padStart(2, "0")}:00.000Z`,
          request_id: `req-thu-${index}`,
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "claude-sonnet-4",
          stream: false,
          status: 200,
          latency_ms: 120,
          input_tokens: 100,
          output_tokens: 50,
          stop_reason: "end_turn",
        })),
        ...Array.from({ length: 18 }, (_, index) => ({
          ts: `2026-03-20T10:${`${index}`.padStart(2, "0")}:00.000Z`,
          request_id: `req-fri-${index}`,
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "claude-sonnet-4",
          stream: false,
          status: 200,
          latency_ms: 120,
          input_tokens: 100,
          output_tokens: 50,
          stop_reason: "end_turn",
        })),
      ],
    });

    render(<WeekSection />);

    expect(screen.getByLabelText("Weekly activity chart")).toBeInTheDocument();
    expect(screen.getByText("42 calls", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("tailor-bar")).toBeInTheDocument();
    expect(screen.queryByText("No activity this week")).not.toBeInTheDocument();
  });

  it("prefers a known repo over unknown in the top repo summary", () => {
    useStore.setState({
      weekLogs: [
        ...Array.from({ length: 5 }, (_, index) => ({
          ts: `2026-03-20T10:0${index}:00.000Z`,
          request_id: `req-unknown-${index}`,
          developer_id: "dev-a",
          repo: "unknown",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "claude-sonnet-4",
          stream: false,
          status: 200,
          latency_ms: 120,
          input_tokens: 100,
          output_tokens: 50,
          stop_reason: "end_turn",
        })),
        ...Array.from({ length: 3 }, (_, index) => ({
          ts: `2026-03-19T10:0${index}:00.000Z`,
          request_id: `req-known-${index}`,
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "claude-sonnet-4",
          stream: false,
          status: 200,
          latency_ms: 120,
          input_tokens: 100,
          output_tokens: 50,
          stop_reason: "end_turn",
        })),
      ],
    });

    render(<WeekSection />);

    expect(screen.getByText("tailor-bar")).toBeInTheDocument();
    expect(screen.queryByText(/^unknown$/)).not.toBeInTheDocument();
  });
});
