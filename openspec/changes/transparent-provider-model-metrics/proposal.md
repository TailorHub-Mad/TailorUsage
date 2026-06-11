# Transparent Provider Model Metrics

## Why

Employees' OpenAI/Codex model usage is not reliably persisted or visible: TailorUsage shows the warning "OpenAI usage was detected, but no recent OpenAI model logs were captured" while the Codex rate-limit bars prove real activity (e.g. 58% session), and the ai-dashboard cannot attribute or aggregate GPT usage at all. A full review of both codebases found the pipeline silently drops OpenAI model data at several points, breaking the goal of a 100% transparent, zero-API-key metric system across both providers.

### Review findings (what's buggy today)

**TailorUsage (capture side):**

1. **OpenAI usage % and OpenAI model logs come from different sources that fail independently.** Usage bars read the Codex rate-limit API (`src-tauri/src/lib.rs:405-421`) and work; model names require either proxied traffic (`~/.tailor-usage-proxy/logs/*.jsonl`) or Codex's `state_5.sqlite` — both can silently produce nothing.
2. **Codex SQLite reads fail silently** (`src-tauri/src/lib.rs:793-835`): missing `sqlite3` binary, locked DB while Codex runs, or empty results all return `[]` with no diagnostic. Threads with a NULL/empty `model` are filtered out entirely (`coalesce(model,'') <> ''`).
3. **Provider inference is brittle** (`src/lib/logs.ts:69-89`): if a log's `model` is missing and its endpoint is unrecognized, `provider` stays `undefined`, so the log doesn't count as OpenAI — the warning fires even when logs exist.
4. **Hardcoded OpenAI model patterns** (`src-tauri/src/proxy/config_writer.rs:307-317`): `model_name_looks_openai` misses future families (`gpt-5.x` variants, `o2`, fine-tune IDs), so OpenCode providers using them may not get proxy-patched.
5. **No bypass detection**: after patching OpenCode/Claude configs, nothing verifies traffic actually flows through the proxy (confirmed unresolved in `OPENCODE_PROXY_WORKLOG.md`).
6. **Cost map falls back to Sonnet pricing for every unknown model** (`src/lib/cost.ts:4-26`), silently misreporting cost for anything new.

**ai-dashboard (display side):**

7. **No `provider` field anywhere** (`lib/types.ts:1-14`, `app/api/ingest/route.ts:23-38`): TailorUsage actually sends `provider` in each log record, but ingest drops it; provider must then be re-inferred from model strings at display time.
8. **DeveloperMetrics is Opus-only** (`lib/types.ts:21-28`, `app/api/ingest/route.ts:67-83`): only `opus_tokens_1h`/`opus_streak` exist; GPT usage has no metric at all.
9. **Display filters silently hide records**: `isKnownLogValue` drops empty-model rows (`app/page.tsx:28-31`); provider coloring uses lowercase `.includes("gpt")` (`app/page.tsx:1207-1212`); `shortModel()` only normalizes Claude names. Model variants (`gpt-4` vs `gpt-4-0613`) split into separate buckets.
10. **Ingest has no schema validation** and a whole-batch catch: one malformed entry rejects the entire batch (`app/api/ingest/route.ts:47-52`).

The zero-API-key requirement is currently honored (credentials are read from `~/.claude/.credentials.json`, Codex `auth.json`, and the system Keychain only — never prompted), and this change must preserve that.

## What Changes

- **TailorUsage**: make OpenAI model capture robust — emit explicit `provider` on every log record at capture time (proxy and Codex SQLite paths), replace the brittle SQLite shell-out with diagnosed reads (surface errors instead of returning `[]`), include model-less Codex threads as `(unknown)` instead of dropping them, broaden OpenAI model detection patterns, and add a proxy health/bypass check so the warning can say *why* logs are missing.
- **TailorUsage**: fix the cost map fallback to mark unknown models as unpriced rather than silently billing them as Sonnet.
- **ai-dashboard**: persist `provider` on ingested log records (with inference fallback for legacy payloads), validate payloads per-entry instead of per-batch, and normalize model names case-insensitively.
- **ai-dashboard**: extend developer metrics and all views (main, member, repo) with per-provider aggregation so Claude and OpenAI usage are both first-class; replace Opus-only metrics with per-provider equivalents.
- **No API-key prompts introduced anywhere** — continue reading only system-stored credentials.

## Capabilities

### New Capabilities
- `provider-attribution`: every captured log record carries an explicit, authoritative `provider` (anthropic | openai) from capture through ingestion to display; inference from model/endpoint strings is only a fallback for legacy data.
- `openai-model-capture`: OpenAI/Codex model names are reliably captured from proxy logs and Codex local state, with diagnosed (non-silent) failure modes and coverage for current and future model families.
- `metrics-transparency`: the local app and the dashboard show the same per-provider, per-model picture; missing data is explained (proxy bypass, unreadable Codex DB) rather than silently absent; unknown models are visible as unpriced/unknown rather than dropped or mispriced.
- `dashboard-provider-views`: ai-dashboard ingestion validates per-entry, stores provider, and aggregates per-provider metrics for developer, repo, and team views.

### Modified Capabilities
<!-- none — openspec/specs/ is empty; all capabilities are new -->

## Impact

- **TailorUsage**: `src-tauri/src/proxy/logger.rs`, `src-tauri/src/proxy/upstream.rs`, `src-tauri/src/proxy/config_writer.rs`, `src-tauri/src/lib.rs` (Codex SQLite reader, dashboard forwarder), `src/lib/logs.ts`, `src/lib/cost.ts`, `src/components/sections/WeekSection.tsx`, `src/hooks/usePolling.ts`. Existing tests must stay green (repo rule).
- **ai-dashboard** (separate repo at `../ai-dashboard`): `app/api/ingest/route.ts`, `app/api/usage/route.ts`, `lib/types.ts`, `app/page.tsx`, `app/member/[id]/page.tsx`, `app/repo/[repo]/page.tsx`. Schema addition (`provider` field) is backward compatible — legacy rows fall back to inference.
- **Data contract**: ingest payload gains a required-when-present `provider` field; older TailorUsage clients remain accepted (inference fallback), so no flag-day deploy needed. Dashboard should deploy first.
