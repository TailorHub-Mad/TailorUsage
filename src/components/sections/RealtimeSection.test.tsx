import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeSection } from "./RealtimeSection";
import { useStore } from "../../store";

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

describe("RealtimeSection", () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts recent logs when timestamps are stored in epoch seconds", () => {
    const recentTimestamp = Math.floor(
      new Date("2026-03-20T11:30:00.000Z").getTime() / 1000,
    );

    useStore.setState({
      todayLogs: [
        {
          ts: recentTimestamp,
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
    });

    render(<RealtimeSection />);

    expect(screen.getByText("528 tokens")).toBeInTheDocument();
    expect(screen.getByText("1 calls this hour")).toBeInTheDocument();
  });
});
