# DOX — Audit Trail

**Purpose:** Durable append-only audit trail for policy decisions, approval lifecycle, and runtime outcomes.

**Ownership:**
- `audit-types.ts` — canonical dotted `AuditAction` vocabulary (runtime, approval, conflict, governance-only) and `AuditRecord` / v2 types
- `audit-contract.ts` — canonical `AuditEventStore<TInput, TEvent, TRead>` persistence contract (append + list). #713 consolidation seam.
- `audit-store.ts` — Authoritative append-only JSONL store at `.alix/audit/audit.jsonl`, implements `AuditEventStore`. Methods: append, list, findByAction, findByGraph, findByApproval, integrityHead, activateIntegrity, verifyIntegrity. Owns both persistence and integrity (#713 step 2).
- `audit-read-model.ts` — `readUnifiedAudit(cwd, {limit, includeAuth})`: projects runtime + governance (+ optional user auth) stores onto one `UnifiedAuditRow` and merges newest-first. Bounded (streamed ring for governance/auth). Used by `GET /api/audit` and RuntimeIndex (#713 G2.1).
- `../security/audit/` — v2 hash chain, now an internal collaborator of `AuditStore` (not a parallel store): `AuditChainWriter` (redacted chained append + head sidecar + legacy activation), `audit-verifier`, `audit-checkpoint`, `audit-lock`, `canonical-json`. The CLI reaches it only through `AuditStore`.
- `../governance/audit-store.ts` — `FileAuditStore` is a domain adapter implementing `AuditEventStore` over `.alix/governance/governance-audit-events.jsonl` (own record shape + per-record chain).
- `../security/inspector/auth-audit-store.ts` — `AuthAuditStore` is a domain adapter implementing `AuditEventStore` over `<authStateDir>/audit.jsonl` (Inspector auth events; fail-closed append, 0o600).
- CLI commands in `src/cli.ts` — `alix audit {list|by-graph|by-approval|by-action|verify|activate|checkpoint|checkpoint-verify}`
- Inspector Audit tab renders audit records from `GET /api/audit`

**Local Contracts:**
- Append-only JSONL — no mutation, no deletion.
- Persistence contract (#713 step 1): every audit event store implements `AuditEventStore` (`audit-contract.ts`); the JSONL I/O primitive is `../storage/jsonl-store.ts`. Domain stores are adapters (record shaping/validation/chain), not separate persistence engines.
- Audit failures must never affect gate decisions (`.catch(() => {})`).
- Audit events emitted from RuntimeGate (8 points), ApprovalStore (request/resolve), graph continue, and policy eval.
- Persistence consolidation (#712/#713): all async JSONL persistence goes through `../storage/jsonl-store.ts` (AuditStore, governance FileAuditStore, execution evidence). The v2 hash chain is an integrity mode of `AuditStore`: after `alix audit activate` (head sidecar present), `AuditStore.append` writes redacted, hash-chained v2 records through the internal `AuditChainWriter`; before activation it writes legacy v1. `list`/`query` normalize both record versions, so queries survive activation. The chain writer's sync+fsync I/O stays bespoke for durability.
- Single audit vocabulary (#713 step 3): `AuditAction` (dotted) in `audit-types.ts` is the one canonical vocabulary. `GovernanceEventType` is a compile-time `Extract` subset of it (plus governance-only dotted additions such as `override.applied`, `tool.permission_checked`, `security.boundary_checked`). Legacy underscored governance names are mapped on read by `normalizeGovernanceEventType`; new writes are dotted. No stored-data rewrite.
- Inspector auth audit is on the same contract (#713 G1.3): `AuthAuditStore` persists through `JsonlStore`; the CLI `createFileAudit` and the server's `fileAudit` both delegate to it. `append` awaits and rethrows on failure so an auth mutation cannot succeed without its audit record (#685).
- Cross-domain read (#713 G2.1): `readUnifiedAudit` is the single read model for `GET /api/audit` and RuntimeIndex's `governance_audit` source. It is read-only and does not unify the write paths or the two chain formats; `alix audit verify --all` verifies both chains (#782).

**Work Guidance:**
- Adding a new audit action type means updating `audit-types.ts` and adding `.append()` calls at the relevant injection points.
- The RuntimeIndex aggregates audit records automatically via Source 1.

**Verification:**
- `tests/audit/audit-store.test.ts` — append, list, filter by action/graph/approval, limits (6 tests).
- `tests/audit/audit-contract.test.ts` — runtime + governance stores conform to `AuditEventStore` (#713 step 1).
- `tests/audit/audit-integrity.test.ts` — activation, chained appends, v1+v2 query normalization, honest verify (#713 step 2).
