# Evidence Memory Store

## Overview
Append-only JSONL evidence ledger for trust-bearing decisions: config signing,
trust evaluation, audit checkpoints, skill-install gates, adaptation and
executive lifecycle events. Each record carries a deterministic fingerprint over
`type + timestamp + payload`, so history can be re-verified rather than trusted.
Alongside the store sit passive health reporting, best-effort history adapters for
config trust and skill installs, and two deliberately non-authorizing readiness
boundaries (monotonic witness qualification and GE-04 protected operations) that
fail closed and expose no allow path.

## Interface
- `EVIDENCE_SCHEMA_VERSION`, `EvidenceType`, `EVIDENCE_TYPES`, `EvidenceRecord` — schema version, closed type union, membership set, and the persisted record shape (`version`, `id`, `type`, `timestamp`, `fingerprint`, `payload`) [evidence-types.ts:EVIDENCE_TYPES]
- `ConfigSignedPayload`, `TrustEvaluationPayload`, `AuditCheckpointPayload`, `EvidenceCompactionPayload` — type-specific payload shapes [evidence-types.ts:ConfigSignedPayload]
- `EvidenceQuery`, `EvidenceQueryResult`, `EvidenceStoreConfig`, `CompactionResult` — filter/result/store-config/compaction contracts [evidence-types.ts:EvidenceStoreConfig]
- `EvidenceStore` — `append`, `appendBatch`, `query`, `getByFingerprint`, `compact`, `verify`, `stats` [evidence-store.ts:EvidenceStore]
- `computeFingerprint(type, timestamp, payload)` — canonical-JSON SHA-256 under the `alix-evidence-v1:` domain [evidence-store.ts:FP_DOMAIN]
- `EvidenceHealth`, `EvidenceHealthCollector.collect()` — read-only health snapshot with `status`, `chainIntegrity`, `recordCount`, `lastWriteAt`, `issues` [evidence-health.ts:EvidenceHealthCollector]
- `EVIDENCE_METRICS` — observability metric-name constants [evidence-health.ts:EVIDENCE_METRICS]
- `ConfigTrustHistory` — `recordSign`, `recordTrustEvaluation` [config-trust-history.ts:ConfigTrustHistory]
- `SkillInstallRecord`, `SkillInstallHistory.recordInstall` — approved and blocked install decisions [skill-install-history.ts:SkillInstallHistory]
- `MonotonicTrustAnchor`, `TrustAnchorSnapshot`, `WitnessChallenge`, `WitnessAssessment`, `assessMonotonicWitnessEvidence` — qualification-only witness boundary [monotonic-witness.ts:assessMonotonicWitnessEvidence]
- `ProtectedOperation`, `NativePolicyPublicationEvidence`, `Ge04SecurityReadiness`, `assessGe04NativeGovernanceReadiness`, `assertGe04ProtectedOperation` — GE-04 hold boundary [ge04-native-governance-readiness.ts:assessGe04NativeGovernanceReadiness]

