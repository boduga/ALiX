# Test Coverage Improvements Design

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Source:** User-requested improvement — "add tests to undertested areas"

## Motivation

Several critical ALiX modules have no dedicated test files. The lack of tests means:

1. **Refactoring is risky** — no safety net when changing code
2. **Bugs slip through** — behavior changes go undetected
3. **Documentation gap** — tests serve as executable documentation

The undertested modules are critical (ownership tracking, rollback, event log, MCP client) — exactly the ones most likely to have subtle bugs.

## Goals

1. Add TDD tests for 10+ undertested critical modules
2. Each test file follows the project's `node:test` style
3. No production code changes — tests only

## Non-Goals

- Rewriting existing tests
- Adding tests for trivial utilities
- Achieving 100% line coverage (focus on critical paths)
- Adding E2E tests (separate concern)

## Architecture

For each module, follow the same pattern:
1. Read the source
2. Identify exported functions/classes
3. Write `node:test` style tests
4. Verify they pass
5. Commit

## Modules to Cover (12 total)

| Module | Why critical |
|--------|-------------|
| `agents/delegate-tool.ts` | Subagent delegation logic |
| `agents/ownership-registry.ts` | File ownership tracking |
| `config/validator.ts` | Config validation |
| `events/event-log.ts` | Event persistence |
| `events/replay.ts` | Session replay |
| `hooks/runner.ts` | Hook execution |
| `mcp/client.ts` | MCP client |
| `mcp/manager.ts` | MCP manager |
| `mcp/tool-discovery.ts` | Tool discovery |
| `memory/user-preference-store.ts` | User prefs |
| `patch/rollback-manager.ts` | File rollback |
| `utils/session-digest.ts` | Session digest |

## Success Criteria (Achieved)

- [x] 10 modules with new test files (2 already had tests)
- [x] 73 new tests, all passing
- [x] No production code changes
- [x] All existing tests still pass
- [x] Merged to main
