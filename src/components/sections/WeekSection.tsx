import { useStore } from "../../store";
import { formatCost } from "../../lib/format";
import { calculateCost } from "../../lib/cost";
import { Sparkline } from "../charts/Sparkline";

export function WeekSection() {
  const { weekLogs } = useStore();

  const cost = calculateCost(weekLogs);

  const dailyCosts: Record<string, number> = {};
  for (const log of weekLogs) {
    const date = String(log.ts).slice(0, 10);
    if (!dailyCosts[date]) dailyCosts[date] = 0;
    const model = log.model.toLowerCase();
    const pricing = model.includes("opus")
      ? { input: 15, output: 75 }
      : model.includes("haiku")
        ? { input: 0.8, output: 4 }
        : { input: 3, output: 15 };
    dailyCosts[date] +=
      (log.input_tokens * pricing.input) / 1_000_000 +
      (log.output_tokens * pricing.output) / 1_000_000;
  }

  const sparklineData = Object.entries(dailyCosts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));

  const repoCounts: Record<string, number> = {};
  for (const log of weekLogs) {
    const repo = log.repo || "unknown";
    repoCounts[repo] = (repoCounts[repo] || 0) + 1;
  }
  const topRepo = Object.entries(repoCounts).sort(([, a], [, b]) => b - a)[0];
  const topRepoPct =
    topRepo && weekLogs.length > 0
      ? Math.round((topRepo[1] / weekLogs.length) * 100)
      : 0;

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-base font-bold text-gray-900">This Week</span>
        <span className="text-sm font-semibold text-gray-700">{formatCost(cost)}</span>
      </div>

      {sparklineData.length > 0 ? (
        <Sparkline data={sparklineData} />
      ) : (
        <p className="text-xs text-gray-300 text-center py-2">No activity this week</p>
      )}

      {topRepo && (
        <div className="mt-2 text-xs text-gray-400">
          Top repo:{" "}
          <span className="text-gray-600 font-medium">{topRepo[0]}</span>{" "}
          <span className="text-gray-400">({topRepoPct}%)</span>
        </div>
      )}
    </div>
  );
}
