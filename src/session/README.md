# Session Persistence

## Overview
Session artifacts for crash-resilient resume: conversation messages, autonomy scope, and state-machine counters are committed to the transactional runtime ledger and mirrored to compatibility files under `<root>/.alix/sessions/<sessionId>/`. The ledger is authoritative; JSON/JSONL files are a tolerated projection. Resume metadata is derived from bounded reads of the persisted event log rather than the full log.

## Interface
- Session persistence API: `saveMessages`, `saveScope`, `saveState`, `saveSessionState`, `loadMessages`, `loadScope`, `loadState`, and `countSavedMessages` in `persist.ts`.
- Ledger vocabulary and identity: `SESSION_LEDGER_EVENT_TYPES`, `sessionMessageEntityId`, `sessionScopeEntityId`, and `sessionStateEntityId` in `persist.ts`.
- Authority health: `sessionLedgerStatus` and `resetSessionLedgerStatus` expose append/failure/projection counters and last errors in `persist.ts`.
- Resume API: `listSessions`, `sessionInfo`, and `reconstructSession` in `resume.ts`, re-exported with `SessionInfo` and `ReconstructedSession` types by `index.ts`.
- Plan-task sidecar validation: `isValidTasksSidecar` in `resume.ts` accepts only schema version 1 with valid task ids, integer indexes, titles, and known statuses.
- Reconciliation API: `reconcileSessionLedger` in `session-ledger-reconcile.ts` reports `SessionReconcileIssueKind` drift, unknown event types, read truncation, and an overall `ok` verdict.
- Snapshot types: `ScopeSnapshot` from `../planning/autonomy/scope-tracker.js` and `StateSnapshot` from `../planning/autonomy/state-machine.js`, re-exported by `index.ts`.

## Invariants
- Each save appends its ledger fact before writing the projection; a ledger failure throws, so no JSON-only session state can exist: `appendSessionFact` in `persist.ts`.
- Message identity is the immutable pair of session id and message index, so retries at the same index are idempotent skips rather than duplicate facts: `appendSessionFact` and `sessionMessageEntityId` in `persist.ts`.
- Scope and state facts use latest-wins entity ids (`scope:<sessionId>`, `state:<sessionId>`); their JSON files are compatibility projections: `saveScope` and `saveState` in `persist.ts`.
- Loads read the ledger first; ledger database errors are counted and rethrown rather than silently replaced by file data: `loadMessages`, `loadScope`, and `loadState` in `persist.ts`.
- Legacy message-file lines fill only indexes absent from ledger facts; ledger facts win on overlap: `loadMessages` in `persist.ts`.
- `countSavedMessages` reports the larger of file-line count and ledger fact count, reflecting authority rather than projection completeness: `countSavedMessages` in `persist.ts`.
- Projection write failures are tolerated for reads but counted in `projectionFailures` with a last error: `countProjectionFailure` in `persist.ts`.
- Session directory names accepted for listing are UUID-style or `tui-<timestamp>`; other directories are skipped: `listSessions` in `resume.ts`.
- Session status derives from bounded first-line and 64 KiB tail reads of `events.jsonl`; malformed event lines are skipped: `readFirstLine`, `readTailLines`, and `sessionInfo` in `resume.ts`.
- A resumed session prefers a valid `.tasks.json` sidecar, falls back to parsing plan markdown, and returns `undefined` only when neither exists; sidecar problems never fail resume: `resolvePlanTasks` and `reconstructSession` in `resume.ts`.
- Reconciliation is read-only, sorts issues by session and kind, and sets `ok` only when there are no issues and the ledger read was not truncated: `reconcileSessionLedger` in `session-ledger-reconcile.ts`.

## Side Effects
- Appends `session.message_appended`, `session.scope_saved`, and `session.state_saved` facts to the shared runtime ledger: `appendSessionFact` in `persist.ts`.
- Creates the session directory and appends/overwrites `messages.jsonl`, `scope.json`, and `state.json` as projections: `ensureDir`, `saveMessages`, `saveScope`, and `saveState` in `persist.ts`.
- Reads ledger events in pages of up to 2000 with a 50-page cap while loading or counting messages: `loadMessages` and `countSavedMessages` in `persist.ts`.
- Opens `events.jsonl` for bounded first-line and tail reads, and stats the session directory when no event log exists: `readFirstLine`, `readTailLines`, and `sessionInfo` in `resume.ts`.
- Reads `.alix/plans/<sessionId>.md` and `.alix/plans/<sessionId>.tasks.json` during reconstruction: `reconstructSession` and `loadTasksSidecar` in `resume.ts`.
- Streams and reads session files without mutation during reconciliation: `reconcileSessionLedger` in `session-ledger-reconcile.ts`.

## Verification
- Run: `pnpm test`
