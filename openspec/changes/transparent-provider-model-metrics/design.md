# Design — Transparent Provider Model Metrics

## Context

TailorUsage captures AI usage through two mechanisms: a local HTTP proxy (Anthropic on `127.0.0.1:8787`, OpenAI on `127.0.0.1:8788`) that logs request/response metadata to `~/.tailor-usage-proxy/logs/{date}.jsonl`, and a fallback reader of Codex's local SQLite state (`state_5.sqlite`, `threads` table). Usage-percentage bars come from a third, independent source: provider rate-limit APIs authenticated with system-stored OAuth tokens (`~/.claude/.credentials.json`, Codex `auth.json`, macOS Keychain) — never user-supplied API keys.

The failure mode reported by the team: OpenAI usage bars show real activity, but no OpenAI *model* logs reach the UI or the dashboard. Root causes identified in review:

- Proxy bypass: OpenCode/Codex traffic that doesn't go through `:8788` produces no proxy logs, and nothing detects this after config patching.
- Codex SQLite reads shell out to `sqlite3` and swallow every failure (`src-tauri/src/lib.rs:793-835`); threads without a `model` value are excluded by the query itself.
- `provider` is inferred late (frontend `src/lib/logs.ts:69-89`, dashboard display code) from model/endpoint strings, and the inference has holes (missing model + unrecognized endpoint → `undefined`).
- ai-dashboard drops the `provider` field at ingest, stores Opus-only developer metrics, and its display filters are case-sensitive and Claude-centric.

## Goals / Non-Goals

**Goals:**
- Every log record carries an authoritative `provider` set at capture time; downstream inference is fallback-only for legacy data.
- OpenAI/Codex model names persist end-to-end: proxy → local JSONL / Codex SQLite → ingest → InstantDB → dashboard views.
- Failures are diagnosed, not silent: the local warning distinguishes "proxy bypassed" from "Codex DB unreadable" from "no activity"; the dashboard never silently hides rows.
- Per-provider aggregation on the dashboard (team, member, repo views) replacing Opus-only metrics.
- Preserve the zero-API-key design: only system-stored credentials, no prompts.

**Non-Goals:**
- No new providers (Gemini, etc.) — only Anthropic and OpenAI.
- No historical backfill of provider onto existing InstantDB rows beyond read-time inference.
- No change to how rate-limit/usage percentages are fetched (that path works).
- No redesign of the proxy transport or auth-forwarding behavior (recently fixed per `OPENCODE_PROXY_WORKLOG.md`).

## Decisions

