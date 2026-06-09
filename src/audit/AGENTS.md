# DOX — Audit Trail

**Purpose:** Durable append-only audit trail for policy decisions, approval lifecycle, and runtime outcomes.

**Ownership:**
- `audit-types.ts` — AuditAction and AuditRecord type definitions (12 action types)
- `audit-store.ts` — Append-only JSONL store at `.alix/audit/audit.jsonl`. Methods: append, list, findByAction, findByGraph, findByApproval
- CLI commands in `src/cli.ts` — `alix audit {list|by-graph|by-approval|by-action}`
- Inspector Audit tab renders audit records from `GET /api/audit`

**Local Contracts:**
- Append-only JSONL — no mutation, no deletion.
- Audit failures must never affect gate decisions (`.catch(() => {})`).
- Audit events emitted from RuntimeGate (8 points), ApprovalStore (request/resolve), graph continue, and policy eval.

**Work Guidance:**
- Adding a new audit action type means updating `audit-types.ts` and adding `.append()` calls at the relevant injection points.
- The RuntimeIndex aggregates audit records automatically via Source 1.

**Verification:**
- `tests/audit/audit-store.test.ts` — append, list, filter by action/graph/approval, limits (6 tests).
