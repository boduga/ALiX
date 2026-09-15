# DOX — Audit Trail

**Purpose:** Durable append-only audit trail for policy decisions, approval lifecycle, and runtime outcomes.

**Ownership:**
- `audit-types.ts` — AuditAction and AuditRecord type definitions (12 action types)
- `audit-contract.ts` — canonical `AuditEventStore<TInput, TEvent>` persistence contract (append + list). #713 consolidation seam.
- `audit-store.ts` — Authoritative append-only JSONL store at `.alix/audit/audit.jsonl`, implements `AuditEventStore`. Methods: append, list, findByAction, findByGraph, findByApproval
- `../governance/audit-store.ts` — `FileAuditStore` is a domain adapter implementing `AuditEventStore` over `.alix/governance/governance-audit-events.jsonl` (own record shape + per-record chain).
- `../security/audit/` — v2 hash chain: AuditChainWriter (append + head sidecar + legacy activation), audit-verifier, audit-checkpoint. Production writes stay legacy appends; `alix audit verify` fails legacy-only logs with `no_chain` instead of false-ok; `alix audit activate` seals history; `alix audit checkpoint` auto-activates a missing head.
- CLI commands in `src/cli.ts` — `alix audit {list|by-graph|by-approval|by-action|verify|activate|checkpoint|checkpoint-verify}`
- Inspector Audit tab renders audit records from `GET /api/audit`

**Local Contracts:**
- Append-only JSONL — no mutation, no deletion.
- Persistence contract (#713 step 1): every audit event store implements `AuditEventStore` (`audit-contract.ts`); the JSONL I/O primitive is `../storage/jsonl-store.ts`. Domain stores are adapters (record shaping/validation/chain), not separate persistence engines.
- Audit failures must never affect gate decisions (`.catch(() => {})`).
- Audit events emitted from RuntimeGate (8 points), ApprovalStore (request/resolve), graph continue, and policy eval.
- Persistence consolidation (#712/#713): all async JSONL persistence goes through `../storage/jsonl-store.ts` (AuditStore, governance FileAuditStore, execution evidence). The v2 chain writer/verifier is an integrity OVERLAY on the same audit.jsonl (opt-in via `alix audit activate`), not a competing store — its sync+fsync I/O stays bespoke for durability.
- Two audit vocabularies, deliberately separate (#713, cf. #716 proposal lifecycles): dotted runtime actions (`policy.allowed`) in AuditStore vs underscored governance decisions (`action_denied`) in FileAuditStore. No boundary converts between them; unifying would mean migrating the governance analytics stack + stored data for cosmetic unity.

**Work Guidance:**
- Adding a new audit action type means updating `audit-types.ts` and adding `.append()` calls at the relevant injection points.
- The RuntimeIndex aggregates audit records automatically via Source 1.

**Verification:**
- `tests/audit/audit-store.test.ts` — append, list, filter by action/graph/approval, limits (6 tests).
- `tests/audit/audit-contract.test.ts` — runtime + governance stores conform to `AuditEventStore` (#713 step 1).
