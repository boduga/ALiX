# Operations Utilities

## Overview
Shared, dependency-light helpers used across operations, planning, and execution: cache backends, canonical JSON hashing, retrying directory search, identifier sanitizing, lazy module loading, interactive prompts, session digests, and token estimation. This package also owns the project-scoped agent memory store.

## Interface
- `CacheManager`, `InMemoryCacheManager`, `PersistentCacheManager` — common `get`/`set`/`has`/`invalidate(prefix)`/`clear`/`size` cache surface; persistent backend is file-backed [cache-manager.ts:PersistentCacheManager].
- `canonicalStringify(value)`, `canonicalHash(value)`, `canonicalHashRaw(bytes)`, `getDomainPrefix()` — deterministic JSON and SHA-256 hashing for audit records [canonical-json.ts:canonicalHash].
- `searchDirWithRetry(options)`, `DirSearchOptions`, `DirSearchResult` — recursive filename search with polling retries [dir-search.ts:searchDirWithRetry].
- `sanitizeTimestamp(iso)` — converts an ISO-8601 timestamp into an ID/filename-safe string [ids.ts:sanitizeTimestamp].
- `lazy(loader)`, `Loader<T>`, `Lazy<T>` — memoizes a sync value or shares one in-flight promise [lazy-import.ts:lazy].
- `prompt(question)`, `yesNo(question, defaultYes)`, `promptHidden(question)` — readline and raw-TTY input helpers [prompt.ts:promptHidden].
- `buildSessionDigest(sessionDir)`, `buildSessionDigestWithMemory(sessionDir, memoryDir)` — summarize file changes and memory context for a session [session-digest.ts:buildSessionDigest].
- `EstimationMetadata`, `ensureEncoder`, `estimateTokens`, `estimateMessageTokens`, `estimateBudgetTokens`, `estimateMessageBudgetTokens`, `tokenCountCacheSize`, `clearTokenCountCache` — tiktoken-based estimates plus padded budget estimates [tokens.ts:estimateBudgetTokens].
- `MemoryType`, `MemoryEntry`, `MemoryConfig`, `DEFAULT_MEMORY_CONFIG` — canonical memory types and configuration [memory/types.ts:DEFAULT_MEMORY_CONFIG].
- `memory/` — project-scoped agent memory store, recall, consolidation, and decision extraction [./memory/README.md](./memory/README.md) [memory/types.ts:MemoryEntry].

## Invariants
- `PersistentCacheManager` base64-encodes cache keys and replaces `/`, `+`, and `=` with `_` so every key maps to a flat `.cache` file; reads and writes never throw for missing or corrupt entries [cache-manager.ts:PersistentCacheManager].
- `invalidate(prefix)` is prefix-based: only keys beginning with the given prefix are removed [cache-manager.ts:PersistentCacheManager].
- Canonical serialization sorts object keys alphabetically at every nesting level while preserving array order [canonical-json.ts:serializeObject].
- Canonical serialization rejects non-finite numbers, `undefined`, functions, symbols, and bigints with stable `TypeError` messages, and normalizes `-0` to `0` [canonical-json.ts:serialize].
- `canonicalHash` covers `"alix-audit-v1:"` + canonical JSON; the same prefix is exposed by `getDomainPrefix` [canonical-json.ts:canonicalHash].
- `searchDirWithRetry` defaults to a 2000 ms retry interval and 5 retries, skips ignored directories (`.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.alix`, `.claude`), and returns paths relative to the searched root [dir-search.ts:searchDirWithRetry].
- `searchDirWithRetry` supports only `*` wildcards; `**`, `?`, and `{a,b}` are not expanded [dir-search.ts:patternToRegex].
- `sanitizeTimestamp` strips every non-alphanumeric character, including timezone offsets, so non-UTC input cannot leak separators [ids.ts:sanitizeTimestamp].
- `lazy` eagerly caches a synchronous loader result and shares the first promise for an asynchronous loader; `isLoaded()` reports whether the value has resolved [lazy-import.ts:lazy].
- `promptHidden` enables raw mode only on a TTY; on non-TTY stdin it falls back to ordinary `prompt`, and Ctrl-C exits with status 130 without accepting the value [prompt.ts:promptHidden].
- `buildSessionDigest` reads `<sessionDir>/events.jsonl`, tolerates malformed lines, and returns `null` when no created, changed, deleted, or errored files are found [session-digest.ts:buildSessionDigest].
- Token counts are cached per tokenizer and keyed by exact text, bounded to `TOKEN_COUNT_CACHE_MAX = 10_000` with oldest-insertion eviction [tokens.ts:TOKEN_COUNT_CACHE_MAX].
- The `char/4` fallback in `countTokens` is reachable only when no encoder has been loaded; budget estimators call `ensureEncoder` first [tokens.ts:estimateBudgetTokens].
- `estimateMessageTokens` adds 5 tokens of role overhead and, when a name is present, the name's token count plus 6 [tokens.ts:estimateMessageTokens].
- Budget estimates are `ceil(rawEstimate × safetyFactor)` with the safety factor defaulting to `SAFETY_FACTOR` [tokens.ts:estimateBudgetTokens].
- Memory types are `user`, `project`, `feedback`, and `reference`; defaults are decay enabled, 30 decay days, 50 entries per type, daily consolidation, and a 100-line index [memory/types.ts:DEFAULT_MEMORY_CONFIG].

## Side Effects
- `PersistentCacheManager` creates its cache directory on construction, writes `.cache` files on `set`, unlinks them on `invalidate`/`clear`, and intentionally swallows write and unlink failures [cache-manager.ts:PersistentCacheManager].
- `searchDirWithRetry` reads the filesystem and sleeps between retry attempts [dir-search.ts:searchDirWithRetry].
- `prompt`, `yesNo`, and `promptHidden` read `process.stdin` and write prompts and masking characters to `process.stdout`; `promptHidden` mutates raw-mode state and restores it on submit [prompt.ts:promptHidden].
- `buildSessionDigest` reads `events.jsonl`; `buildSessionDigestWithMemory` additionally reads the memory store at `<memoryDir>` (default `.alix/memory`) [session-digest.ts:buildSessionDigestWithMemory].
- `ensureEncoder` loads and caches the tiktoken WASM encoder once per tokenizer and logs a warning if loading fails [tokens.ts:ensureEncoder].
- The memory store persists Markdown entries plus index and session logs under the configured base path [memory/types.ts:MemoryEntry].

## Verification
- Run: `pnpm test`
