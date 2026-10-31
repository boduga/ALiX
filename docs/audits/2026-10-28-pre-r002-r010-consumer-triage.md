# PRE-R002 / PRE-R010 current-HEAD consumer triage — 2026-10-28

**Source commit:** `43d81e989464ca7ef7b9b59ff559244bc3dad56e`  
**Scope:** static `src/` compiler project only; no retirement authorization.

## Evidence

- Fresh compiler census: `benchmark/evidence/config-consumer-inventory-2026-10-28.json` (1,465 files).
- Census counts: 30 schema-bound config-field, 221 other-declared-field, 54 unresolved-named-field, **0 dynamic-config-key unresolved**.
- Independent first-pass agent classified all 54 unresolved named references from retained local source context: 2 config consumers, 48 unrelated-domain, 4 ambiguous.
- Enclosing-function inspection established that `handleConfigShow` clones `loadConfig()` output before the three `output.model.apiKey` redaction references; a second independent agent classified all three as config consumers. The same ambiguity review classified `session/resume.ts:212` `model` as a session-summary DTO field, not RuntimeConfig.
- Final triage: **5 CONFIG_CONSUMER, 49 UNRELATED_DOMAIN, 0 AMBIGUOUS**. See `benchmark/evidence/config-consumer-triage-2026-10-28.json`.
- The five genuine references map to already documented groups: `loader.ts:265-266` legacy `modelTiers` ingestion and `config.ts:271-272` projected-model display/redaction. No new internal consumer group was discovered.

## Independent conclusion

An independent verifier accepted the strongest narrow claim: the unresolved-reference triage is closed for the scanned compiler project at the pinned source commit. It explicitly rejected full PRE-R002/PRE-R010 closure because graph completeness, runtime use, external/deep-import consumers, reflection/JSON-string consumers, files outside the compiler project, migration-policy completeness, and retirement safety remain unproven.

## Disposition

- **Internal compiler-project unresolved-reference triage:** CLOSED for `43d81e98`.
- **PRE-R002:** PARTIAL — current static classification improved; broader caller/owner/runtime/external completeness remains open.
- **PRE-R010:** PARTIAL — known internal consumer groups are reconciled; external/deep-import/reflection/runtime/graph completeness and final compatibility policy remain open.
- **Retirement/cutover authority:** unchanged; none granted by this evidence.
