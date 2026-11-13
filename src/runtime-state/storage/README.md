# Storage Primitives

## Overview
Shared durable-store I/O for the repository: in-process mutation admission, JSONL parsing/append/streaming, atomic single-file JSON writes, and the SQLite-backed R2 runtime ledger. Domain stores retain validation and vocabulary; this package owns bytes, parsing, locking mechanics, and transactional durability.

## Interface
- `serializeStoreMutation(path, mutation, idleTimeoutMs)` and `StoreMutationQueueTimeoutError` [mutation-queue.ts:serializeStoreMutation], [mutation-queue.ts:StoreMutationQueueTimeoutError].
- `parseJsonlLine(line, validate)`, `parseJsonl(content, validate)`, and `JsonlParseResult` [jsonl-store.ts:parseJsonlLine], [jsonl-store.ts:parseJsonl], [jsonl-store.ts:JsonlParseResult].
- `streamJsonlLines(filePath)` for O(1)-memory line streaming [jsonl-store.ts:streamJsonlLines].
- `JsonlStore` with `ensureDir`, `appendLine`, `appendRecord`, `readText`, `readRecords`, and `readLastLine` [jsonl-store.ts:JsonlStore].
- `writeJsonFileAtomic`, `writeJsonFileAtomicSync`, `readJsonFile`, `readJsonFileSync`, and `ensureDirSync` [jsonl-store.ts:writeJsonFileAtomic], [jsonl-store.ts:readJsonFile], [jsonl-store.ts:ensureDirSync].
- `RuntimeLedger`, `LedgerAppendInput`, and `LedgerAppendResult` [runtime-ledger.ts:RuntimeLedger], [runtime-ledger.ts:LedgerAppendInput], [runtime-ledger.ts:LedgerAppendResult].
- `RuntimeLedger.entityVersion`, `lastEvent`, `readLatestByEntityType`, `readEvents`, `claimOutbox`, `markDelivered`, `durabilitySettings`, and `close` [runtime-ledger.ts:RuntimeLedger].
- `runtimeLedgerPath(cwd)`, `getSharedLedger(cwd)`, `closeSharedLedger(cwd)`, and `closeAllSharedLedgers()` [runtime-ledger.ts:runtimeLedgerPath], [runtime-ledger.ts:getSharedLedger], [runtime-ledger.ts:closeAllSharedLedgers].
- `drainLedgerEvents(cwd, entityTypes, maxPages, pageSize)`, `LedgerFactCounters`, `AppendFactInput`, `currentEntityVersion`, and `appendFact(cwd, counters, input)` [runtime-ledger.ts:drainLedgerEvents], [runtime-ledger.ts:appendFact], [runtime-ledger.ts:currentEntityVersion].

## Invariants
- Mutations are admitted FIFO per canonical resource path, including aliases resolved through existing ancestors; independent resources advance independently [mutation-queue.ts:serializeStoreMutation], [mutation-queue.ts:resourceKey].
- Queue admission is local-only and never replaces the caller's cross-process lock or authoritative reload [mutation-queue.ts:serializeStoreMutation].
- The idle window defaults to 10 seconds; healthy completions refresh waiting deadlines, and expired callbacks are rejected without running [mutation-queue.ts:serializeStoreMutation].
- Invalid or negative idle timeouts throw `RangeError` [mutation-queue.ts:serializeStoreMutation].
- Blank JSONL lines are skipped; non-blank unparseable or validator-rejected lines increment `malformed` rather than throwing [jsonl-store.ts:parseJsonl].
- `readRecords` returns empty records for a missing file, and `readLastLine` returns the last non-blank line without parsing the whole file [jsonl-store.ts:JsonlStore].
- `fileMode` applies only when JSONL append creates the file, while `dirMode` applies at directory creation [jsonl-store.ts:JsonlStore].
- Atomic JSON writes use a UUID temp file with mode `0o600` and exclusive creation, then rename into place [jsonl-store.ts:writeJsonFileAtomic].
- Single-file reads return `null` for a missing file and throw on malformed JSON, preserving the absent/corrupt distinction [jsonl-store.ts:readJsonFile].
- Every ledger connection sets `busy_timeout`, WAL, `synchronous=FULL`, and foreign keys, then verifies WAL and FULL by read-back; a mismatch fails the open [runtime-ledger.ts:openDurableLedger].
- Schema DDL executes in one idempotent transaction so the schema is never observed half-applied [runtime-ledger.ts:openDurableLedger].
- `append` rejects a non-integer or negative `expectedVersion` with `invalid_precondition` [runtime-ledger.ts:RuntimeLedger].
- An append commits the event, entity version row, and outbox row in one `BEGIN IMMEDIATE` transaction; precondition failure writes nothing [runtime-ledger.ts:RuntimeLedger].
- Entity versions are 1-based with `expectedVersion: 0` as genesis, and the event's `entityVersion` must equal `expectedVersion + 1` [runtime-ledger.ts:RuntimeLedger].
- A version mismatch returns `version_conflict`, duplicate `event_id` returns `duplicate_event`, and both roll back the whole transaction [runtime-ledger.ts:RuntimeLedger].
- Only transient `BUSY`/locked contention is retried; optimistic precondition failures are returned, never retried [runtime-ledger.ts:RuntimeLedger].
- `lastEvent` returns null for an entity with no ledger facts, and `entityType` scopes lookups when domains share id spaces [runtime-ledger.ts:RuntimeLedger].
- Replay is ledger-global ascending by `ledger_seq`, with a limit clamped to 1..10,000 [runtime-ledger.ts:RuntimeLedger].
- `drainLedgerEvents` always advances its cursor past non-matching pages and reports truncation only when the page budget is exhausted [runtime-ledger.ts:drainLedgerEvents].
- `appendFact` defaults `expectedVersion` to the committed version, defaults `entityVersion` to one greater, increments counters, and throws on failure so no JSON-only mutation survives [runtime-ledger.ts:appendFact].
- Shared ledger connections are cached per canonical `runtimeLedgerPath`; callers must close them before removing a workspace on Windows [runtime-ledger.ts:getSharedLedger], [runtime-ledger.ts:runtimeLedgerPath].

## Side Effects
- Queue admission schedules timers and starts mutations asynchronously [mutation-queue.ts:serializeStoreMutation].
- JSONL append creates directories and appends to disk; atomic JSON writes create temp files and rename them [jsonl-store.ts:JsonlStore], [jsonl-store.ts:writeJsonFileAtomic].
- `RuntimeLedger` constructs or opens the SQLite file, creating its parent directory, and executes schema DDL [runtime-ledger.ts:RuntimeLedger].
- `append` inserts into `runtime_events`, `runtime_entities`, and `runtime_outbox` [runtime-ledger.ts:RuntimeLedger].
- `markDelivered` updates the outbox delivery timestamp [runtime-ledger.ts:RuntimeLedger].
- `close`, `closeSharedLedger`, and `closeAllSharedLedgers` release SQLite connections [runtime-ledger.ts:RuntimeLedger], [runtime-ledger.ts:closeSharedLedger], [runtime-ledger.ts:closeAllSharedLedgers].
- `appendFact` reads or creates shared ledger state and mutates caller-supplied counters [runtime-ledger.ts:appendFact].

## Verification
- Run: `pnpm test`
