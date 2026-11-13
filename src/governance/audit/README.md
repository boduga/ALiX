# Audit Trail

## Overview
Append-only audit persistence for policy decisions, approval lifecycle, runtime outcomes, and security actions. `AuditStore` owns the JSONL log and integrity mode; domain stores implement the shared `AuditEventStore` contract; `readUnifiedAudit` is the cross-domain read model; `projectRemoteDecisions` projects committed remote approval evidence into the audit chain without granting authority.

## Interface
- `AuditEventStore<TInput, TEvent, TRead>` with `append(input)` and `list()` [audit-contract.ts:AuditEventStore]
- `AuditStore` with `append`, `list`, `query`, `findByAction`, `findByGraph`, `findByApproval`, `integrityHead`, `activateIntegrity`, `verifyIntegrity`, and `path` [audit-store.ts:AuditStore]
- `AuditAppendInput`, `AuditQueryOptions`, `AuditQueryResult`, `CorruptionNotice`, and `AuditStoreOptions` [audit-store.ts:AuditAppendInput], [audit-store.ts:AuditQueryOptions], [audit-store.ts:AuditQueryResult], [audit-store.ts:AuditStoreOptions]
- `AuditAction`, `AnyAuditAction`, `SecurityAction`, `AuditDetails`, `AuditRecord`, `AuditRecordV2`, `AuditRecordV2Input`, `LegacyAuditRecord`, `AuditHead`, `ActivationResult`, and `AuditRemoteDecision` [audit-types.ts:AuditAction], [audit-types.ts:SecurityAction], [audit-types.ts:AuditRecord], [audit-types.ts:AuditRecordV2], [audit-types.ts:AuditHead], [audit-types.ts:ActivationResult]
- `isAuditRecordV2(record)` and `isLegacyAuditRecord(record)` type guards [audit-types.ts:isAuditRecordV2], [audit-types.ts:isLegacyAuditRecord]
- `readUnifiedAudit(cwd, options)`, `readGovernanceAudit(cwd, limit)`, `UnifiedAuditRow`, `AuditDomain`, `projectRuntimeRecord`, `projectGovernanceEvent`, `projectAuthRecord`, and `authAuditPath` [audit-read-model.ts:readUnifiedAudit], [audit-read-model.ts:UnifiedAuditRow], [audit-read-model.ts:projectRuntimeRecord], [audit-read-model.ts:projectGovernanceEvent], [audit-read-model.ts:projectAuthRecord]
- `projectRemoteDecisions(cwd)` with `ProjectionResult` and `ProjectionCounters` [remote-decision-projection.ts:projectRemoteDecisions], [remote-decision-projection.ts:ProjectionResult], [remote-decision-projection.ts:ProjectionCounters]

## Invariants
- The log is append-only JSONL at `.alix/audit/audit.jsonl`; the store exposes append and read operations only, with no mutation or deletion method [audit-store.ts:AuditStore]
- Integrity mode is active exactly when the `head.json` sidecar exists; active appends go through `AuditChainWriter`, inactive appends write legacy v1 records [audit-store.ts:integrityActive]
- v2 records are normalized on read to stable ids of the form `audit_v2_<seq>` while v1 records keep their stored id [audit-store.ts:streamQuery]
- Queries stream the file, retain at most `limit` matching records in a ring buffer, return newest-first, and default to 100 with a hard maximum of 1000 [audit-store.ts:streamQuery]
- Malformed JSONL lines are counted, sampled up to five physical line numbers, and surfaced as `corruption` instead of throwing [audit-store.ts:streamQuery]
- `verifyIntegrity` is honest: a legacy-only log reports `no_chain` rather than a false OK, and verification returns structured findings rather than throwing [audit-store.ts:verifyIntegrity]
- `readUnifiedAudit` reads runtime plus governance by default, adds user-scoped auth only with `includeAuth`, clamps to a default 100 and maximum 5000, and sorts merged rows newest-first [audit-read-model.ts:readUnifiedAudit]
- Auth audit is user-scoped and opt-in, so it is never injected into a project index by default [audit-read-model.ts:readUnifiedAudit]
- `projectRemoteDecisions` fails closed when the head sidecar is absent or chain verification reports any finding, and it never advances the cursor past unverified evidence [remote-decision-projection.ts:projectRemoteDecisions]
- Projection dedup is keyed by `decisionId` and reseeded from the verified audit chain, so losing the advisory checkpoint cannot cause a duplicate append [remote-decision-projection.ts:projectRemoteDecisions]
- A malformed evidence payload or failed append increments `projection_failed` and stops projection without advancing the cursor [remote-decision-projection.ts:projectRemoteDecisions]
- `credentialRef` must match `hmac-sha256:v<digits>:<token>`; a non-conforming value is treated as malformed rather than written verbatim [remote-decision-projection.ts:evidenceFromEvent]
- The projection rescans a bounded overlap of 100 ledger events and retains at most 5000 advisory decision ids [remote-decision-projection.ts:RESCAN_OVERLAP_WINDOW], [remote-decision-projection.ts:MAX_RETAINED_DECISION_IDS]

## Side Effects
- `append` creates the audit directory as needed and appends a JSONL record to `.alix/audit/audit.jsonl` [audit-store.ts:AuditStore]
- An integrity-active `append` delegates to the hash-chain writer, which publishes the head sidecar and appends a chained record [audit-store.ts:AuditStore]
- `activateIntegrity` writes legacy activation metadata and a genesis record through the chain writer [audit-store.ts:activateIntegrity]
- Chain recovery telemetry is written to stderr by default through `AuditStoreOptions.onRecovery`; recovery writes no chained record [audit-store.ts:AuditStoreOptions]
- `projectRemoteDecisions` reads committed ledger events and atomically writes advisory cursor/dedup state to `projection-state.json` beside the audit log [remote-decision-projection.ts:projectRemoteDecisions]
- `readUnifiedAudit`, `readGovernanceAudit`, and `authAuditPath` read existing JSONL files and the user state path without writing audit facts [audit-read-model.ts:readUnifiedAudit]

## Verification
- Run: `pnpm test`
