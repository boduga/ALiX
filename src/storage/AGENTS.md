# DOX — Storage Primitives

**Purpose:** Shared durable-store I/O — JSONL append/read/parse/stream and atomic single-file JSON — so corruption, locking, and limit fixes land once and reach every store.

**Ownership:**
- `jsonl-store.ts` — `JsonlStore` (ensureDir, appendLine/appendRecord, readText/readRecords/readLastLine), `parseJsonl`/`parseJsonlLine`, `streamJsonlLines`, atomic `writeJsonFile`/`readJsonFile` in async + sync flavors.

**Local Contracts:**
- No domain logic here: no validation, hashing, filtering, or vocabularies. Stores keep those; this module owns bytes and parsing only.
- Corruption policy: blank lines skipped silently; malformed lines counted (never thrown) by parse helpers; single-file readers return null when missing and throw when malformed.
- Atomic writes use temp-file + rename with `0o600`/`wx`, matching the credential/config writers.
- `JsonlStore` accepts optional `dirMode`/`fileMode`; `fileMode` applies when `appendFile` creates the file (restrictive-permission stores, e.g. the Inspector auth audit's 0o600).
- Streaming reads stay O(1) in memory; full-file reads are the caller's explicit choice.

**Work Guidance:**
- New file-backed stores must build on this module — no direct `appendFile` and no bespoke JSONL parsing (per #712).
- Bounded/limit queries: stream via `streamJsonlLines` with a ring buffer (see `audit-store.ts`), never full-read then slice on hot paths.

**Verification:**
- `tests/storage/jsonl-store.test.ts` — parse/append/roundtrip/corruption/streaming/atomicity (repo hygiene: also asserted by `pnpm check:dead`).
