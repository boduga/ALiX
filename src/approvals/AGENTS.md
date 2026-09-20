# DOX — Approvals

**Purpose:** File-backed approval queue management — create, resolve, list, and lookup pending/resolved approvals.

**Ownership:**
- `approval-store.ts` — File-backed store at `.alix/approvals/approvals.json`. Supports create, resolve, list, listPending, findPending, findResolved, get. `ApprovalRequestInput.metadata` carries a structured payload for non-tool approvals (e.g. `schedule.propose`), copied onto the record.
- `global-store.ts` — `openGlobalApprovalStore()`: the cross-project store at `~/.alix/approvals`. Schedule proposals live here so the daemon and the human see them regardless of cwd; `src/cli/helpers/approval-stores.ts` unions it with the project store for the one-inbox `alix approvals` surface.
- CLI commands in `src/cli.ts` — `alix approvals {list|pending|show|approve|deny}` (unions project + global stores).

**Local Contracts:**
- Approvals are CLI-first. No browser POST endpoints for write actions.
- Approval records are durable JSON — full history preserved.
- Approval records preserve optional canonical `agentId` correlation from execution authorization through created/resolved lifecycle events; never derive it from `workerId` or display labels.
- `findPending` returns first match (expect at most one pending per graph/node/capability key).
- `findResolved` returns most recent resolved record for a key.
- `--enforce-capabilities` in graph run/sop run triggers approval creation via RuntimeGate.

**Work Guidance:**
- RuntimeGate (`src/policy/runtime-gate.ts`) is the primary consumer of `findPending` and `findResolved`.
- Adding new fields to ApprovalRecord means updating the type, all call sites, and the audit emission (e.g. `metadata` was added for schedule proposals).
- CLI commands mirror the store methods: list, pending, show, approve, deny.

**Verification:**
- `tests/approvals/approval-store.test.ts` — all CRUD, persistence, lookup methods (12 tests).
