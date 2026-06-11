import type { LogRecord } from "./types";

// Pricing per 1M tokens
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.8, output: 4 },
  // OpenAI
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-4o": { input: 2.5, output: 10 },
  "o3": { input: 10, output: 40 },
  "o4-mini": { input: 1.1, output: 4.4 },
};

export interface CostBreakdown {
  pricedCost: number;
  pricedTokens: number;
  unpricedTokens: number;
}

function modelToKey(model: string): string | null {
  const m = model.toLowerCase();
  // Anthropic models
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  // OpenAI models
  if (m.includes("gpt-5.4") && m.includes("mini")) return "gpt-5.4-mini";
  if (m.includes("gpt-5.5")) return "gpt-5.5";
  if (m.includes("gpt-5.4")) return "gpt-5.4";
  if (m.includes("o4-mini")) return "o4-mini";
  if (m.includes("o3")) return "o3";
  if (m.includes("gpt-4o")) return "gpt-4o";
  return null;
}

export function calculateLogCost(log: LogRecord): number | null {
  const key = modelToKey(log.model);
  if (!key) return null;

  const pricing = PRICING[key];
  if (!pricing) return null;

  return (
    (log.input_tokens * pricing.input) / 1_000_000 +
    (log.output_tokens * pricing.output) / 1_000_000
  );
}

export function calculateCostBreakdown(logs: LogRecord[]): CostBreakdown {
  let pricedCost = 0;
  let pricedTokens = 0;
  let unpricedTokens = 0;

  for (const log of logs) {
    const tokens = log.input_tokens + log.output_tokens;
    const cost = calculateLogCost(log);
    if (cost === null) {
      unpricedTokens += tokens;
      continue;
    }

    pricedCost += cost;
    pricedTokens += tokens;
  }

  return { pricedCost, pricedTokens, unpricedTokens };
}

export function calculateCost(logs: LogRecord[]): number {
  return calculateCostBreakdown(logs).pricedCost;
}
