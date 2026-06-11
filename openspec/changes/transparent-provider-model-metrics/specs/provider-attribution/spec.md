# provider-attribution

## ADDED Requirements

### Requirement: Provider is stamped at capture time
Every log record produced by TailorUsage SHALL include an explicit `provider` field with value `"anthropic"` or `"openai"`, set by the component that captured it: the proxy listener sets it from the listener identity (port 8787 → anthropic, port 8788 → openai), and the Codex SQLite reader sets `"openai"` on every row it emits.

#### Scenario: Proxy log carries provider from listener identity
- **WHEN** a request is proxied through the OpenAI listener on port 8788, regardless of whether a `model` field could be extracted from the request or response
- **THEN** the JSONL log record written to `~/.tailor-usage-proxy/logs/` contains `provider: "openai"`

#### Scenario: Codex SQLite rows carry provider
- **WHEN** the Codex state reader emits log records from `state_5.sqlite`
- **THEN** every emitted record contains `provider: "openai"`

### Requirement: Inference is fallback-only
String-based provider inference (from endpoint paths or model names) SHALL only be applied to records that lack an explicit `provider` field, and SHALL be case-insensitive. A record with an explicit `provider` MUST NOT be reclassified by inference.

#### Scenario: Legacy record without provider is inferred
- **WHEN** a pre-existing JSONL record without a `provider` field and with model `"GPT-4o"` is normalized
- **THEN** it is classified as `provider: "openai"` despite the uppercase model name

#### Scenario: Explicit provider wins over contradictory strings
- **WHEN** a record has `provider: "openai"` and an endpoint string that does not match any known OpenAI pattern
- **THEN** the record is still treated as OpenAI everywhere (local UI, submission, dashboard)

### Requirement: Provider survives dashboard ingestion
The ai-dashboard ingest endpoint SHALL persist the `provider` field of each accepted log entry. For entries without it, ingest SHALL persist an inferred provider using the shared inference helper, so every stored row has a queryable provider value.

#### Scenario: New client payload stores provider verbatim
- **WHEN** TailorUsage submits a log entry with `provider: "openai"` to `/api/ingest`
- **THEN** the stored row in InstantDB contains `provider: "openai"` without re-inference

#### Scenario: Old client payload gets inferred provider at ingest
- **WHEN** an entry arrives without a `provider` field and with model `"o3-mini"`
- **THEN** the stored row contains `provider: "openai"` derived at ingest time
