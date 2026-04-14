# OpenCode Proxy Work Log

## Goal

Make TailorUsage capture OpenCode GPT usage more reliably without requiring teammates to manually configure API keys.

## Plan

- Patch all recognized OpenAI-compatible providers in `~/.config/opencode/opencode.json`, not just `provider.openai`.
- Preserve incoming OpenAI `Authorization` headers so proxied OpenCode traffic is not broken by fallback credentials.
- Add a small in-app diagnostic when OpenAI usage exists but recent OpenAI model logs are missing.
- Add tests for provider rewriting, auth preservation logic, and the new diagnostic.

## Progress

- [x] Confirmed OpenCode model selection is provider-based (`provider/model`).
- [x] Confirmed TailorUsage only patched built-in `openai` before this change.
- [x] Implement broader OpenAI-compatible provider rewriting.
- [x] Preserve client OpenAI auth in the proxy.
- [x] Add UI warning for usage/log mismatch.
- [x] Add tests and run them.

## Implemented Changes

- Extended OpenCode config rewriting to patch all recognized OpenAI-compatible provider entries, not just `provider.openai`.
- Added conservative provider detection using provider metadata, base URLs, and model identifiers like `gpt-*`, `o*`, `codex`, and embedding/moderation models.
- Updated proxy auth behavior to preserve client-supplied OpenAI `Authorization` headers and only fall back to local credentials when the client sent none.
- Added a `WeekSection` warning when OpenAI usage is reported but no recent OpenAI logs are present.
- Added Rust tests for provider detection, provider rewriting, cleanup behavior, and OpenAI auth preservation.
- Added frontend tests for the new usage/log mismatch warning.

## Verification

- `pnpm test`: passed
- `cargo test`: passed

## Notes

- Local investigation showed successful OpenAI/OpenCode usage was not appearing in current proxy logs.
- Existing local proxy logs only showed a few old `401` OpenAI requests, which strongly suggested the successful GPT path was bypassing or being broken before logging.
