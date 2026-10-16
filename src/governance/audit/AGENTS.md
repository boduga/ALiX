# DOX — Audit Trail

## Purpose

Durable append-only audit trail for policy decisions, approval lifecycle, and runtime outcomes.

## Ownership

- `audit-types.ts` — canonical dotted `AuditAction` vocabulary (runtime, approval, conflict, governance-only) and `AuditRecord` / v2 types
- `audit-contract.ts` — canonical `AuditEventStore<TInput, TEvent, TRead>` persistence contract (append + list). Persistence interface.
- `audit-store.ts` — Authoritative append-only JSONL store at `.alix/audit/audit.jsonl`, implements `AuditEventStore`. Methods: append, list, findByAction, findByGraph, findByApproval, integrityHead, activateIntegrity, verifyIntegrity. Owns both persistence and integrity.
- `audit-read-model.ts` — `readUnifiedAudit(cwd, {limit, includeAuth})`: projects runtime + governance (+ optional user auth) stores onto one `UnifiedAuditRow` and merges newest-first. Bounded (streamed ring for governance/auth). Used by `GET /api/audit` and RuntimeIndex.
- `../security/audit/` — v2 hash chain, an internal collaborator of `AuditStore` (not a parallel store): `AuditChainWriter` (redacted chained append + head sidecar + legacy activation), `audit-verifier`, `audit-checkpoint`, `audit-lock`. The CLI reaches it only through `AuditStore`. (`canonical-json` moved to `src/operations/utils/canonical-json.ts`.)
- `../governance/audit-store.ts` — `FileAuditStore` is a domain adapter implementing `AuditEventStore` over `.alix/governance/governance-audit-events.jsonl` (own record shape + per-record chain).
- `../security/inspector/auth-audit-store.ts` — `AuthAuditStore` is a domain adapter implementing `AuditEventStore` over `<authStateDir>/audit.jsonl` (Inspector auth events; fail-closed append, 0o600).
- CLI commands in `src/cli.ts` — `alix audit {list|by-graph|by-approval|by-action|verify|activate|checkpoint|checkpoint-verify}`
- Inspector Audit tab renders audit records from `GET /api/audit`

## Local Contracts

- Append-only JSONL — no mutation, no deletion.
- **Audit stores are intentionally NOT mirrored to the R2 runtime ledger.**
  The hash-chained append-only JSONL (v2 chain / governance chain) IS the
  integrity authority for audit facts; a second SQLite copy would be a third
  truth source, not consolidation. Ledger migration for this domain means
  eventually READING audit through one projection (`readUnifiedAudit` already
  merges for consumers) — never dual-writing it. R2.11 recorded this as a
  deliberate exception to the strangler pattern used by coordination,
  approvals, execution-state, graphs, continuations, daemon tasks,
  collaboration, replays, and evidence.
