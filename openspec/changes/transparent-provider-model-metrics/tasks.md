# Tasks — Transparent Provider Model Metrics

## 1. ai-dashboard: ingestion & schema (deploy first)

- [x] 1.1 Add optional `provider: "anthropic" | "openai"` to `LogRecord` in `../ai-dashboard/lib/types.ts` and create a shared `lib/provider.ts` with case-insensitive `inferProvider(model, endpoint)` and `normalizeModel()` helpers
- [x] 1.2 Add zod per-entry validation to `app/api/ingest/route.ts`: persist valid entries, reject invalid ones individually, respond with `{accepted, rejected:[{index, reason}]}`
- [x] 1.3 Persist `provider` at ingest (verbatim when present, inferred when absent) so every new row is provider-queryable
- [x] 1.4 Replace Opus-only `DeveloperMetrics` computation with per-provider fields (`anthropic_tokens_1h`, `openai_tokens_1h`) over a consistent 1h window; keep Opus fields as derived values for backward compatibility (also fixed the 1h window comparing numeric epoch-ms `ts` against an ISO string — it never matched TailorUsage payloads)
- [x] 1.5 Add fixture test pinning the accepted ingest payload shape (both with and without `provider`) — 15 vitest tests green

## 2. ai-dashboard: display

- [x] 2.1 Route all provider attribution in `app/page.tsx`, `app/member/[id]/page.tsx`, `app/repo/[repo]/page.tsx` through the shared helper (stored provider first, inference fallback); remove inline `.includes("gpt")` / `.includes("opus")` checks
- [x] 2.2 Collapse model variants via `normalizeModel()` in all model-distribution aggregations (case-insensitive, strip date suffixes)
- [x] 2.3 Replace `isKnownLogValue` empty-model filtering with a visible "(unknown)" bucket attributed to its provider
- [x] 2.4 Add per-provider grouping (Claude vs OpenAI sections) to team, member, and repo views — provider split block on team Model Usage card, provider headers in member/repo model lists
- [x] 2.5 Deploy ai-dashboard and verify legacy TailorUsage payloads (no `provider` field) still ingest and display — deployed to tailor-hub-partner-sandbox/ai-dashboard (ai-dashboard-tailor.vercel.app); live e2e check: legacy payload accepted with provider inferred as openai, invalid entry rejected individually. FINDING: TailorUsage's hardcoded ingest URL (ai-usage-dashboard-sage.vercel.app) is an old deployment outside the team scope running stale code against the SAME InstantDB — must repoint to ai-dashboard-tailor.vercel.app (done in task 3.x)

## 3. TailorUsage: provider stamping at capture

- [x] 3.1 Write `provider` into every proxy JSONL record from listener identity in `src-tauri/src/proxy/logger.rs` / `upstream.rs` — VERIFIED already implemented: `LogEntry.provider` is a required typed field (types.rs:36), single construction site (upstream.rs:379), serialization covered by logger.rs test
- [x] 3.2 Write `provider: "openai"` into every Codex SQLite-derived record in `src-tauri/src/lib.rs` — VERIFIED already implemented at the row-builder (was lib.rs:851); the bug was the dashboard dropping the field, not capture
- [x] 3.4 (added) Repoint `DASHBOARD_INGEST_URL` from the orphaned ai-usage-dashboard-sage.vercel.app deployment (stale code, same InstantDB) to the canonical https://ai-dashboard-tailor.vercel.app/api/ingest
- [x] 3.3 Make frontend `normalizeLogRecord` (`src/lib/logs.ts`) prefer the explicit field; keep `inferProvider` as case-insensitive fallback only, and fix the `undefined`-provider hole so WeekSection's `hasRecentOpenAiLogs` matches stamped records — explicit-field preference already existed; broadened fallback inference (codex://, *codex*, ft:) for legacy lines

## 4. TailorUsage: Codex reader rework

- [x] 4.1 Add `rusqlite` (bundled) and replace the `sqlite3` shell-out with a read-only, busy-timeout connection returning typed `CodexReadStatus` (`ok` / `db-missing` / `db-locked` / `schema-mismatch` / `query-error`)
- [x] 4.2 Emit threads with NULL/empty `model` as `model: "(unknown)"` instead of filtering them in SQL
- [x] 4.3 Expose the read status to the frontend via the existing polling command payload

## 5. TailorUsage: detection breadth & bypass diagnostics

- [x] 5.1 Broaden `model_name_looks_openai` (`src-tauri/src/proxy/config_writer.rs`) to case-insensitive `gpt*` / `o<digit>*` / `*codex*` / `ft:*`, and prefer provider metadata (`provider.api`, `baseURL` host) over model names for OpenCode patching
- [x] 5.2 Create shared model-name fixtures and unit tests pinning the Rust predicate and the TS `inferProvider` to identical classifications
- [x] 5.3 Implement poll-cycle reconciliation: rate-limit usage delta > 0 with zero new OpenAI records triggers on-the-spot config re-verification and a `bypass_suspected` diagnostic with the failing config named
- [x] 5.4 Update the WeekSection warning to render the specific diagnosed cause (bypass with config detail / Codex DB status / no activity) instead of the generic message

## 6. TailorUsage: cost transparency

- [x] 6.1 Change `src/lib/cost.ts` to return no estimate for unknown models (drop the Sonnet fallback) and add current OpenAI model families to the map
- [x] 6.2 Render unknown-model usage as "unpriced" with token counts intact; separate priced vs unpriced in aggregate totals

## 7. End-to-end verification

- [x] 7.1 Run the full TailorUsage test suite — all green (repo rule), updating tests affected by provider stamping and the reader rework
- [ ] 7.2 Pilot verification: with proxy active, run one Codex/OpenCode session and confirm the GPT model appears in local Top Models and on the dashboard within one poll cycle, attributed to OpenAI
- [ ] 7.3 Negative-path verification: with Codex DB locked and with proxy env unset, confirm the warning names the correct cause in each case and never prompts for an API key
