# DOX — Approvals

**Purpose:** File-backed approval queue management — create, resolve, list, and lookup pending/resolved approvals.

**Ownership:**
- `approval-store.ts` — File-backed store at `.alix/approvals/approvals.json`. Supports create, resolve, list, listPending, findPending, findResolved, get.
- CLI commands in `src/cli.ts` — `alix approvals {list|pending|show|approve|deny}`.

**Local Contracts:**
- Approvals are CLI-first. No browser POST endpoints for write actions.
- Approval records are durable JSON — full history preserved.
- `findPending` returns first match (expect at most one pending per graph/node/capability key).
- `findResolved` returns most recent resolved record for a key.
- `--enforce-capabilities` in graph run/sop run triggers approval creation via RuntimeGate.

**Work Guidance:**
- RuntimeGate (`src/policy/runtime-gate.ts`) is the primary consumer of `findPending` and `findResolved`.
- Adding new fields to ApprovalRecord means updating the type, all call sites, and the audit emission.
- CLI commands mirror the store methods: list, pending, show, approve, deny.

**Verification:**
- `tests/approvals/approval-store.test.ts` — all CRUD, persistence, lookup methods (12 tests).
