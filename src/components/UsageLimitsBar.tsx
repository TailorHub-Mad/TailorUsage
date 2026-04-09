import type { ReactNode } from "react";
import { useStore } from "../store";
import { openUrl } from "../lib/api";
import { DAILY_LIMIT, WEEKLY_LIMIT, formatResetTime, totalTokens, usagePercent } from "../lib/usage";

function AnthropicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24">
      <path fill="currentColor" d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"/>
    </svg>
  );
}

function OpenAIIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9 6.065 6.065 0 0 0-4.604-2.901 6.046 6.046 0 0 0-5.605 4.18 5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .511 4.911 6.051 6.051 0 0 0 6.515 2.9 5.985 5.985 0 0 0 4.604 2.901 6.056 6.056 0 0 0 5.772-4.206 5.989 5.989 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 21.43a4.476 4.476 0 0 1-2.876-1.041l.141-.08 4.779-2.758a.774.774 0 0 0 .392-.681v-6.737l2.02 1.169a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.493zM3.6 17.304a4.471 4.471 0 0 1-.535-3.014l.142.085 4.783 2.759a.774.774 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062l-4.83 2.786A4.504 4.504 0 0 1 3.6 17.304zm-1.24-9.43a4.485 4.485 0 0 1 2.366-1.973v5.478a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.169a.076.076 0 0 1-.071 0l-4.83-2.787A4.504 4.504 0 0 1 2.36 7.874zm16.597 3.856-5.815-3.354 2.015-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.677a.79.79 0 0 0-.425-.697zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.207V6.875a.07.07 0 0 1 .028-.061l4.83-2.787a4.499 4.499 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.376-3.454l-.142.08-4.778 2.758a.775.775 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

const CLAUDE_LOGIN_URL = "https://claude.ai/login";
const OPENAI_LOGIN_URL = "https://chatgpt.com/auth/login";
const LOGIN_REQUIRED_ERROR = "Login required";

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

function LoginPrompt({
  provider,
  description,
  url,
}: {
  provider: string;
  description: string;
  url: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-800">Log in to {provider}</div>
          <div className="mt-1 text-xs text-gray-500">{description}</div>
        </div>
        <button
          onClick={() => openUrl(url).catch(() => {})}
          className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-700"
        >
          Log in
        </button>
      </div>
    </div>
  );
}

function ProviderSection({
  title,
  icon,
  active = true,
  children,
}: {
  title: string;
  icon?: ReactNode;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        {icon && <span className="flex items-center text-gray-400">{icon}</span>}
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
  const claudeNeedsLogin = claudeUsageError === LOGIN_REQUIRED_ERROR;
  const codexNeedsLogin = codexUsageError === LOGIN_REQUIRED_ERROR;

  return (
    <div className="px-4 pt-3 pb-2.5 flex flex-col gap-3 border-b border-gray-100">
      <ProviderSection title="Claude" icon={<AnthropicIcon />} active={hasClaudeUsage}>
        {claudeNeedsLogin ? (
          <LoginPrompt
            provider="Claude"
            description="Connect your Claude session to view live limits."
            url={CLAUDE_LOGIN_URL}
          />
        ) : claudeUsageError ? (
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

      <ProviderSection title="OpenAI" icon={<OpenAIIcon />} active={hasCodexUsage}>
        {codexNeedsLogin ? (
          <LoginPrompt
            provider="OpenAI"
            description="Connect your OpenAI session to view live limits."
            url={OPENAI_LOGIN_URL}
          />
        ) : codexUsageError ? (
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
