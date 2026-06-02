# MCP Client Improvements Design

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Source:** User-requested improvements from post-MVP backlog

## Motivation

ALiX's MCP client in `src/mcp/` is functional but has UX gaps:

1. **Cryptic error messages** — "ECONNREFUSED" or "timeout" with no context
2. **No retry on transient failures** — every transient network error fails the whole task
3. **No curated server list** — users have to find MCP servers themselves

These are the "I tried to use an MCP server and it didn't work" issues that block adoption.

## Goals

1. **Error normalization** — classify and format MCP errors with context (server name, tool, hint)
2. **Retry helper** — automatic retry on transient failures (ECONNREFUSED, ETIMEDOUT, etc.)
3. **Server registry** — bundled list of 7 popular MCP servers users can `alix mcp add` without researching
4. **Manager integration** — use normalized error format in `src/mcp/manager.ts`

## Non-Goals

- Replacing the existing MCP client
- Auto-discovery of MCP servers (Pi Agent has this; deferred)
- Authentication flows for MCP servers (each server's own concern)

## Architecture

### New `src/mcp/error-format.ts`

Pure functions: `formatMcpError(err)` and `classifyMcpError(err)`. Classification maps Error instances to `McpErrorKind` enum.

### New `src/mcp/retry.ts`

`withRetry(fn, options)` async helper. Exponential backoff. Custom `isRetryable` predicate.

### New `src/mcp/server-registry.ts`

Static array of `KnownServer` objects. `findServer(name)` lookup.

### Updated `src/mcp/manager.ts`

Wrap key error sites with `formatMcpError`.

## Files Affected

| Action | File |
|--------|------|
| ➕ New | `src/mcp/error-format.ts` |
| ➕ New | `src/mcp/retry.ts` |
| ➕ New | `src/mcp/server-registry.ts` |
| ✏️ Modify | `src/mcp/manager.ts` |
| ➕ New | `tests/mcp/error-format.test.ts` |
| ➕ New | `tests/mcp/retry.test.ts` |
| ➕ New | `tests/mcp/server-registry.test.ts` |

## Success Criteria (Achieved)

- [x] `error-format.ts` with classification and formatting (TDD, 7 tests)
- [x] `retry.ts` with `withRetry` helper (TDD, 4 tests)
- [x] `server-registry.ts` with 7 popular servers (TDD, 5 tests)
- [x] Manager uses normalized error format
- [x] All existing tests pass
- [x] 16 new tests total
- [x] Merged to main
