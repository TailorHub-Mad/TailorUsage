import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeekSection } from "./WeekSection";
import { useStore } from "../../store";

let capturedLineChartProps: { margin?: { left?: number } } | undefined;
let capturedXAxisProps:
  | {
      padding?: { left?: number; right?: number };
    }
  | undefined;

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, ...props }: { children: ReactNode; margin?: { left?: number } }) => {
    capturedLineChartProps = props;
    return <div>{children}</div>;
  },
  CartesianGrid: () => null,
  XAxis: (props: { padding?: { left?: number; right?: number } }) => {
    capturedXAxisProps = props;
    return null;
  },
  YAxis: () => null,
  Tooltip: () => null,
  Line: () => null,
}));

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
    preferences: { poll_interval: 900000, tray_display: "cost", tray_source: "claude" },
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
    capturedLineChartProps = undefined;
    capturedXAxisProps = undefined;
  });

  it("renders a past-7-days activity chart when there are calls", () => {
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

    expect(screen.getByLabelText("Past 7 days activity chart")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "42 calls across 4 active days"),
    ).toBeInTheDocument();
    expect(screen.getByText("Top 3 repos")).toBeInTheDocument();
    expect(screen.getByText("tailor-bar")).toBeInTheDocument();
    expect(screen.getByText("42 contributions")).toBeInTheDocument();
    expect(screen.getByText("Top 3 models")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(screen.queryByText("No activity in the past 7 days")).not.toBeInTheDocument();
    expect(capturedLineChartProps?.margin?.left).toBe(0);
    expect(capturedXAxisProps?.padding).toEqual({ left: 12, right: 12 });
  });

  it("omits unknown from the ranked repo summary when known repos exist", () => {
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
        ...Array.from({ length: 2 }, (_, index) => ({
          ts: `2026-03-18T10:0${index}:00.000Z`,
          request_id: `req-alpha-${index}`,
          developer_id: "dev-a",
          repo: "alpha-repo",
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

    expect(screen.getByText("Top 3 repos")).toBeInTheDocument();
    expect(screen.getByText("tailor-bar")).toBeInTheDocument();
    expect(screen.getByText("alpha-repo")).toBeInTheDocument();
    expect(screen.queryByText(/^unknown$/)).not.toBeInTheDocument();
  });

  it("orders the top 3 repos by contribution count", () => {
    useStore.setState({
      weekLogs: [
        ...Array.from({ length: 2 }, (_, index) => ({
          ts: `2026-03-17T10:0${index}:00.000Z`,
          request_id: `req-alpha-${index}`,
          developer_id: "dev-a",
          repo: "alpha-repo",
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
        ...Array.from({ length: 6 }, (_, index) => ({
          ts: `2026-03-18T10:${`${index}`.padStart(2, "0")}:00.000Z`,
          request_id: `req-beta-${index}`,
          developer_id: "dev-a",
          repo: "beta-repo",
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
        ...Array.from({ length: 4 }, (_, index) => ({
          ts: `2026-03-19T10:0${index}:00.000Z`,
          request_id: `req-gamma-${index}`,
          developer_id: "dev-a",
          repo: "gamma-repo",
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
          ts: `2026-03-20T10:0${index}:00.000Z`,
          request_id: `req-delta-${index}`,
          developer_id: "dev-a",
          repo: "delta-repo",
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

    const repoSummary = screen.getByText("Top 3 repos").parentElement;
    expect(repoSummary).not.toBeNull();
    const summaryText = repoSummary?.textContent ?? "";

    expect(summaryText).toContain("1.beta-repo6 contributions");
    expect(summaryText).toContain("2.gamma-repo4 contributions");
    expect(summaryText).toContain("3.delta-repo3 contributions");
    expect(summaryText.indexOf("1.beta-repo")).toBeLessThan(summaryText.indexOf("2.gamma-repo"));
    expect(summaryText.indexOf("2.gamma-repo")).toBeLessThan(summaryText.indexOf("3.delta-repo"));
    expect(screen.queryByText("alpha-repo")).not.toBeInTheDocument();
  });

  it("orders the top 3 models by usage count", () => {
    useStore.setState({
      weekLogs: [
        ...Array.from({ length: 2 }, (_, index) => ({
          ts: `2026-03-17T11:0${index}:00.000Z`,
          request_id: `req-model-a-${index}`,
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "claude-haiku-3",
          stream: false,
          status: 200,
          latency_ms: 120,
          input_tokens: 100,
          output_tokens: 50,
          stop_reason: "end_turn",
        })),
        ...Array.from({ length: 6 }, (_, index) => ({
          ts: `2026-03-18T11:${`${index}`.padStart(2, "0")}:00.000Z`,
          request_id: `req-model-b-${index}`,
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
        ...Array.from({ length: 4 }, (_, index) => ({
          ts: `2026-03-19T11:0${index}:00.000Z`,
          request_id: `req-model-c-${index}`,
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "gpt-4.1",
          stream: false,
          status: 200,
          latency_ms: 120,
          input_tokens: 100,
          output_tokens: 50,
          stop_reason: "end_turn",
        })),
        ...Array.from({ length: 3 }, (_, index) => ({
          ts: `2026-03-20T11:0${index}:00.000Z`,
          request_id: `req-model-d-${index}`,
          developer_id: "dev-a",
          repo: "tailor-bar",
          provider: "anthropic" as const,
          endpoint: "/v1/messages",
          model: "o3",
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

    const modelSummary = screen.getByText("Top 3 models").parentElement;
    expect(modelSummary).not.toBeNull();
    const summaryText = modelSummary?.textContent ?? "";

    expect(summaryText).toContain("1.claude-sonnet-46 calls");
    expect(summaryText).toContain("2.gpt-4.14 calls");
    expect(summaryText).toContain("3.o33 calls");
    expect(summaryText.indexOf("1.claude-sonnet-4")).toBeLessThan(summaryText.indexOf("2.gpt-4.1"));
    expect(summaryText.indexOf("2.gpt-4.1")).toBeLessThan(summaryText.indexOf("3.o3"));
    expect(screen.queryByText("claude-haiku-3")).not.toBeInTheDocument();
  });
});
