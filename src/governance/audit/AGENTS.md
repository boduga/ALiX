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
- **Crash recovery is chain-verified.** `AuditChainWriter.doAppend` reconciles the head sidecar against the persisted JSONL chain under the lock before allocating a sequence. A sidecar that exactly matches the hash-valid persisted tip is trusted (fast path); otherwise the chain is verified from genesis (`verifyAuditLog`) and a stale-but-valid sidecar that is a verified ancestor of the tip is advanced to the tip. A crash after the JSONL fsync but before the head write (`writeHeadAtomic`) therefore continues the chain at `tip.seq + 1` instead of reallocating the committed sequence. Malformed tails, sequence gaps/duplicates, hash breaks, a non-ancestor sidecar, and a legacy tail after the v2 chain **fail closed** (the append throws); recovery never truncates, rewrites, or discards committed records. Regression: `tests/audit/audit-chain-recovery.test.ts`. `audit.stale_sidecar_recovered` / `audit.recovery` remain declared vocabulary with no emitter yet.
  - **Trust boundary (fast path).** The fast path treats an exactly-matching, hash-valid sidecar as a trusted checkpoint and does not re-verify the whole chain on every append — routine appends stay O(1). Historical corruption is caught by integrity verification, not by the append path: `alix audit verify` / `AuditStore.verifyIntegrity()` (and `verify --all`) remain the operator/startup detection seam, and the recovery path fully verifies from genesis whenever the sidecar and persisted tip disagree. The recovery path's ADDED retention is O(1) — only the tip and one requested record are held, never the full record set — so head reconciliation does not grow with log size; the verifier's own `seenSeqs` duplicate-detection set still scales with record count.

## Work Guidance

- Adding a new audit action type means updating `audit-types.ts` and adding `.append()` calls at the relevant injection points.
- The RuntimeIndex aggregates audit records automatically via Source 1.

## Verification

- `tests/audit/audit-store.test.ts` — append, list, filter by action/graph/approval, limits.
- `tests/audit/audit-contract.test.ts` — runtime + governance stores conform to `AuditEventStore`.
- `tests/audit/audit-integrity.test.ts` — activation, chained appends, v1+v2 query normalization, honest verify.

## Child DOX Index

None.
