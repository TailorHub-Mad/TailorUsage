import { useState } from "react";
import { useStore } from "../../store";
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

function rankUsage(entries: Record<string, number>) {
  return Object.entries(entries).sort(
    ([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB),
  );
}

export function WeekSection() {
  const { weekLogs } = useStore();

  const weekActivity = buildWeekActivity(weekLogs);
  const totalCalls = weekLogs.length;
  const activeDays = weekActivity.filter((day) => day.calls > 0).length;

  const repoCounts: Record<string, number> = {};
  for (const log of weekLogs) {
    const repo = log.repo?.trim() || "unknown";
    repoCounts[repo] = (repoCounts[repo] || 0) + 1;
  }
  const rankedRepos = rankUsage(repoCounts);
  const knownRankedRepos = rankedRepos.filter(([repo]) => repo !== "unknown");
  const topRepos = (knownRankedRepos.length > 0 ? knownRankedRepos : rankedRepos).slice(0, 3);

  const modelCounts: Record<string, number> = {};
  for (const log of weekLogs) {
    const model = log.model?.trim();
    if (!model || model === "unknown") continue;
    modelCounts[model] = (modelCounts[model] || 0) + 1;
  }
  const topModels = rankUsage(modelCounts).slice(0, 3);

  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`px-4 ${collapsed ? "pt-4 pb-0" : "py-4"}`}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="mb-3 flex w-full cursor-pointer items-center gap-1.5 text-left"
      >
        <span className="text-base font-bold text-gray-900">This Week</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`mt-0.5 text-gray-400 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: collapsed ? "0fr" : "1fr",
          transition: "grid-template-rows 300ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
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

          {topRepos.length > 0 && (
            <div className="mt-2 text-xs text-gray-400">
              <div className="font-medium uppercase tracking-[0.08em] text-[10px] text-gray-400">Top 3 repos</div>
              <div className="mt-1 space-y-1">
                {topRepos.map(([repo, count], index) => (
                  <div key={repo} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-gray-600">
                      <span className="mr-1 text-gray-400">{index + 1}.</span>
                      <span className="font-medium">{repo}</span>
                    </span>
                    <span className="shrink-0 text-gray-400">
                      {count} {count === 1 ? "contribution" : "contributions"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topModels.length > 0 && (
            <div className="mt-3 text-xs text-gray-400">
              <div className="font-medium uppercase tracking-[0.08em] text-[10px] text-gray-400">Top 3 models</div>
              <div className="mt-1 space-y-1">
                {topModels.map(([model, count], index) => (
                  <div key={model} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-all text-gray-600">
                      <span className="mr-1 text-gray-400">{index + 1}.</span>
                      <span className="font-medium">{model}</span>
                    </span>
                    <span className="shrink-0 text-gray-400">
                      {count} {count === 1 ? "call" : "calls"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
