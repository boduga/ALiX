# DOX — Approvals

## Purpose

File-backed approval queue management — create, resolve, list, and lookup pending/resolved approvals.

## Ownership

- `approval-store.ts` — File-backed store at `.alix/approvals/approvals.json`. Supports create, resolve, list, listPending, findPending, findResolved, get. `ApprovalRequestInput.metadata` carries a structured payload for non-tool approvals (e.g. `alix_schedule_propose`), copied onto the record.
- `approval-ledger-reconcile.ts` — R2.4 read-only comparison of the approvals projection (snapshot + journal replay) against the transactional ledger; reports `missing_in_ledger` / `record_mismatch` / `projection_stale` / `projection_missing` / `version_behind` / `ledger_payload_invalid`, counts unknown event types, reports truncated reads.
- `global-store.ts` — `openGlobalApprovalStore()`: the cross-project store at `~/.alix/approvals`. Schedule proposals live here so the daemon and the human see them regardless of cwd; `src/cli/helpers/approval-stores.ts` unions it with the project store for the one-inbox `alix approvals` surface.
- CLI commands in `src/cli.ts` — `alix approvals {list|pending|show|approve|deny|reconcile}` (unions project + global stores; `reconcile` is project-ledger scoped).

## Local Contracts

- Approvals are CLI-first. No browser POST endpoints for write actions.
- Approval records are durable JSON — full history preserved.
- **Every mutation dual-writes to the R2 ledger (R2.4, strangler).** `mutate()`
  mirrors its classified diff inside the per-file lock:
  `approval.created` / `approval.updated` (full `ApprovalRecord` payload) /
  `approval.removed` (retention prune or delete) to the shared transactional
  ledger (`.alix/runtime-ledger.db`, `src/storage/runtime-ledger.ts`).
  JSON/journal stays authoritative in this phase; mirror failures are counted
  in `ledgerStatus()` and reported by reconciliation — never thrown, never
  silent. `APPROVAL_LEDGER_EVENT_TYPES` lives in `approval-types.ts` (the
  store is a protected import under the R1 freeze).
- Approval records preserve optional canonical `agentId` correlation from execution authorization through created/resolved lifecycle events; never derive it from `workerId` or display labels.
- `findPending` returns first match (expect at most one pending per graph/node/capability key).
- `findResolved` returns most recent resolved record for a key.
- `--enforce-capabilities` in graph run/sop run triggers approval creation via RuntimeGate.

## Work Guidance

- RuntimeGate (`src/policy/runtime-gate.ts`) is the primary consumer of `findPending` and `findResolved`.
- Adding new fields to ApprovalRecord means updating the type, all call sites, and the audit emission.
- CLI commands mirror the store methods: list, pending, show, approve, deny.

## Verification

- `tests/approvals/approval-store.test.ts` — all CRUD, persistence, lookup methods.
- `tests/approvals/approval-ledger-dualwrite.test.ts` — ledger mirrors (create/resolve/journal fast-path/prune tombstone), reconciliation drift (legacy/mismatch/tamper), ledger-failure tolerance.

## Child DOX Index

None.
