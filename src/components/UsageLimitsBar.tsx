import { useStore } from "../store";
import { formatTokens } from "../lib/format";
import type { LogRecord } from "../lib/types";

// Claude API daily/weekly token budgets — adjust to your tier
const DAILY_LIMIT  = 1_000_000;  // 1M tokens / day
const WEEKLY_LIMIT = 5_000_000;  // 5M tokens / week

function totalTokens(logs: LogRecord[]): number {
  return logs.reduce((sum, l) => sum + l.input_tokens + l.output_tokens, 0);
}

function LimitRow({
  label,
  current,
  limit,
}: {
  label: string;
  current: number;
  limit: number;
}) {
  const pct = Math.min((current / limit) * 100, 100);
  const barColor =
    pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400";

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] font-medium text-gray-400 w-10 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-right shrink-0 w-20">
        <span className={pct >= 90 ? "text-red-400 font-semibold" : pct >= 70 ? "text-amber-500 font-semibold" : "text-gray-500"}>
          {pct < 1 && current > 0 ? "<1" : Math.round(pct)}%
        </span>
        <span className="text-gray-300"> · {formatTokens(current)}</span>
      </span>
    </div>
  );
}

export function UsageLimitsBar() {
  const { todayLogs, weekLogs } = useStore();

  return (
    <div className="px-4 pt-3 pb-2.5 flex flex-col gap-1.5 border-b border-gray-100">
      <LimitRow label="Today" current={totalTokens(todayLogs)} limit={DAILY_LIMIT} />
      <LimitRow label="Week"  current={totalTokens(weekLogs)}  limit={WEEKLY_LIMIT} />
    </div>
  );
}
