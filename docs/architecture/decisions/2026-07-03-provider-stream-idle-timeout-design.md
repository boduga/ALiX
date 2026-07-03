# Provider Stream Idle Timeout — Design

**Date:** 2026-07-03
**Status:** Design — implementation deferred.

## Context

Provider `complete()` already has a configurable timeout via `withTimeout` (#174). Provider `stream()` has contract validation (#166) but no timeout. Stream timeout is more subtle than `complete()` because streams can be long-running but still healthy — a long generation may produce chunks over many seconds.

This doc decides the timeout semantics and produces no implementation.

## Retry Candidates Rejected

While evaluating `file.exists` and `dir.search` for retry (#176 pattern), both were found non-actionable:

| Boundary | Tool | Why retry doesn't apply |
|----------|------|------------------------|
| `file.exists` | `existsSync` | Synchronous call — no Promise to wrap. Retry adds overhead with zero benefit. |
| `dir.search` | `readdir` + `fsReadFile` | All failures absorbed internally by catch blocks. Function never throws. `withRetry` would never trigger. |

These are correct as-is. No retry wiring needed.

## Decision: Per-Chunk Idle Timeout

Use a **per-chunk idle timeout**, not a whole-stream deadline.

### Approach

```
for each yielded chunk:
  wait for next chunk with idle timeout
  validate chunk against StreamChunkSchema
  yield chunk
  reset idle timer
```

### Rationale

| Dimension | Whole-stream deadline | Per-chunk idle timeout |
|-----------|----------------------|----------------------|
| Killing valid long generations | ❌ Kills long-running operations that are making progress | ✅ Allows arbitrarily long streams as long as chunks keep arriving |
| Catching stalled streams | ✅ Catches stalls | ✅ Catches stalls the same way |
| Implementation complexity | Simple — single setTimeout wrapping the entire generator | Slightly more complex — timer per chunk, reset on each yield |
| User model | "Total time allowed" | "Time allowed between chunks" |

Per-chunk timeout is the better semantic because:
1. Streaming progress is the relevant signal — not total wall-clock time.
2. A visible but stalled stream (no chunks for N seconds) is always a bug.
3. Chunk intervals are predictable per model/provider — easy to set a reasonable idle timeout (e.g. 30s or 60s).
4. The same pattern is used by WebSocket keep-alive and SSE reconnection logic.

### Behavior

| Event | Timeout fires | Diagnostic emitted | Chunk yielded |
|-------|--------------|-------------------|---------------|
| Chunk arrives within idle window | — | — | ✅ |
| No chunk for N seconds | ✅ SideEffectTimeoutError | ✅ runtime timeout | ❌ |
| Chunk arrives then immediate next chunk | — | — | ✅ (timer reset) |
| Valid stream completes normally | — | — | ✅ (all chunks) |
| Provider finishes without done chunk | — | — | ✅ (stream ends, timer cleanup) |

### Interaction with existing validation

Stream chunk validation (#166) and idle timeout compose independently:

```
for each yielded chunk:
  wait for next chunk with idle timeout     ← NEW: timeout applies here
  validate chunk against StreamChunkSchema  ← EXISTING: from #166
  yield chunk                               ← EXISTING
  reset idle timer                          ← NEW: timer resets after yielding
```

Both can fail independently:
- Idle timeout fires → `SideEffectTimeoutError`
- Chunk validation fails → `ContractValidationError` (same as today)

When both could fire, the timeout takes priority (it fires first since validation can't run without a chunk).

### Implementation shape (for future PR)

```typescript
async function* withStreamIdleTimeout(
  stream: AsyncGenerator<StreamChunk>,
  idleTimeoutMs: number,
): AsyncGenerator<StreamChunk> {
  const timer: { current: ReturnType<typeof setTimeout> | null } = { current: null };

  const startTimer = () => {
    timer.current = setTimeout(() => {
      timer.current = null;
    }, idleTimeoutMs);
  };

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  for await (const chunk of stream) {
    clearTimer();
    yield chunk;
    startTimer(); // reset for next chunk
  }
  clearTimer();
}
```

### Integration point

In `withProviderContracts` (#164, #166), the stream wrapper would become:

```typescript
stream: async function* (request) {
  validateNormalizedRequest(request);
  const rawStream = adapter.stream!(request);
  const timedStream = withStreamIdleTimeout(rawStream, streamIdleTimeoutMs);
  for await (const chunk of timedStream) {
    try {
      yield validateStreamChunk(chunk);
    } catch (e) {
      // existing ContractValidationError handling
      throw e;
    }
  }
}
```

This keeps concerns separated: timeout in the wrapper, validation in the existing `validateStreamChunk`.

## Non-Goals

- **No implementation in this PR** — design doc only.
- **No provider retry** — streaming retry is not idempotent (model state may have changed).
- **No whole-stream deadline** — per-chunk only. A whole-stream deadline could be layered on top later if needed.
- **No cancellation tree** — the timeout rejects the promise but doesn't cancel the provider stream (same as `withTimeout` today).
- **No dashboard/metrics** — runtime diagnostics already exist via `consoleSink`.
- **No changes to provider adapters** — the timeout lives in the wrapper, not the adapter.

## Recommended Follow-Up

```text
feat(runtime): apply idle timeout to provider streams
```

Implementation scope:
1. Add `withStreamIdleTimeout()` helper to `src/runtime/side-effect-timeout.ts` or a new file.
2. Add optional `streamIdleTimeoutMs` param to `withProviderContracts`.
3. Wire into the stream wrapper inside `withProviderContracts`.
4. Add tests: chunk within timeout yields, gap beyond timeout rejects, quick multi-chunk succeeds, diagnostic emitted on timeout.
5. No changes to provider adapters, routing, or orchestration.

## Verification (for implementation PR)

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```
