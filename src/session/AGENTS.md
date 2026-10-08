# DOX — Session Persistence

## Purpose

Crash-resilient session artifacts — conversation messages, autonomy scope, and
state-machine counters — now backed by the transactional R2 ledger.

## Ownership

- `persist.ts` — `saveMessages` / `saveScope` / `saveState` / `loadMessages` /
  `loadScope` / `loadState` / `countSavedMessages` over
  `<root>/.alix/sessions/<sessionId>/{messages.jsonl,scope.json,state.json}`.
- `session-ledger-reconcile.ts` — read-only `reconcileSessionLedger`:
  index-keyed message coverage both directions, scope/state JSON vs ledger
  fact, legacy detection, unknown-type counting, truncation reporting.
  CLI: `alix runtime reconcile-sessions` (exit 1 on drift).
- `index.ts`, `resume.ts` — session resume entry points (consume the loaders).

## Local Contracts

- **The session ledger is authoritative (R2.18); the files are a
  compatibility projection.**
  - Each save appends its fact FIRST — `session.message_appended`
    (entity id `<sessionId>#msg-<index>`, immutable index ⇒ idempotent skip
    on retry), `session.scope_saved` / `session.state_saved`
    (entity id `scope:`/`state:<sessionId>`, latest wins) — and throws on
    failure: no JSON-only session state can exist. File writes are tolerated
    and counted (`projectionFailures`) in `sessionLedgerStatus(root)`.
  - Loads read the ledger first (`lastEvent` for scope/state; index-keyed
    merge for messages where the ledger wins and legacy file lines without
    facts fill gaps); ledger db errors count and throw — never masked by a
    file fallback. `countSavedMessages` reflects authority
    (max(file lines, ledger facts)).
  - Ledger root = path prefix before `.alix` (workspace root); facts carry
    `sessionId` so cross-session replay cannot leak between projections.
  - The ledger lives at `<root>/.alix/runtime-ledger.db` (`src/storage`).

## Verification

- `tests/session/persist-ledger.test.ts` — append-first fail-closed,
  authority reads over tampered files, projection-failure tolerance,
  index-keyed merge, reconcile drift (legacy/tampered).

## Child DOX Index

None.