## Invariants
- `append` rejects any `type` absent from `EVIDENCE_TYPES` before touching the file or the lock [evidence-store.ts:EvidenceStore]
- The fingerprint domain is fixed: `canonicalHash("alix-evidence-v1:" + canonicalStringify({type,timestamp,payload}))`, so identical payloads at the same instant are idempotent [evidence-store.ts:computeFingerprint]
- The fingerprint covers `type`, `timestamp`, and `payload` only; `id` and `version` are outside the digest [evidence-store.ts:computeFingerprint]
- `appendBatch` takes exactly one lock and stamps every record in the batch with one shared timestamp [evidence-store.ts:appendBatch]
- Every append, batch append, and compaction acquires the shared audit lock with `staleRecovery: "auto"` and releases it in `finally` [evidence-store.ts:EvidenceStore]
- `defaultQueryLimit` is 100 and `maxScanLines` is 100,000 unless configured otherwise [evidence-store.ts:DEFAULT_QUERY_LIMIT]
- `query` returns records newest-first by ISO timestamp, reports `total` as the full match count, and sets `truncated` only when `total > limit` [evidence-store.ts:query]
- Malformed JSONL lines are skipped by `query` and `compact` but are surfaced as failures by `verify` via a synthetic `id: "malformed"` record [evidence-store.ts:verify]
- `verify` is purely recomputational: it compares each stored `fingerprint` against a fresh fingerprint and reports `ok: false` on any mismatch [evidence-store.ts:verify]
- `verify` on a missing store file returns `{ ok: true, failed: [], total: 0 }` [evidence-store.ts:verify]
- `compact` never deletes history silently: old records are replaced by one `evidence_compaction` summary per type carrying count and oldest/newest timestamps [evidence-store.ts:compact]
- `compact` returns `summaryRecord: null` when no record predates the cutoff, and reports only `summaries[0]` when several types were compacted [evidence-store.ts:compact]
- Compaction rewrites through a uniquely named temp file followed by `rename`, never in place [evidence-store.ts:compact]
- The store directory is created with mode `0o755`; the lock path defaults to `<storeDir>/evidence.lock` [evidence-store.ts:ensureStoreDir]
- `EvidenceHealthCollector` reports `status` as `unknown` when the store is inaccessible, `unhealthy` on chain-integrity failure, `degraded` on stale writes with records present, otherwise `healthy` [evidence-health.ts:EvidenceHealthCollector]
- Staleness is measured against `STALE_WRITE_THRESHOLD_MS = 3600_000` (one hour) [evidence-health.ts:STALE_WRITE_THRESHOLD_MS]
- `verificationRecent` is currently always `null`; it is reserved for a future verify-timestamp signal [evidence-health.ts:EvidenceHealthCollector]
- `ConfigTrustHistory` and `SkillInstallHistory` are best-effort: failures are caught and warned, returning `null` instead of failing signing, evaluation, or install [config-trust-history.ts:ConfigTrustHistory]
- `assessMonotonicWitnessEvidence` always resolves to `status: 'blocked'`; even a fully consistent receipt reports `evidenceConsistent: true` with `authorizationGranted: false` [monotonic-witness.ts:assessMonotonicWitnessEvidence]
- Witness evidence requires an external anchor, a verifier-consumed single-use challenge with a 64-hex nonce, a structurally exact snapshot, an Ed25519 receipt under schema `ge04-r2p-witness-v1`, and head/identity binding [monotonic-witness.ts:WitnessAssessment]
- Witness snapshot and receipt validation are exact-key: unknown or missing fields fail closed [monotonic-witness.ts:validSnapshot]
- `assessGe04NativeGovernanceReadiness` always returns `status: 'blocked'`, `authorizationGranted: false`, and `securityHoldActive: true`; a matching policy fingerprint only sets `policyFingerprintMatches` [ge04-native-governance-readiness.ts:assessGe04NativeGovernanceReadiness]
- GE-04 readiness compares only against `computePolicyRevision(config)` and appends fixed hold reasons; no caller flag can satisfy them [ge04-native-governance-readiness.ts:NativePolicyPublicationEvidence]
- An invalid `ProtectedOperation` is a `TypeError`, not a blocked assessment [ge04-native-governance-readiness.ts:assessGe04NativeGovernanceReadiness]
- `assertGe04ProtectedOperation` always throws a `GE-04 SECURITY HOLD` error; it never returns [ge04-native-governance-readiness.ts:assertGe04ProtectedOperation]

## Side Effects
- Constructing an `EvidenceStore` creates `<storeDir>` recursively with mode `0o755` when absent [evidence-store.ts:ensureStoreDir]
- `append` and `appendBatch` append canonical one-line JSON records to `<storeDir>/evidence.jsonl` [evidence-store.ts:EVIDENCE_FILENAME]
- `compact` reads the whole file, writes `<file>.<uuid>.tmp`, and renames it over `evidence.jsonl` [evidence-store.ts:compact]
- Lock acquisition creates and removes `<storeDir>/evidence.lock` through the shared audit lock [evidence-store.ts:acquire]
- Records use `randomUUID()` ids and `new Date().toISOString()` timestamps [evidence-store.ts:now]
- `query`, `verify`, and `stats` read and stream `evidence.jsonl` with `createReadStream` and never write [evidence-store.ts:verify]
- `EvidenceHealthCollector` is passive on `collect()` — it reads stats, queries, and verifies but never appends or compacts [evidence-health.ts:EvidenceHealthCollector]
- `ConfigTrustHistory`, `SkillInstallHistory`, `assessMonotonicWitnessEvidence`, and the GE-04 boundary emit `console.warn`/`throw` rather than mutating evidence state on failure [config-trust-history.ts:recordSign]
- Default evidence directories are `<cwd>/.alix/security` for config trust and health, and `<home>/.alix/security` for skill installs [skill-install-history.ts:SkillInstallHistory]
- The GE-04 boundary reads config through `computePolicyRevision` and performs no I/O of its own [ge04-native-governance-readiness.ts:computePolicyRevision]

## Verification
- Run: `pnpm test`
