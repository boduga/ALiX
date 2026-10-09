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
- **The approval ledger is authoritative (R2.5); JSON/journal is a
  compatibility projection.** `mutate()` appends its classified diff to the
  shared transactional ledger (`.alix/runtime-ledger.db`,
  `src/storage/runtime-ledger.ts`) INSIDE the per-file lock and BEFORE the
  projection write — the append IS the commit:
  `approval.created` / `approval.updated` (full `ApprovalRecord` payload) /
  `approval.removed` (retention-prune tombstone). Append failure throws (no
  JSON-only mutation can exist); projection failure is tolerated and counted
  in `ledgerStatus().projectionFailures`. `load()` rebuilds in-memory state
  from `readLatestByEntityType("approval")`, consulting snapshot+journal only
  for legacy zero-fact records — so every reader (`get`, `list`, `findPending`,
  `findResolved`, `findExact`, …) and every subsequent `mutate()` sees ledger
  truth. Ledger db errors THROW from `load()` (counted, never masked).
  `APPROVAL_LEDGER_EVENT_TYPES` lives in `approval-types.ts` (the store is a
  protected import under the R1 freeze).
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
- `tests/approvals/approval-ledger-dualwrite.test.ts` — ledger authority (create/resolve/journal path/prune tombstone), append-failure fail-closed, projection-failure tolerance, tampered-projection ignored, reconciliation drift (legacy/mismatch/tamper).

## Child DOX Index

None.
