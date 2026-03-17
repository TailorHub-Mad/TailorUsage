import { useStore } from "../../store";
import { formatTokens } from "../../lib/format";

export function RealtimeSection() {
  const { metrics } = useStore();

  const totalTokens = metrics?.total_tokens_1h ?? 0;
  const opusTokens = metrics?.opus_tokens_1h ?? 0;
  // Treat 100k tokens/hr as "full" for the progress bar
  const MAX_TOKENS = 100_000;
  const pct = Math.min(100, Math.round((totalTokens / MAX_TOKENS) * 100));

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-base font-bold text-gray-900">This Hour</span>
        {metrics?.warning_flag && (
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
        {opusTokens > 0 && (
          <span className="text-purple-500">{formatTokens(opusTokens)} Opus</span>
        )}
      </div>

      {(metrics?.opus_streak ?? 0) > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          Opus streak: <span className="text-gray-700 font-medium">{metrics!.opus_streak}</span>
        </div>
      )}
    </div>
  );
}
