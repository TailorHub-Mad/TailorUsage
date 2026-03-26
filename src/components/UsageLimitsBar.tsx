import type { ReactNode } from "react";
import { useStore } from "../store";
import { DAILY_LIMIT, WEEKLY_LIMIT, formatResetTime, totalTokens, usagePercent } from "../lib/usage";

function LimitRow({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail?: string;
}) {
  const barColor =
    percent >= 90 ? "bg-red-400" : percent >= 70 ? "bg-amber-400" : "bg-emerald-400";
  const valueColor =
    percent >= 90
      ? "text-red-400 font-semibold"
      : percent >= 70
        ? "text-amber-500 font-semibold"
        : "text-gray-500";

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2.5">
        <span className="text-[10px] font-medium text-gray-400 w-12 shrink-0">
          {label}
        </span>
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }}
          />
        </div>
        <span className={`text-[10px] tabular-nums text-right shrink-0 w-10 ${valueColor}`}>
          {percent < 1 && percent > 0 ? "<1" : Math.round(percent)}%
        </span>
      </div>
      {detail && (
        <div className="pl-[58px] text-[10px] leading-none text-gray-400 tabular-nums">
          <span>{detail}</span>
        </div>
      )}
    </div>
  );
}

function CreditsRow({ label, detail, current }: { label: string; detail: string; current: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <span className="text-[10px] font-medium text-gray-400 w-12 shrink-0">
          {label}
        </span>
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-gray-800 transition-all duration-500" style={{ width: "100%" }} />
        </div>
        <span className="text-[10px] tabular-nums text-right shrink-0 w-10 text-gray-500">--</span>
      </div>
      <div className="pl-[58px] flex items-center justify-between gap-2 text-[10px] text-gray-400 tabular-nums">
        <span>{detail}</span>
        <span>{current}</span>
      </div>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-500">
      {message}
    </div>
  );
}

function ProviderSection({
  title,
  active = true,
  children,
}: {
  title: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-800">{title}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-gray-300"}`} />
      </div>
      {children}
    </div>
  );
}

function formatBalance(balance: number): string {
  return Number.isInteger(balance) ? balance.toLocaleString() : balance.toFixed(2);
}

export function UsageLimitsBar() {
  const {
    todayLogs,
    weekLogs,
    claudeUsage,
    claudeUsageError,
    codexUsage,
    codexUsageError,
  } = useStore();

  const claudeTodayTokens = totalTokens(todayLogs.filter((log) => !log.provider || log.provider === "anthropic"));
  const claudeWeekTokens = totalTokens(weekLogs.filter((log) => !log.provider || log.provider === "anthropic"));
  const codexTodayTokens = totalTokens(todayLogs.filter((log) => log.provider === "openai"));
  const codexWeekTokens = totalTokens(weekLogs.filter((log) => log.provider === "openai"));

  const hasClaudeUsage = Boolean(claudeUsage?.five_hour || claudeUsage?.seven_day);
  const hasCodexUsage = Boolean(
    codexUsage?.rate_limit?.primary_window ||
    codexUsage?.rate_limit?.secondary_window ||
    codexUsage?.code_review_rate_limit?.primary_window ||
    codexUsage?.credits?.has_credits,
  );
  return (
    <div className="px-4 pt-3 pb-2.5 flex flex-col gap-3 border-b border-gray-100">
      <ProviderSection title="Claude" active={hasClaudeUsage}>
        {claudeUsageError ? (
          <ErrorRow message={claudeUsageError} />
        ) : claudeUsage?.five_hour ? (
          <>
            <LimitRow
              label="Session"
              percent={claudeUsage.five_hour.utilization}
              detail={formatResetTime(claudeUsage.five_hour.resets_at)}
            />
            {claudeUsage?.seven_day && (
              <LimitRow
                label="Weekly"
                percent={claudeUsage.seven_day.utilization}
                detail={formatResetTime(claudeUsage.seven_day.resets_at)}
              />
            )}
          </>
        ) : (
          <>
            <LimitRow
              label="Today"
              percent={usagePercent(claudeTodayTokens, DAILY_LIMIT)}
              detail="Local estimate"
            />
            <LimitRow
              label="Week"
              percent={usagePercent(claudeWeekTokens, WEEKLY_LIMIT)}
              detail="Local estimate"
            />
          </>
        )}
      </ProviderSection>

      <ProviderSection title="OpenAI" active={hasCodexUsage}>
        {codexUsageError ? (
          <ErrorRow message={codexUsageError} />
        ) : codexUsage?.rate_limit?.primary_window ? (
          <>
            <LimitRow
              label="Session"
              percent={codexUsage.rate_limit.primary_window.used_percent}
              detail={formatResetTime(codexUsage.rate_limit.primary_window.reset_at)}
            />
            {codexUsage?.rate_limit?.secondary_window && (
              <LimitRow
                label="Weekly"
                percent={codexUsage.rate_limit.secondary_window.used_percent}
                detail={formatResetTime(codexUsage.rate_limit.secondary_window.reset_at)}
              />
            )}
            {codexUsage?.code_review_rate_limit?.primary_window && (
              <LimitRow
                label="Reviews"
                percent={codexUsage.code_review_rate_limit.primary_window.used_percent}
                detail={formatResetTime(codexUsage.code_review_rate_limit.primary_window.reset_at)}
              />
            )}
            {codexUsage?.credits?.has_credits && (
              <CreditsRow
                label="Credits"
                detail={codexUsage.credits.unlimited ? "Unlimited" : `${formatBalance(codexUsage.credits.balance)} remaining`}
                current={codexUsage.credits.unlimited ? "Available" : `${formatBalance(codexUsage.credits.balance)} left`}
              />
            )}
          </>
        ) : (
          <>
            <LimitRow
              label="Today"
              percent={usagePercent(codexTodayTokens, DAILY_LIMIT)}
              detail="Local estimate"
            />
            <LimitRow
              label="Week"
              percent={usagePercent(codexWeekTokens, WEEKLY_LIMIT)}
              detail="Local estimate"
            />
          </>
        )}
      </ProviderSection>

    </div>
  );
}
