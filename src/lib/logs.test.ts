import { describe, expect, it, vi } from "vitest";
import { latestLogForProvider, normalizeLogRecord, normalizeLogRecords } from "./logs";

describe("normalizeLogRecord", () => {
  it("normalizes nested log payloads from mixed providers", () => {
    const uuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-0000-0000-000000000000");

    expect(
      normalizeLogRecord({
        timestamp: "2026-03-20T10:00:00.000Z",
        response: {
          id: "resp-1",
          model: "gpt-4o-mini",
          usage: {
            prompt_tokens: "1200",
            completion_tokens: 300,
          },
          status: 200,
        },
        request: {
          path: "/v1/chat/completions",
          stream: true,
        },
        userEmail: "dev@example.com",
        repository: "tailor-bar",
        durationMs: "75",
      }),
    ).toEqual({
      ts: "2026-03-20T10:00:00.000Z",
      request_id: "resp-1",
      developer_id: "dev@example.com",
      repo: "tailor-bar",
      provider: "openai",
      endpoint: "/v1/chat/completions",
      model: "gpt-4o-mini",
      stream: true,
      status: 200,
      latency_ms: 75,
      input_tokens: 1200,
      output_tokens: 300,
      stop_reason: "",
      error_message: undefined,
    });

    expect(
      normalizeLogRecord({
        ts: 123,
        model_name: "claude-sonnet-4",
        path: "/v1/messages",
      }),
    ).toEqual({
      ts: 123,
      request_id: "00000000-0000-0000-0000-000000000000",
      developer_id: "unknown",
      repo: "unknown",
      provider: "anthropic",
      endpoint: "/v1/messages",
      model: "claude-sonnet-4",
      stream: false,
      status: 0,
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "",
      error_message: undefined,
    });

    uuidSpy.mockRestore();
  });

  it("returns null for invalid values", () => {
    expect(normalizeLogRecord(null)).toBeNull();
    expect(normalizeLogRecord("not-an-object")).toBeNull();
  });
});

describe("normalizeLogRecords", () => {
  it("filters invalid entries and sorts by timestamp", () => {
    const logs = normalizeLogRecords([
      { ts: "2026-03-20T12:00:00.000Z", model: "claude-haiku", developer_id: "a", repo: "x" },
      null,
      { ts: "2026-03-20T09:00:00.000Z", model: "o3", developer_id: "a", repo: "x" },
    ]);

    expect(logs).toHaveLength(2);
    expect(logs.map((log) => log.model)).toEqual(["o3", "claude-haiku"]);
  });
});

describe("latestLogForProvider", () => {
  it("returns the newest log overall or by provider", () => {
    const logs = normalizeLogRecords([
      { ts: "2026-03-20T09:00:00.000Z", model: "claude-sonnet-4", provider: "anthropic", developer_id: "a", repo: "x" },
      { ts: "2026-03-20T11:00:00.000Z", model: "gpt-4o", provider: "openai", developer_id: "a", repo: "x" },
      { ts: "2026-03-20T10:00:00.000Z", model: "claude-opus-4", provider: "anthropic", developer_id: "a", repo: "x" },
    ]);

    expect(latestLogForProvider(logs)?.model).toBe("gpt-4o");
    expect(latestLogForProvider(logs, "anthropic")?.model).toBe("claude-opus-4");
    expect(latestLogForProvider([], "openai")).toBeNull();
  });
});
