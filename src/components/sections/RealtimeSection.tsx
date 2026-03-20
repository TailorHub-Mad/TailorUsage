import { useStore } from "../../store";
import { formatTokens } from "../../lib/format";

function oneHourAgo(): number {
  return Date.now() - 60 * 60 * 1000;
}

export function RealtimeSection() {
  const { todayLogs } = useStore();

  const cutoff = oneHourAgo();
  const recentLogs = todayLogs.filter((l) => new Date(String(l.ts)).getTime() >= cutoff);

  const totalTokens = recentLogs.reduce(
    (sum, l) => sum + l.input_tokens + l.output_tokens, 0,
  );

  const anthropicTokens = recentLogs
    .filter((l) => !l.provider || l.provider === "anthropic")
    .reduce((sum, l) => sum + l.input_tokens + l.output_tokens, 0);

  const openaiTokens = recentLogs
    .filter((l) => l.provider === "openai")
    .reduce((sum, l) => sum + l.input_tokens + l.output_tokens, 0);

  // Treat 100k tokens/hr as "full" for the progress bar
  const MAX_TOKENS = 100_000;
  const pct = Math.min(100, Math.round((totalTokens / MAX_TOKENS) * 100));

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-base font-bold text-gray-900">This Hour</span>
        {pct >= 80 && (
          <span className="text-xs text-amber-500 font-medium">High usage</span>
        )}
      </div>

      <div className="mb-1">
        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gray-800 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{formatTokens(totalTokens)} tokens</span>
        <div className="flex gap-2">
          {anthropicTokens > 0 && (
            <span className="text-purple-500">{formatTokens(anthropicTokens)} Claude</span>
          )}
          {openaiTokens > 0 && (
            <span className="text-teal-500">{formatTokens(openaiTokens)} Codex</span>
          )}
        </div>
      </div>

      {recentLogs.length > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          {recentLogs.length} calls this hour
        </div>
      )}
    </div>
  );
}
