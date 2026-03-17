import { useStore } from "../../store";
import { formatTokens, formatCost } from "../../lib/format";
import { calculateCost } from "../../lib/cost";

export function TodaySection() {
  const { todayLogs } = useStore();

  const totalTokens = todayLogs.reduce(
    (sum, l) => sum + l.input_tokens + l.output_tokens,
    0,
  );
  const totalCalls = todayLogs.length;
  const cost = calculateCost(todayLogs);

  // Model breakdown
  const modelTokens: Record<string, number> = {};
  for (const log of todayLogs) {
    const model = log.model.toLowerCase().includes("opus")
      ? "Opus"
      : log.model.toLowerCase().includes("haiku")
        ? "Haiku"
        : "Sonnet";
    modelTokens[model] =
      (modelTokens[model] || 0) + log.input_tokens + log.output_tokens;
  }

  const models = Object.entries(modelTokens)
    .sort(([, a], [, b]) => b - a)
    .map(([name, tokens]) => ({
      name,
      tokens,
      pct: totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0,
    }));

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-base font-bold text-gray-900">Today</span>
        <span className="text-sm font-semibold text-gray-700">{formatCost(cost)}</span>
      </div>

      <div className="flex justify-between text-xs text-gray-400 mb-3">
        <span>{formatTokens(totalTokens)} tokens</span>
        <span>{totalCalls} calls</span>
      </div>

      {models.map((m) => (
        <div key={m.name} className="mb-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{m.name}</span>
            <span>{m.pct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                m.name === "Opus"
                  ? "bg-purple-400"
                  : m.name === "Haiku"
                    ? "bg-emerald-400"
                    : "bg-blue-400"
              }`}
              style={{ width: `${m.pct}%` }}
            />
          </div>
        </div>
      ))}

      {totalCalls === 0 && (
        <p className="text-xs text-gray-300 text-center py-2">No activity today</p>
      )}
    </div>
  );
}
