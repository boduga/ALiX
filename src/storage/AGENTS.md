# DOX — Storage Primitives

## Purpose

Shared durable-store I/O — JSONL append/read/parse/stream and atomic single-file JSON — so corruption, locking, and limit fixes land once and reach every store.

## Ownership

- `jsonl-store.ts` — `JsonlStore` (ensureDir, appendLine/appendRecord, readText/readRecords/readLastLine), `parseJsonl`/`parseJsonlLine`, `streamJsonlLines`, atomic `writeJsonFileAtomic`/`readJsonFile` in async + sync flavors.
- `runtime-ledger.ts` — R2 transactional runtime ledger (SQLite, better-sqlite3, project-scoped `.alix/runtime-ledger.db`): `RuntimeLedger.append` writes event + optimistic version-checked entity row + outbox row in ONE transaction; `readEvents` replays in global `ledger_seq` order with cursor/entity filters; `claimOutbox`/`markDelivered` drive projection notification. `runtimeLedgerPath(cwd)` is the canonical path.

## Local Contracts

- No domain logic here: no validation, hashing, filtering, or vocabularies. Stores keep those; this module owns bytes and parsing only. The ledger is storage mechanics over the R2 envelope (`src/contracts/runtime-event.ts`); payload semantics stay with domain projectors.
- **Ledger atomicity is the contract.** Append either commits event, entity version bump, and outbox together or returns a typed failure having written nothing. Preconditions fail with `version_conflict`/`invalid_precondition`/`duplicate_event` — never partial state. Entity versions are 1-based; `expectedVersion` is the caller's read of the current version (0 = genesis).
- Corruption policy: blank lines skipped silently; malformed lines counted (never thrown) by parse helpers; single-file readers return null when missing and throw when malformed.
- Atomic writes use temp-file + rename with `0o600`/`wx`, matching the credential/config writers.
- `JsonlStore` accepts optional `dirMode`/`fileMode`; `fileMode` applies when `appendFile` creates the file (restrictive-permission stores, e.g. the Inspector auth audit's 0o600).
- Streaming reads stay O(1) in memory; full-file reads are the caller's explicit choice.

## Work Guidance

- New file-backed stores must build on this module — no direct `appendFile` and no bespoke JSONL parsing.
- Bounded/limit queries: stream via `streamJsonlLines` with a ring buffer (see `audit-store.ts`), never full-read then slice on hot paths.

## Verification

- `tests/storage/jsonl-store.test.ts` — parse/append/roundtrip/corruption/streaming/atomicity (repo hygiene: also asserted by `pnpm check:dead`).
- `tests/storage/runtime-ledger.test.ts` — atomic append, version conflict/duplicate rollback, envelope replay roundtrip, outbox delivery.

## Child DOX Index

None.
