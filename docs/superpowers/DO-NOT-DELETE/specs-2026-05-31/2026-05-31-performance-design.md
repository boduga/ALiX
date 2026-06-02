# Performance Work Design

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Source:** User-requested improvement — "performance work: faster context compilation"

## Motivation

ALiX has known latency sources:

1. **Eager imports** — heavy modules (sqlite, transformers, tree-sitter) are loaded on startup even when unused
2. **No context bundle cache** — `compileContext` re-runs even for identical (task, type) pairs
3. **No benchmarks** — we have no baseline to measure against

User-perceived impact:
- Slow first-run (`alix run` takes 1-2s before the first model call)
- Repeated tasks feel slow (context rebuilt every time)
- No way to know if changes help or hurt performance

## Goals

1. **Lazy import helper** — declarative way to defer module loading
2. **Apply lazy imports** to 1-2 heavy modules as demonstration
3. **Context bundle cache** — 60s TTL on identical (task, type) pairs
4. **Startup benchmark** — baseline measurement tool

## Non-Goals

- Replacing any existing modules
- Adding new caching layers (e.g., response cache, embedding cache)
- Algorithmic complexity reduction
- Native bindings or compiled code

## Architecture

### New `src/utils/lazy-import.ts`

```typescript
export function lazy<T>(loader: () => T | Promise<T>): Lazy<T>
```

Returns a function that loads on first call, caches result, supports both sync and async loaders.

### Applied lazy imports

Wrap 1-2 heavy module imports in `src/agent/agent.ts` to demonstrate.

### Context bundle cache

In `src/repomap/context-compiler.ts`, add a `Map<string, { result, timestamp }>` with 60s TTL. Key: `${taskType}::${task}`.

### Startup benchmark

`bench/startup.ts` — measures time from process start to `cli.js` fully loaded.

## Files Affected

| Action | File |
|--------|------|
| ➕ New | `src/utils/lazy-import.ts` |
| ➕ New | `bench/startup.ts` |
| ✏️ Modify | `src/agent/agent.ts` |
| ✏️ Modify | `src/repomap/context-compiler.ts` |
| ➕ New | `tests/utils/lazy-import.test.ts` |

## Success Criteria (Achieved)

- [x] `lazy-import.ts` with TDD (3 tests)
- [x] At least 1 lazy import applied in `agent.ts`
- [x] Context bundle cache with 60s TTL
- [x] Startup benchmark
- [x] All existing tests pass
- [x] Merged to main

**Baseline measurement:** CLI load time = 84ms
