import { useState } from "react";
import { useStore } from "../../store";
import { logTime } from "../../lib/logs";
import { calculateLogCost } from "../../lib/cost";
import { formatCost, formatTokens } from "../../lib/format";
import type { TooltipProps } from "recharts";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ModelUsage {
  calls: number;
  tokens: number;
  pricedCost: number;
  unpricedTokens: number;
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfRollingWeek(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  date.setHours(0, 0, 0, 0);
  return date;
}

function buildWeekActivity(weekLogs: ReturnType<typeof useStore.getState>["weekLogs"]) {
  const weekStart = startOfRollingWeek();

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
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div className="chart-tooltip-value">{calls} {calls === 1 ? "call" : "calls"}</div>
    </div>
  );
}

function rankUsage(entries: Record<string, number>) {
  return Object.entries(entries).sort(
    ([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB),
  );
}

function topModelsWithOpenAiSignal(
  rankedModels: [string, ModelUsage][],
  rankedOpenAiModels: [string, ModelUsage][],
) {
  const topModels = rankedModels.slice(0, 3);
  const topOpenAiModel = rankedOpenAiModels[0];

  if (!topOpenAiModel || topModels.some(([model]) => model === topOpenAiModel[0])) {
    return topModels;
  }

  if (topModels.length < 3) {
    return [...topModels, topOpenAiModel];
  }

  return [...topModels.slice(0, 2), topOpenAiModel];
}

function rankModelUsage(entries: Record<string, ModelUsage>) {
  return Object.entries(entries).sort(
    ([nameA, usageA], [nameB, usageB]) =>
      usageB.calls - usageA.calls || nameA.localeCompare(nameB),
  );
}

function modelBucketName(model: string | undefined): string {
  const value = model?.trim();
  if (!value || value.toLowerCase() === "unknown") return "(unknown)";
  return value;
}

function modelCostLabel(usage: ModelUsage): string {
  if (usage.unpricedTokens > 0) return `${formatTokens(usage.tokens)} tokens · unpriced`;
  return `${formatTokens(usage.tokens)} tokens · ${formatCost(usage.pricedCost)}`;
}

function buildOpenAiWarningMessage(
  diagnostic: ReturnType<typeof useStore.getState>["openAiLogDiagnostic"],
  codexReadStatus: ReturnType<typeof useStore.getState>["codexReadStatus"],
): string {
  if (diagnostic?.message) return diagnostic.message;

  if (codexReadStatus.status !== "ok") {
    return `OpenAI usage was detected, but Codex history is currently unreadable (${codexReadStatus.status}).`;
  }

  return "OpenAI usage was detected, but no local OpenAI model activity was captured in this window.";
}

export function WeekSection() {
  const { weekLogs, codexUsage, codexReadStatus, openAiLogDiagnostic, preferences } = useStore();

  const visibleWeekLogs = weekLogs.filter((log) =>
    log.provider === "openai"
      ? preferences.visible_providers.includes("openai")
      : preferences.visible_providers.includes("claude"),
  );

  const weekActivity = buildWeekActivity(visibleWeekLogs);
  const totalCalls = visibleWeekLogs.length;
  const activeDays = weekActivity.filter((day) => day.calls > 0).length;

  const repoCounts: Record<string, number> = {};
  for (const log of visibleWeekLogs) {
    const repo = log.repo?.trim() || "unknown";
    repoCounts[repo] = (repoCounts[repo] || 0) + 1;
  }
  const rankedRepos = rankUsage(repoCounts);
  const knownRankedRepos = rankedRepos.filter(([repo]) => repo !== "unknown");
  const topRepos = (knownRankedRepos.length > 0 ? knownRankedRepos : rankedRepos).slice(0, 3);

  const modelCounts: Record<string, ModelUsage> = {};
  const openAiModelCounts: Record<string, ModelUsage> = {};
  for (const log of visibleWeekLogs) {
    const model = modelBucketName(log.model);
    const cost = calculateLogCost(log);
    const tokens = log.input_tokens + log.output_tokens;
    modelCounts[model] = modelCounts[model] || {
      calls: 0,
      tokens: 0,
      pricedCost: 0,
      unpricedTokens: 0,
    };
    modelCounts[model].calls += 1;
    modelCounts[model].tokens += tokens;
    if (cost === null) {
      modelCounts[model].unpricedTokens += tokens;
    } else {
      modelCounts[model].pricedCost += cost;
    }

    if (log.provider === "openai") {
      openAiModelCounts[model] = openAiModelCounts[model] || {
        calls: 0,
        tokens: 0,
        pricedCost: 0,
        unpricedTokens: 0,
      };
      openAiModelCounts[model].calls += 1;
      openAiModelCounts[model].tokens += tokens;
      if (cost === null) {
        openAiModelCounts[model].unpricedTokens += tokens;
      } else {
        openAiModelCounts[model].pricedCost += cost;
      }
    }
  }
  const topModels = topModelsWithOpenAiSignal(rankModelUsage(modelCounts), rankModelUsage(openAiModelCounts));
  const hasReportedOpenAiUsage = [
    codexUsage?.rate_limit?.primary_window?.used_percent,
    codexUsage?.rate_limit?.secondary_window?.used_percent,
  ].some((value) => typeof value === "number" && value > 0);
  const hasRecentOpenAiLogs = visibleWeekLogs.some((log) => log.provider === "openai");
  const showOpenAiLogWarning = preferences.visible_providers.includes("openai") && hasReportedOpenAiUsage && !hasRecentOpenAiLogs;
  const openAiWarningMessage = buildOpenAiWarningMessage(openAiLogDiagnostic, codexReadStatus);

  const [collapsed, setCollapsed] = useState(true);

  return (
    <section className={`metrics-section ${collapsed ? "is-collapsed" : "is-expanded"}`}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="metrics-toggle"
        aria-expanded={!collapsed}
      >
        <span className="metrics-title">Metrics</span>
        <span className="metrics-summary">
          {totalCalls > 0 ? `${totalCalls} calls · ${activeDays} active ${activeDays === 1 ? "day" : "days"}` : "Past 7 days"}
        </span>
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
          className={`metrics-chevron ${collapsed ? "is-collapsed" : ""}`}
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
              <div className="activity-chart" aria-label="Past 7 days activity chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekActivity} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(0, 255, 255, 0.12)" strokeDasharray="2 5" vertical={false} />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#7187a0", fontSize: 10, fontFamily: "Space Mono" }}
                      padding={{ left: 12, right: 12 }}
                    />
                    <YAxis hide domain={[0, "dataMax + 2"]} />
                    <Tooltip
                      content={<WeekTooltip />}
                      cursor={{ stroke: "#ff006e", strokeDasharray: "3 4" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="calls"
                      stroke="#00ffff"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#0a0014", stroke: "#00ffff", strokeWidth: 1.5 }}
                      activeDot={{ r: 4, fill: "#ff006e", stroke: "#ff006e", strokeWidth: 0 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="activity-total">
                <span>{totalCalls} calls</span> across {activeDays} active {activeDays === 1 ? "day" : "days"}
              </div>
            </>
          ) : (
            <p className="empty-metrics">No activity in the past 7 days</p>
          )}

          {topRepos.length > 0 && (
            <div className="metric-ranking">
              <div className="ranking-title">Top 3 repos</div>
              <div className="ranking-list">
                {topRepos.map(([repo, count], index) => (
                  <div key={repo} className="ranking-row">
                    <span className="ranking-name">
                      <span className="ranking-index">{index + 1}.</span>
                      <span>{repo}</span>
                    </span>
                    <span className="ranking-value">
                      {count} {count === 1 ? "contribution" : "contributions"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topModels.length > 0 && (
            <div className="metric-ranking">
              <div className="ranking-title">Top models</div>
              <div className="ranking-list">
                {topModels.map(([model, usage], index) => (
                  <div key={model} className="ranking-row">
                    <span className="ranking-name model-name">
                      <span className="ranking-index">{index + 1}.</span>
                      <span>{model}</span>
                    </span>
                    <span className="ranking-value model-value">
                      {usage.calls} {usage.calls === 1 ? "call" : "calls"} · {modelCostLabel(usage)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showOpenAiLogWarning && (
            <p className="metrics-warning">
              {openAiWarningMessage}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
