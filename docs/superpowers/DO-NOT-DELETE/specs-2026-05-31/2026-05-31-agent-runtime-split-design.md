# Sub-Project #2: Agent Runtime Split

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Parent Project:** What ALiX Can Learn From Pi Agent
**Source:** Comparison with [earendil-works/pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-agent-core` splits into `agent-loop.ts`, `agent.ts`, `proxy.ts`)

## Motivation

ALiX's `src/run.ts` is a **452-line monolith** that combines:

1. **Initialization** (lines ~1-100): Config loading, event log setup, MCP manager creation, provider creation, tool execution setup
2. **Helper functions** (lines ~100-200): Building tools, error messages, context bundle payloads, model usage payloads, mutation tracking
3. **The agent loop** (lines ~200-400): The actual iterative `runTask` function — model call → tool execution → repair → loop
4. **Streaming utilities** (lines ~400-452): `shouldAutoDisableStreaming`, stream handlers

This makes `run.ts` hard to test (the loop is intertwined with initialization), hard to understand (everything is in one file), and hard to modify (changes to message building affect the loop).

Pi Agent solves this by splitting `pi-agent-core` into three focused modules:
- `agent.ts` — High-level agent (initialization, state)
- `agent-loop.ts` — The core iteration loop
- `proxy.ts` — Message routing

## Goals

1. **Decompose `run.ts`** into 3 focused modules with clear responsibilities
2. **Make the agent loop testable in isolation** — without initializing the full agent
3. **Preserve all existing exports** — zero changes to consumers
4. **Improve cohesion** — each module does one thing well

## Non-Goals

- Changing the public API of `runTask` (consumers don't need to update)
- Adding new features
- Optimizing the loop
- Refactoring `run.ts` helpers (move them, don't rewrite them)

## Architecture

### Current State
```
src/
├── run.ts  (452 lines, does everything)
├── cli.ts  (imports from run.ts)
└── tests/run*.test.ts  (tests against the monolith)
```

### Target State
```
src/agent/
├── index.ts            (re-exports for back-compat, ~10 lines)
├── agent.ts            (initialization: config, event log, MCP, provider, tools; ~150 lines)
├── agent-loop.ts       (the iterative loop: model → tool → repair, ~150 lines)
├── messages.ts         (message-building helpers: buildToolsForProvider, buildErrorMessage, buildContextBundleEventPayload, etc., ~120 lines)
├── stream.ts           (streaming utilities: shouldAutoDisableStreaming, ~30 lines)
└── mutations.ts        (mutation tracking: extractMutationPaths, recordMutationInSessionState, ~50 lines)
```

`src/run.ts` becomes a thin re-export shim (~5 lines):
```typescript
export { runTask } from "./agent/agent-loop.js";
export { shouldAutoDisableStreaming } from "./agent/stream.js";
// etc.
```

### Module Responsibilities

**`agent/agent.ts`** — Initialization
- `initAgent(cwd, opts): AgentContext` — sets up config, event log, MCP, provider, tools
- Returns a structured `AgentContext` object with all dependencies

**`agent/agent-loop.ts`** — The Loop
- `runTask(agentCtx, task, opts, onStream)` — the iterative LLM → tool → repair cycle
- Imports from `agent.ts` for context, `messages.ts` for helpers

**`agent/messages.ts`** — Message Building
- `buildToolsForProvider`, `buildErrorMessage`, `buildContextBundleEventPayload`, `buildModelUsageEventPayload`, `renderContextBundleForPrompt`, etc.
- Pure functions, easy to test in isolation

**`agent/stream.ts`** — Streaming
- `shouldAutoDisableStreaming()`, `StreamHandler` type

**`agent/mutations.ts`** — Mutation Tracking
- `extractMutationPaths`, `recordMutationInSessionState`

## Data Flow

```
runTask(cwd, task, opts, onStream)
   ↓
[initAgent(cwd, opts)]  ← agent.ts
   ↓ returns AgentContext { config, eventLog, mcp, provider, tools, ... }
[runTask(ctx, task, opts, onStream)]  ← agent-loop.ts
   ↓
   [loop]
     → model.complete(messages)         ← uses messages.ts to build request
     → executeTools(toolCalls)          ← uses tools from ctx
     → on event: buildContextBundlePayload(...)  ← messages.ts
     → repair if failed
```

## Error Handling

- No changes to error handling. Errors are caught and recorded as before.
- Each module exports its own types so errors propagate cleanly.

## Testing Strategy

### 1. Message-building helpers (pure functions, easy)
- Test `buildToolsForProvider` with various provider preferences
- Test `buildErrorMessage` with various error kinds
- Test `buildContextBundleEventPayload` round-trip

### 2. Streaming utilities (simple)
- Test `shouldAutoDisableStreaming` in CI vs TTY

### 3. Mutation tracking (state)
- Test `extractMutationPaths` with various tool arg shapes
- Test `recordMutationInSessionState` with mock session

### 4. Agent context (integration)
- Test `initAgent` produces a valid context (mock config)
- Test the loop runs (mock provider)

### 5. Compatibility regression
- All existing tests must continue to pass

## Files Affected

| Action | File | Reason |
|--------|------|--------|
| ✏️ Move | `src/run.ts` → `src/agent/{multiple files}` | Decompose monolith |
| ➕ New | `src/agent/index.ts` | Back-compat re-exports |
| ✏️ Modify | `src/cli.ts` | Update import path (one line) |
| ✏️ Keep | `src/run.ts` (shim) | Re-export for back-compat |
| ➕ New | `tests/agent/messages.test.ts` | New tests for messages.ts |
| ➕ New | `tests/agent/mutations.test.ts` | New tests for mutations.ts |
| ➕ New | `tests/agent/stream.test.ts` | New tests for stream.ts |

## Migration Strategy

1. **Create new files first** (no breaking changes): copy helpers to `src/agent/`
2. **Make `run.ts` a re-export shim** that imports from `src/agent/`
3. **Move the loop** to `src/agent/agent-loop.ts` (largest piece)
4. **Move initialization** to `src/agent/agent.ts`
5. **Verify all existing tests pass** at each step

## Success Criteria

- [ ] `src/run.ts` reduced to < 10 lines (just re-exports)
- [ ] `src/agent/` created with 5 focused files
- [ ] All existing tests pass without modification
- [ ] New tests added for messages.ts, mutations.ts, stream.ts
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (1164+ pass, 0 fail)

## Out of Scope (Other Sub-Projects)

- Sub-project #3: TUI differential rendering
- Sub-project #4: Supply-chain hardening
- Sub-project #5: Self-extensibility improvements
- Sub-project #6: Public session sharing
