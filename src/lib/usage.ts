import type { LogRecord } from "./types";

export const DAILY_LIMIT = 1_000_000;
export const WEEKLY_LIMIT = 5_000_000;

export function totalTokens(logs: LogRecord[]): number {
  return logs.reduce((sum, log) => sum + log.input_tokens + log.output_tokens, 0);
}

export function usagePercent(current: number, limit: number): number {
  return Math.min((current / limit) * 100, 100);
}

export function formatUsagePercent(current: number, limit: number): string {
  const pct = usagePercent(current, limit);
  if (pct < 1 && current > 0) return "<1%";
  return `${Math.round(pct)}%`;
}

export function formatResetTime(resetAt: string | number, now = new Date()): string {
  const resetDate = typeof resetAt === "number"
    ? new Date(resetAt * 1000)
    : new Date(resetAt);
  const diffMs = resetDate.getTime() - now.getTime();

  if (!Number.isFinite(resetDate.getTime())) return "Reset time unavailable";
  if (diffMs <= 0) return "Resetting soon";

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `Resets in ${days}d ${hours}h`;
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}
