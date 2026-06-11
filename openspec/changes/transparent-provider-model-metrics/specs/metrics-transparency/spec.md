# metrics-transparency

## ADDED Requirements

### Requirement: No user-supplied API keys
TailorUsage SHALL NOT prompt the user for any API key. All provider authentication for usage/rate-limit reads SHALL come exclusively from system-stored credentials: `~/.claude/.credentials.json` or the "Claude Code-credentials" Keychain item for Anthropic, and `auth.json` under `$CODEX_HOME`/`~/.codex`/`~/.config/codex` or the "Codex Auth" Keychain item for OpenAI. The proxy SHALL preserve client-supplied Authorization headers and only inject stored credentials when the client sent none.

#### Scenario: No credentials means degraded display, not a prompt
- **WHEN** no Codex auth material exists on the system
- **THEN** OpenAI usage bars show an unavailable state and the app never asks the user to enter a key

#### Scenario: Client OAuth tokens pass through untouched
- **WHEN** OpenCode sends its own OAuth Authorization header through the proxy
- **THEN** the upstream request carries that header unmodified

### Requirement: Local and submitted data are consistent
The per-model, per-provider breakdown shown in the TailorUsage UI SHALL be derived from the same normalized log records that are forwarded to the dashboard, so a model visible locally is always part of the submitted payload and vice versa.

#### Scenario: Locally visible model reaches the dashboard
- **WHEN** `gpt-5.3-codex` appears in the local Top Models list for the current week
- **THEN** log records with that model and `provider: "openai"` are included in the next `/api/ingest` submission

### Requirement: Unknown models are unpriced, not mispriced
Cost calculation SHALL return no estimate for models absent from the pricing map, and the UI SHALL display such usage as "unpriced" with token counts intact, instead of silently applying another model's pricing.

#### Scenario: New model shows unpriced
- **WHEN** logs contain a model with no pricing entry
- **THEN** its tokens are counted and displayed, its cost shows as unpriced, and aggregate cost totals separate priced from unpriced usage

### Requirement: Missing data is explained
WHEN provider usage is detected but corresponding model logs are absent, the UI SHALL state the diagnosed reason (proxy bypass suspected with config detail, Codex DB unreadable with read status, or no local activity) rather than a single generic message.

#### Scenario: Unreadable Codex DB is named as the cause
- **WHEN** OpenAI usage is reported and the Codex reader returned `db-locked`
- **THEN** the warning attributes missing model logs to the unreadable Codex database, not to an unproxied provider