### D1. Stamp `provider` at capture time (Rust), not inference time (TS)
The proxy already knows which listener received the request (`Provider::Anthropic` vs `Provider::Openai` in `src-tauri/src/proxy/types.rs`); the Codex SQLite reader knows its rows are OpenAI by construction. Both will write `provider: "anthropic" | "openai"` into every log record. Frontend `inferProvider` and dashboard string-matching remain only as fallbacks for pre-existing JSONL files and old DB rows.
*Alternative considered*: improving inference heuristics only — rejected because any heuristic on model strings re-breaks with each new model family (this is exactly bug #4).

### D2. Replace the `sqlite3` shell-out with `rusqlite` (bundled), surface diagnostics
The current reader silently returns `[]` when the binary is missing or the DB is locked. Use `rusqlite` with `SQLITE_OPEN_READ_ONLY` and busy-timeout; return `Result` with a typed `CodexReadStatus` (ok / db-missing / db-locked / query-error) that the frontend can render in the warning banner. Include threads with NULL `model` as `model: "(unknown)"` rather than filtering them out, so activity is visible even when the model name isn't.
*Alternative considered*: keep shell-out but log stderr — rejected; adds a runtime dependency on a user-installed binary, which is itself a silent failure source.

### D3. Proxy bypass detection via reconciliation, not packet inspection
After each poll cycle, compare the two OpenAI signals: if the rate-limit API shows usage delta > 0 over a window but neither proxy logs nor Codex SQLite produced new OpenAI records in that window, set a `bypass_suspected` diagnostic with the checked config state (are `OPENAI_BASE_URL` / opencode.json patches still in place? re-verify on the spot). The WeekSection warning then states the specific cause instead of the generic "may be using an unproxied provider".
*Alternative considered*: verifying configs on a timer regardless of activity — kept as part of the check, but reconciliation is what ties it to actual missed traffic.

### D4. Broaden OpenAI model matching to an exclusion-based rule
`model_name_looks_openai` becomes: anything matching `gpt`, `o<digit>`, `codex`, `davinci/curie-era`, or `ft:` prefixes, case-insensitive — and for the OpenCode provider-patching decision, prefer provider metadata (`provider.api`, `baseURL` host) over model-name guessing, with model names as a last resort. Mirror the same predicate in TS (`src/lib/logs.ts`) from a single shared list to avoid drift (Rust source of truth; TS copy with a unit test pinning both to the same fixtures).

### D5. Dashboard: additive `provider` field + per-entry validation
- `LogRecord` (dashboard `lib/types.ts`) gains optional `provider`; ingest persists it when present and infers (case-insensitive) when absent. Inference lives in one shared helper used by ingest and all views — display code stops doing its own `.includes("gpt")`.
- Ingest validates entries individually (zod): malformed entries are rejected and reported in the response (`{accepted, rejected: [{index, reason}]}`) instead of failing the whole batch.
- `DeveloperMetrics` replaces `opus_tokens_1h`/`opus_streak` with per-provider fields (`anthropic_tokens_1h`, `openai_tokens_1h`) plus a per-model map; existing Opus fields kept temporarily as derived values for backward compatibility of any existing UI.
- Display: model aggregation normalizes case and collapses date-suffix variants (`gpt-4-0613` → `gpt-4`) via one `normalizeModel()` helper; `(unknown)` models render as a visible bucket instead of being dropped by `isKnownLogValue`.

### D6. Cost transparency for unknown models
`src/lib/cost.ts` returns `null` (rendered as "unpriced") for models not in the map instead of defaulting to Sonnet pricing, and the map gains current OpenAI families. Totals separate "priced" from "unpriced" token counts.

### D7. Deploy order: dashboard first
Dashboard ingest must accept-and-infer before TailorUsage starts sending `provider`, so older and newer clients coexist. No flag-day.

## Risks / Trade-offs

- [Codex schema drift: `state_5.sqlite` / `threads` is an internal Codex artifact that can change between Codex releases] → version-tolerant query (check table/column existence first), and the typed read-status surfaces "schema mismatch" in the UI instead of silence.
- [Reconciliation false positives: rate-limit % can move from usage on another machine sharing the account] → phrase the diagnostic as "suspected", require the config re-verification to also fail before claiming bypass, and never block submission on it.
- [InstantDB has no real migrations: old rows lack `provider`] → read-time inference fallback stays permanently; accept that pre-change rows are best-effort.
- [Two codebases, one contract: TailorUsage and ai-dashboard can drift on the payload shape] → document the ingest payload schema in both repos and pin it with a fixture test on each side.
- [Keeping `(unknown)` rows visible may add noise to dashboards] → group them into a single labeled bucket; this is the transparency requirement working as intended.

## Migration Plan

1. Deploy ai-dashboard changes (additive schema, inference fallback) — safe with current clients.
2. Release TailorUsage with provider stamping, rusqlite reader, bypass diagnostics, cost fixes.
3. Verify end-to-end with one pilot user: confirm GPT models appear locally and on the dashboard within one poll cycle.
4. Rollback: dashboard changes are additive (revert deploy); TailorUsage rollback is a prior release DMG.

## Open Questions

- Should `(unknown)`-model Codex threads count toward token totals on the dashboard, or display-only? (Default: count them — they are real usage.)
- Is the Opus streak metric still wanted by anyone, or can the derived backward-compat fields be dropped after one release?
