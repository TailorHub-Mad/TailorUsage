import { useStore } from "../../store";
import { formatCost } from "../../lib/format";
import { calculateCost } from "../../lib/cost";
import { logTime } from "../../lib/logs";
import type { TooltipProps } from "recharts";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfCurrentWeek(): Date {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function buildWeekActivity(weekLogs: ReturnType<typeof useStore.getState>["weekLogs"]) {
  const weekStart = startOfCurrentWeek();

  const counts = new Map<string, number>();
  for (const log of weekLogs) {
    const key = dayKey(new Date(logTime(log.ts)));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const key = dayKey(date);

    return {
      key,
      label: date.toLocaleDateString([], { weekday: "short" }),
      calls: counts.get(key) ?? 0,
    };
  });
}

function WeekTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const calls = payload[0]?.value;
  if (typeof calls !== "number") return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">{label}</div>
      <div className="mt-1 text-xs font-medium text-gray-700">{calls} {calls === 1 ? "call" : "calls"}</div>
    </div>
  );
}

export function WeekSection() {
  const { weekLogs } = useStore();

  const cost = calculateCost(weekLogs);
  const weekActivity = buildWeekActivity(weekLogs);
  const totalCalls = weekLogs.length;
  const activeDays = weekActivity.filter((day) => day.calls > 0).length;

  const repoCounts: Record<string, number> = {};
  for (const log of weekLogs) {
    const repo = log.repo?.trim() || "unknown";
    repoCounts[repo] = (repoCounts[repo] || 0) + 1;
  }
  const rankedRepos = Object.entries(repoCounts).sort(([, a], [, b]) => b - a);
  const topRepo = rankedRepos.find(([repo]) => repo !== "unknown") ?? rankedRepos[0];
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

      {totalCalls > 0 ? (
        <>
          <div className="mb-3 h-28" aria-label="Weekly activity chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekActivity} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  padding={{ left: 12, right: 12 }}
                />
                <YAxis hide domain={[0, "dataMax + 2"]} />
                <Tooltip
                  content={<WeekTooltip />}
                  cursor={{ stroke: "#d1d5db", strokeDasharray: "4 4" }}
                />
                <Line
                  type="monotone"
                  dataKey="calls"
                  stroke="#111827"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#111827", strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: "#111827", strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="text-xs text-gray-400">
            <span className="text-gray-600 font-medium">{totalCalls} calls</span> across {activeDays} active {activeDays === 1 ? "day" : "days"}
          </div>
        </>
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
