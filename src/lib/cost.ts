import type { LogRecord } from "./types";

// Pricing per 1M tokens
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.8, output: 4 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "o3": { input: 10, output: 40 },
  "o4-mini": { input: 1.1, output: 4.4 },
};

function modelToKey(model: string): string {
  const m = model.toLowerCase();
  // Anthropic models
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  // OpenAI models
  if (m.includes("o4-mini")) return "o4-mini";
  if (m.includes("o3")) return "o3";
  if (m.includes("gpt-4o")) return "gpt-4o";
  return "sonnet"; // default fallback
}

export function calculateCost(logs: LogRecord[]): number {
  let total = 0;
  for (const log of logs) {
    const key = modelToKey(log.model);
    const pricing = PRICING[key] ?? PRICING["sonnet"];
    total +=
      (log.input_tokens * pricing.input) / 1_000_000 +
      (log.output_tokens * pricing.output) / 1_000_000;
  }
  return total;
}