- Persistence contract: every audit event store implements `AuditEventStore` (`audit-contract.ts`); the JSONL I/O primitive is `../storage/jsonl-store.ts`. Domain stores are adapters (record shaping/validation/chain), not separate persistence engines.
- Runtime decision audit failures must never alter gate outcomes. Inspector authentication mutations are the explicit exception: an audit append failure rejects the mutation without persisting it.
- Audit events emitted from RuntimeGate, ApprovalStore (request/resolve), graph continue, and policy eval.
- Persistence consolidation: all async JSONL persistence goes through `../storage/jsonl-store.ts` (AuditStore, governance FileAuditStore, execution evidence). The v2 hash chain is an integrity mode of `AuditStore`: after `alix audit activate` (head sidecar present), `AuditStore.append` writes redacted, hash-chained v2 records through the internal `AuditChainWriter`; before activation it writes legacy v1. `list`/`query` normalize both record versions, so queries survive activation. The chain writer's sync+fsync I/O stays bespoke for durability.
- Single audit vocabulary: `AuditAction` (dotted) in `audit-types.ts` is the one canonical vocabulary. `GovernanceEventType` is a compile-time `Extract` subset of it (plus governance-only dotted additions such as `override.applied`, `tool.permission_checked`, `security.boundary_checked`). Legacy underscored governance names are mapped on read by `normalizeGovernanceEventType`; new writes are dotted. No stored-data rewrite.
- Inspector auth audit is on the same contract: `AuthAuditStore` persists through `JsonlStore`; the CLI `createFileAudit` and the server's `fileAudit` both delegate to it. `append` awaits and rethrows on failure so an auth mutation cannot succeed without its audit record.
- Cross-domain read: `readUnifiedAudit` is the single read model for `GET /api/audit` and RuntimeIndex's `governance_audit` source. It is read-only and does not unify the write paths or the two chain formats; `alix audit verify --all` verifies both chains.
- **Approval decision evidence is projected here, never mirrored into the runtime ledger.** A remote approval's authoritative `approval.updated` event (carrying the bounded remote-decision evidence defined in `src/governance/approvals/AGENTS.md`) is projected into this store by the audit subsystem, keyed idempotently by `decisionId`. The projection is one-way (ledger → audit), at-least-once, and adds no authority: it can never authorize, reverse, or weaken an approval or execution. Audit owns the dedup index and projection checkpoint; approval code only requests projection.
- **Projection crash consistency is a chain-anchored invariant.** The dedup index and projection checkpoint are advisory; the authoritative source is the verified JSONL chain. A checkpoint MUST NOT advance past evidence provably present in the verified chain, and a missing/unverified/duplicate `decisionId` MUST be re-derived by `verifyIntegrity()` plus a bounded ledger scan — never trusted from the checkpoint alone. See the crash-window finding below.
- **Projection mechanics (normative).** The projector is audit-owned and reads committed `approval.updated` evidence. Delivery is at-least-once with a `decisionId` dedup key (effectively exactly-once). The cursor is the last projected ledger `ledger_seq`, written atomically with the dedup index; re-scans overlap by a bounded window to absorb a crash-just-before-checkpoint. Inline: one attempt after the authoritative commit (failure never changes the approval outcome). Repair: bounded trigger at Inspector startup and an explicit operator command; retry on the next trigger; never a new scheduler. Integrity: appends go through the existing lock/hash-chain so seq/prevHash stay monotonic; a corrupt row is reported by `verifyIntegrity()`, never rewritten. Retention: audit rows follow audit retention, and the projection scan window is bounded by approval retention. Observability: counters `projected` / `skipped_duplicate` / `projection_failed`, plus lag = ledger high-water `ledger_seq` − checkpoint, with alerts on lag growth, duplicate detection, or chain-verification failure. The generic `runtime_outbox.delivered_at` is NOT projection state and must not be marked delivered.
- **Crash recovery is chain-verified.** `AuditChainWriter.doAppend` reconciles the head sidecar against the persisted JSONL chain under the lock before allocating a sequence. A sidecar that exactly matches the hash-valid persisted tip is trusted (fast path); otherwise the chain is verified from genesis (`verifyAuditLog`) and a stale-but-valid sidecar that is a verified ancestor of the tip is advanced to the tip. A crash after the JSONL fsync but before the head write (`writeHeadAtomic`) therefore continues the chain at `tip.seq + 1` instead of reallocating the committed sequence. Malformed tails, sequence gaps/duplicates, hash breaks, a non-ancestor sidecar, and a legacy tail after the v2 chain **fail closed** (the append throws); recovery never truncates, rewrites, or discards committed records. Regression: `tests/audit/audit-chain-recovery.test.ts`.
  - **Recovery telemetry is out-of-band, never a chained record.** Head reconciliation restores the sidecar to already-committed evidence; it is an internal maintenance operation, not a new audit fact. The writer reports it through the optional `AuditChainWriterConfig.onRecovery` sink (`AuditRecoveryEvent`): `audit.stale_sidecar_recovered` (with `previousSeq`/`recoveredSeq`) after a successful repair, `audit.recovery` (`outcome: "failed"`) when recovery fails closed, and `audit.recovery` (`outcome: "error"`) when reconciliation throws a non-recovery defect — so a genuine reconciliation bug never goes silent. Recovery does **not** append a chained audit record, consume a sequence number, or modify existing JSONL evidence — a repair therefore preserves the caller's next-sequence semantics. The sink is best-effort: a throwing sink never affects chain integrity or the append outcome. `AuditStore` forwards the sink (default: a single `[audit] {json}` line on stderr) via `AuditStoreOptions.onRecovery`. `audit.stale_lock_recovered` / `audit.genesis` remain declared vocabulary with no emitter yet.
  - **Trust boundary (fast path).** The fast path treats an exactly-matching, hash-valid sidecar as a trusted checkpoint and does not re-verify the whole chain on every append — routine appends stay O(1). Historical corruption is caught by integrity verification, not by the append path: `alix audit verify` / `AuditStore.verifyIntegrity()` (and `verify --all`) remain the operator/startup detection seam, and the recovery path fully verifies from genesis whenever the sidecar and persisted tip disagree. The recovery path's ADDED retention is O(1) — only the tip and one requested record are held, never the full record set — so head reconciliation does not grow with log size; the verifier's own `seenSeqs` duplicate-detection set still scales with record count.
- **HMAC key material for approval evidence lives in the CredentialStore, not here.** Audit only verifies/correlates; it does not own or read the secret's raw value.

## Work Guidance

- Adding a new audit action type means updating `audit-types.ts` and adding `.append()` calls at the relevant injection points.
- The RuntimeIndex aggregates audit records automatically via Source 1.

## Verification

- `tests/audit/audit-store.test.ts` — append, list, filter by action/graph/approval, limits.
- `tests/audit/audit-contract.test.ts` — runtime + governance stores conform to `AuditEventStore`.
- `tests/audit/audit-integrity.test.ts` — activation, chained appends, v1+v2 query normalization, honest verify.
- `tests/audit/remote-decision-projection.test.ts` — `projectRemoteDecisions` (SRAP): chain-anchored idempotent projection of committed remote-decision evidence keyed by `decisionId`, advisory cursor/dedup state, fail-closed on an unverifiable chain.

## Child DOX Index

None.
