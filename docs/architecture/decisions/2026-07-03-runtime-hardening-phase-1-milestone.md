# Runtime Hardening Phase 1 — Milestone Checkpoint

**Date:** 2026-07-03
**PRs:** #172–#176
**Status:** Complete — timeouts + retry primitives + first safe boundary adoption.

## Summary

Delivered typed timeout and retry primitives for external side effects, applied them to the shell tool and provider call boundaries, and adopted retry for the first idempotent boundary (file.read). No orchestration was rewritten, no global runtime scheduler was added.

## Delivered PRs

| PR | Title | Scope |
|----|-------|-------|
| #172 | feat(runtime): add typed side-effect timeout primitive | `SideEffectTimeoutError`, `withTimeout(operation, timeoutMs, effect)` |
| #173 | feat(runtime): apply timeout wrapper to shell tool boundary | `spawnCommand()` + `withTimeout` in shell-tool; kills child process on timeout |
| #174 | feat(runtime): apply timeout wrapper to provider calls | Optional `timeoutMs` param in `withProviderContracts`; 180s default in registry |
| #175 | feat(runtime): add typed retry primitive | `RetryError`, `RetryPolicy`, `withRetry()` with exponential backoff + jitter |
| #176 | feat(runtime): apply retry to file.read (idempotent boundary) | `withRetry` wrapping `fsReadFile` in file-tools |

## Protected Boundaries

| Boundary | Primitive | Policy | Enforcement |
|----------|-----------|--------|-------------|
| Shell command execution | `withTimeout` | Via `normalizeTimeoutMs(args.timeoutMs)` | Kills child on timeout, returns error `ToolResult` |
| Provider `complete()` | `withTimeout` | 180s default via registry | `SideEffectTimeoutError` propagates through existing error handling |
| `file.read` | `withRetry` | 1 retry, 200ms base delay | Retries on `SideEffectTimeoutError` only; idempotent by nature |

Intentionally excluded from this phase:
- Provider `stream()` — no timeout (async generator pattern needs different design)
- `negotiate()` — no timeout (rarely called, low risk)
- Mutating tools (`shell.run`, `file.create`, `patch.apply`) — not safe to retry without idempotency guarantees
- MCP calls — not wired yet (deferred to boundary-specific adoption phase)

## Runtime Primitives

### `src/runtime/side-effect-timeout.ts`

```
SideEffectTimeoutError
  kind: "SideEffectTimeoutError"
  operation: string       — human-readable label
  timeoutMs: number       — configured timeout
  cause?: Error           — optional underlying error

withTimeout<T>(operation: string, timeoutMs: number, effect: () => Promise<T>): Promise<T>
  - Resolves with effect result on success before timeout
  - Rejects with SideEffectTimeoutError on timeout expiry
  - Rejects with original error if effect throws before timeout
  - Timer is cleaned up on both success and error paths
```

### `src/runtime/retry.ts`

```
RetryError
  kind: "RetryError"
  operation: string       — human-readable label
  attempts: number        — total attempts (including initial)
  lastError: unknown      — the last error before giving up

RetryPolicy
  maxRetries: number      — max retry attempts (default: 2)
  baseDelayMs: number     — exponential backoff base (default: 500)
  maxDelayMs: number      — cap on backoff (default: 10000)
  shouldRetry?: (error) => boolean  — default: retry on SideEffectTimeoutError only

withRetry<T>(operation: string, effect: () => Promise<T>, policy?: Partial<RetryPolicy>): Promise<T>
  - Non-retryable errors: rejects immediately with the original error
  - Retryable errors: waits with exponential backoff + full jitter, then retries
  - Exhausted retries: rejects with RetryError wrapping the last error
```

## Non-Goals (explicitly excluded from this phase)

- **No provider stream timeout** — async generator boundary needs a different design (timeout per-chunk vs end-to-end)
- **No `negotiate()` timeout** — rarely called, low risk
- **No retry for mutating tools** — `shell.run`, `file.create`, `patch.apply` are not safe to retry
- **No broad MCP timeout/retry** — deferred to MCP boundary adoption
- **No orchestration rewrite** — agent loop, planner, applier unchanged
- **No global runtime scheduler** — timeouts and retries are local to each call site
- **No runtime diagnostics/metrics** — deferred to next phase (#178)

## Next Recommended Phase

1. **`feat(runtime): add timeout/retry diagnostics`** (#178) — emit structured runtime diagnostics for timeout and retry events, matching the pattern from the contract diagnostics layer (#170).
2. **Async-generator timeout design for provider streams** — timeout per-chunk or end-to-end with generator cleanup.
3. **MCP boundary timeout adoption** — apply `withTimeout` to MCP tool calls.
4. **Selective retry for additional idempotent boundaries** — `dir.search`, `file.exists`.

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```

All clean: 2664 tests, 256 files, 0 type errors.
