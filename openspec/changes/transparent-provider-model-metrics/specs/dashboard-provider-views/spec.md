# dashboard-provider-views

## ADDED Requirements

### Requirement: Per-entry ingest validation
The `/api/ingest` endpoint SHALL validate each log entry independently against a schema. Invalid entries SHALL be rejected individually with a reason, and valid entries in the same batch SHALL still be persisted. The response SHALL report accepted and rejected counts.

#### Scenario: One bad entry does not reject the batch
- **WHEN** a batch of 50 entries contains one entry with a non-numeric timestamp
- **THEN** 49 entries are persisted and the response reports 1 rejection with its index and reason

### Requirement: Per-provider developer metrics
Developer metrics SHALL track token usage per provider (at minimum `anthropic_tokens_1h` and `openai_tokens_1h`) computed over the same time window, replacing the Opus-only metrics as the primary aggregation.

#### Scenario: GPT usage appears in developer metrics
- **WHEN** a developer's ingested logs for the last hour contain only OpenAI records
- **THEN** their metrics show nonzero `openai_tokens_1h` and the dashboard does not display them as inactive

### Requirement: Provider-aware display on all views
The team, member, and repo views SHALL group usage by provider using the stored (or ingest-inferred) provider field, SHALL match model names case-insensitively, and SHALL collapse date-suffix variants of the same model into one bucket via a single shared `normalizeModel()` helper.

#### Scenario: Both providers visible side by side
- **WHEN** a member has Claude and GPT usage in the selected period
- **THEN** the member view shows both providers' usage with per-model breakdowns under each

#### Scenario: Model variants collapse
- **WHEN** logs contain `gpt-4-0613` and `gpt-4`
- **THEN** the model distribution shows a single `gpt-4` bucket with combined tokens

### Requirement: Unknown models are visible
Records with an empty or `"(unknown)"` model SHALL be displayed as a single labeled "(unknown)" bucket with their token counts, not silently filtered out of any view.

#### Scenario: Unknown bucket renders
- **WHEN** ingested records include model `"(unknown)"` with `provider: "openai"`
- **THEN** the model distribution includes an "(unknown)" entry attributed to OpenAI
