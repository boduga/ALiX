# DOX — Storage Primitives

## Purpose

Shared durable-store I/O — JSONL append/read/parse/stream and atomic single-file JSON — so corruption, locking, and limit fixes land once and reach every store.

## Ownership

- `mutation-queue.ts` — Canonical-resource FIFO admission shared across store instances in one process. It reduces local contention before callers acquire their existing cross-process locks; it never supplies persistence or authorization.
- `jsonl-store.ts` — `JsonlStore` (ensureDir, appendLine/appendRecord, readText/readRecords/readLastLine), `parseJsonl`/`parseJsonlLine`, `streamJsonlLines`, atomic `writeJsonFileAtomic`/`readJsonFile` in async + sync flavors.
- `runtime-ledger.ts` — R2 transactional runtime ledger (SQLite, better-sqlite3, project-scoped `.alix/runtime-ledger.db`): every connection pins and verifies WAL plus `synchronous=FULL`; a public durability-settings diagnostic exposes active connection values for tests because `synchronous` is connection-local; `RuntimeLedger.append` writes event + optimistic version-checked entity row + outbox row in ONE transaction; `readEvents` replays in global `ledger_seq` order with cursor/entity filters; `lastEvent(entityId, entityType?)` is the authority read (pass `entityType` whenever id spaces of domains could overlap — `runtime_entities` keys by entity_id ALONE); `getSharedLedger(cwd)` caches one connection per path (WAL + busy_timeout); `closeSharedLedger(cwd)`/`closeAllSharedLedgers()` release them — tests that remove a workspace temp dir MUST close first (Windows `EBUSY` on an open SQLite file; POSIX unlinks silently). `runtimeLedgerPath(cwd)` is the canonical path. `claimOutbox`/`markDelivered` are the outbox accessors each append enqueues into; no production projector consumes them yet (stores project inline), so they are test-exercised primitives. Shared domain-facing helpers: `appendFact(cwd, counters, input)` builds the R2 envelope, applies the precondition, accounts `{appends,failures,lastError}`, and throws on failure; `drainLedgerEvents(cwd, entityTypes)` pages a domain's events with a cursor that always advances.

## Local Contracts

- Metadata mutation admission has a ten-second idle-progress window. Completions refresh waiting writers' deadlines, so a healthy backlog is not an execution timeout. Expired waiting callbacks never run; failures release the next turn; independent resources advance separately. Check expiry before refreshing deadlines even when timer delivery is delayed. Callers still acquire the OS lock and reload authoritative state inside their admitted operation.
- No domain logic here: no validation, hashing, filtering, or vocabularies. Stores keep those; this module owns bytes and parsing only. The ledger is storage mechanics over the R2 envelope (`src/runtime-state/contracts/runtime-event.ts`); payload semantics stay with domain projectors.
- **Ledger atomicity is the contract.** Append either commits event, entity version bump, and outbox together or returns a typed failure having written nothing. Preconditions fail with `version_conflict`/`invalid_precondition`/`duplicate_event` — never partial state. Entity versions are 1-based; `expectedVersion` is the caller's read of the current version (0 = genesis).
- **Ledger durability is repository-wide.** Every `RuntimeLedger` connection uses and verifies WAL with `synchronous=FULL`; do not weaken this per subsystem. Verify settings on each reopened ALiX connection because `synchronous` is connection-local.
- **Append acquires the write lock up front (`BEGIN IMMEDIATE`).** The append transaction opens with `.immediate` so the first statement takes the write lock; the deferred default would take a read snapshot on the initial `SELECT` and upgrade to a write transaction on the later `INSERT`, which fails with `SQLITE_BUSY_SNAPSHOT` when a concurrent process commits in between — a condition `busy_timeout` cannot resolve because it is not a lock wait. Multi-process writers (scheduler + CLI + Inspector + daemon share the file) must not regress to a deferred transaction. Regression: `tests/storage/runtime-ledger-contention.test.ts`.
- **Open and append retry transient contention only.** Converting a fresh shared file to WAL can return `SQLITE_BUSY` even with `busy_timeout` set, so the constructor sets `busy_timeout` first and retries the open sequence a bounded number of times on contention (never on a durability-settings mismatch). `append()` likewise retries a transient `SQLITE_BUSY`, but still returns `version_conflict`/`invalid_precondition`/`duplicate_event` as typed results — contention and optimistic conflicts are distinct.
- Corruption policy: blank lines skipped silently; malformed lines counted (never thrown) by parse helpers; single-file readers return null when missing and throw when malformed.
- Atomic writes use temp-file + rename with `0o600`/`wx`, matching the credential/config writers.
- `JsonlStore` accepts optional `dirMode`/`fileMode`; `fileMode` applies when `appendFile` creates the file (restrictive-permission stores, e.g. the Inspector auth audit's 0o600).
- Streaming reads stay O(1) in memory; full-file reads are the caller's explicit choice.

## Work Guidance

- New file-backed stores must build on this module — no direct `appendFile` and no bespoke JSONL parsing.
- Bounded/limit queries: stream via `streamJsonlLines` with a ring buffer (see `audit-store.ts`), never full-read then slice on hot paths.

## Verification

- `tests/storage/mutation-queue.test.ts` pins FIFO, aliases, independent resources, failure cleanup, idle expiry and delayed timer delivery. `tests/storage/store-mutation-admission.test.ts` exercises independent store instances, stale CAS and externally held lock denial with durable read-back.
- `tests/storage/jsonl-store.test.ts` — parse/append/roundtrip/corruption/streaming/atomicity (repo hygiene: also asserted by `pnpm check:dead`).
- `tests/storage/runtime-ledger.test.ts` — atomic append, version conflict/duplicate rollback, envelope replay roundtrip, outbox delivery.

## Child DOX Index

None.
