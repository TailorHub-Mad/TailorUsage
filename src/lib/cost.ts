import type { LogRecord } from "./types";

// Anthropic pricing per 1M tokens
const PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.8, output: 4 },
};

function modelToKey(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return "sonnet"; // default fallback
}

export function calculateCost(logs: LogRecord[]): number {
  let total = 0;
  for (const log of logs) {
    const key = modelToKey(log.model);
    const pricing = PRICING[key];
    total +=
      (log.input_tokens * pricing.input) / 1_000_000 +
      (log.output_tokens * pricing.output) / 1_000_000;
  }
  return total;
}
