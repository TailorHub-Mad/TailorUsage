import { describe, expect, it } from "vitest";
import { calculateCost, calculateCostBreakdown, calculateLogCost } from "./cost";
import type { LogRecord } from "./types";

function log(model: string, input_tokens = 1_000_000, output_tokens = 1_000_000): LogRecord {
  return {
    ts: "2026-03-20T10:00:00.000Z",
    request_id: `req-${model}`,
    developer_id: "dev-a",
    repo: "tailor-usage",
    provider: model.includes("claude") ? "anthropic" : "openai",
    endpoint: "/v1/responses",
    model,
    status: 200,
    latency_ms: 0,
    input_tokens,
    output_tokens,
    stop_reason: "",
  };
}

describe("cost calculation", () => {
  it("does not price unknown models with a fallback", () => {
    expect(calculateLogCost(log("new-model-without-pricing"))).toBeNull();
    expect(calculateCost([log("new-model-without-pricing")])).toBe(0);
  });

  it("separates priced cost from unpriced token volume", () => {
    const breakdown = calculateCostBreakdown([
      log("claude-sonnet-4", 1_000_000, 1_000_000),
      log("gpt-5.4-codex-mini", 1_000_000, 1_000_000),
      log("(unknown)", 100, 50),
    ]);

    expect(breakdown.pricedCost).toBeCloseTo(23.25);
    expect(breakdown.pricedTokens).toBe(4_000_000);
    expect(breakdown.unpricedTokens).toBe(150);
  });
});
