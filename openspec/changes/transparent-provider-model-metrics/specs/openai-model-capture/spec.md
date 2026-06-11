# openai-model-capture

## ADDED Requirements

### Requirement: Codex local state is read without silent failure
TailorUsage SHALL read Codex thread history from `state_5.sqlite` using an embedded SQLite library (no dependency on a user-installed `sqlite3` binary), opened read-only with a busy timeout, and SHALL report a typed read status (`ok`, `db-missing`, `db-locked`, `schema-mismatch`, `query-error`) instead of returning an empty list on failure.

#### Scenario: Locked database is reported, not swallowed
- **WHEN** Codex is actively writing and the database cannot be read within the busy timeout
- **THEN** the reader returns status `db-locked` and the UI warning reflects that Codex history is temporarily unreadable

#### Scenario: Missing database distinguishes from no activity
- **WHEN** no `state_5.sqlite` exists in `$CODEX_HOME`, `~/.codex`, or `~/.config/codex`
- **THEN** the reader returns status `db-missing`, and zero OpenAI logs with status `ok` is not conflated with this case

### Requirement: Model-less Codex threads remain visible
Codex threads whose `model` column is NULL or empty SHALL be emitted as log records with model `"(unknown)"` rather than being excluded by the query.

#### Scenario: Thread without model still counts as OpenAI activity
- **WHEN** a Codex thread row has token counts but no model value
- **THEN** a log record with `provider: "openai"` and `model: "(unknown)"` is emitted and forwarded to the dashboard

### Requirement: OpenAI model detection covers current and future families
Anywhere a model name is used to decide OpenAI affiliation (OpenCode provider patching, legacy inference), the predicate SHALL match case-insensitively the families `gpt*`, `o<digit>*`, `*codex*`, and `ft:*` fine-tune IDs, and OpenCode provider patching SHALL prefer provider metadata (`provider.api`, `baseURL` host) over model-name matching. The Rust and TypeScript implementations SHALL be pinned to identical shared test fixtures.

#### Scenario: Future GPT version is detected
- **WHEN** an OpenCode provider config lists only the model `gpt-5.4-codex-mini`
- **THEN** the provider is recognized as OpenAI-compatible and patched to route through the proxy

#### Scenario: Rust and TS predicates agree
- **WHEN** the shared model-name fixture list is run against both the Rust and TypeScript predicates
- **THEN** both produce identical classifications for every fixture

### Requirement: Proxy bypass is detected and explained
After each polling cycle, TailorUsage SHALL reconcile OpenAI rate-limit usage deltas against newly captured OpenAI log records. WHEN usage increased but no new OpenAI records were captured from either source, the app SHALL re-verify the proxy configuration (env vars, `opencode.json` patches) and surface a diagnostic stating the suspected cause.

#### Scenario: Bypass produces a specific warning
- **WHEN** the Codex rate-limit API shows increased usage over the last poll window, no new OpenAI logs were captured, and config re-verification finds `OPENAI_BASE_URL` no longer points at the proxy
- **THEN** the warning names the un-patched configuration as the suspected cause instead of the generic "may be using an unproxied provider"

#### Scenario: Cross-machine usage does not claim bypass
- **WHEN** usage increased without new local logs but the local proxy configuration verifies as intact
- **THEN** the diagnostic is phrased as suspected/unconfirmed and submission to the dashboard is not blocked
