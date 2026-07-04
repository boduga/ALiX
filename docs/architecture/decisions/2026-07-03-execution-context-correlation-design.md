# Execution Context & Correlation — Design

**Date:** 2026-07-03
**Status:** Design — implementation deferred.

## Context

Phases #160–#190 delivered typed runtime contracts, timeout/retry hardening, durable diagnostics, and a CLI diagnostics query. Diagnostics are persisted and queryable but lack execution context — there is no way to answer "which agent, run, session, or workflow produced this diagnostic?"

This design defines how execution context should flow through ALiX's existing boundaries and attach to diagnostics, tool calls, provider calls, and evidence events — without changing hardened boundary behavior.

## Current state

| Question | Answerable today? |
|----------|-------------------|
| What failed? | ✅ Yes — diagnostic event has boundary, error, severity |
| When did it fail? | ✅ Yes — timestamp |
| Which type? | ✅ Yes — contract vs runtime |
| **Which agent?** | ❌ No |
| **Which run?** | ❌ No |
| **Which session?** | ❌ No |
| **Which workflow/step?** | ❌ No |
| **Which provider/model?** | ✅ Partially — provider id available in some boundaries |
| **Which tool call?** | ❌ No |

## Proposed `ExecutionContext` shape

```typescript
interface ExecutionContext {
  /** Unique identifier for a top-level run (e.g. agent task, CLI command). */
  runId?: string;
  /** Session identifier for continuity across invocations. */
  sessionId?: string;
  /** The agent or subagent performing the work. */
  agentId?: string;
  /** Workflow or SOP identifier when operating under a defined process. */
  workflowId?: string;
  /** Step number or identifier within a workflow. */
  stepId?: string;
  /** Tool call identifier for tool execution tracking. */
  toolCallId?: string;
  /** Provider identifier (e.g. "anthropic", "openai"). */
  providerId?: string;
  /** Model name (e.g. "claude-opus-4-8"). */
  model?: string;
  /** Optional parent run ID for nesting/subagent traces. */
  parentRunId?: string;
}
```

All fields are optional. The context accumulates as execution flows through boundaries — a provider call inside a tool call inside a workflow step carries all three identifiers.

## Flow through boundaries

### Provider `complete()` / `stream()`

```
ExecutionContext gets:
  runId, sessionId, agentId  ← from the agent loop or CLI command
  providerId, model           ← from the adapter/capabilities
  toolCallId                  ← from the tool executor (if called from a tool)

Carried through:
  NormalizedRequest (new field)
  RuntimeDiagnostic (new field)
```

### Shell tool execution

```
ExecutionContext gets:
  runId, sessionId, agentId  ← from caller
  toolCallId                 ← from the tool executor

Carried through:
  withTimeout callback (new optional parameter)
  RuntimeDiagnostic (new field)
```

### MCP `callTool()`

```
ExecutionContext gets:
  runId, sessionId, agentId  ← from caller
  toolCallId                 ← from MCP manager

Carried through:
  McpClient.callTool() (new optional parameter)
  RuntimeDiagnostic (new field)
```

### File tools

```
ExecutionContext gets:
  runId, sessionId, agentId  ← from caller
  toolCallId                 ← from tool executor

Carried through:
  file-tools functions (new optional parameter)
  withRetry callback
  RuntimeDiagnostic (new field)
```

### Planning / adaptation / evidence

```
ExecutionContext flows through:
  StrategicPlanStore operations
  ProposalStore operations
  EvidenceWriter events

Identifiers to capture:
  planId, proposalId  — already present in some boundaries
  runId, agentId      — new, to be threaded through
```

## Diagnostic event enrichment

The `DiagnosticEvent` type gains an optional `context` field:

```typescript
interface DiagnosticEvent {
  // existing fields...
  context?: ExecutionContext;  // NEW
}
```

This is additive — existing diagnostic events without context remain valid. The CLI diagnostics query can filter by `context.runId`, `context.agentId`, etc.

The multiplex sink propagates context from the diagnostic through to the event store without changes to the sink interface.

## Sink / callback interface

The `DiagnosticSink.emit(diag)` interface does not need to change because `RuntimeDiagnostic` gains the optional context field directly:

```typescript
interface RuntimeDiagnostic {
  // existing fields...
  context?: ExecutionContext;  // NEW
}
```

No new sink method required. The `onDiagnostic` callback signature stays the same.

## Implementation order

| Step | Description | Files to touch |
|------|-------------|----------------|
| 1 | Add `ExecutionContext` type | New: `src/observability/execution-context.ts` |
| 2 | Add optional `context` field to `RuntimeDiagnostic` | `src/runtime/runtime-diagnostics.ts` |
| 3 | Thread context through `withTimeout()` / `withRetry()` | `src/runtime/side-effect-timeout.ts`, `src/runtime/retry.ts` |
| 4 | Thread context through provider boundaries | `src/providers/provider-contract-validation.ts` |
| 5 | Thread context through shell/MCP/file tools | `src/tools/shell-tool.ts`, `src/mcp/client.ts`, `src/tools/file-tools.ts` |
| 6 | Add `context` field to `DiagnosticEvent` and mapping | `src/observability/diagnostic-event.ts` |
| 7 | Add CLI filter by context fields | `src/cli/commands/observability-diagnostics.ts` |
| 8 | (Deferred) Thread context through planning/adaptation | `src/planning/`, `src/adaptation/` |

## Data flow example

```
Agent loop (runId: "run-abc", agentId: "coder")
  → Tool executor (toolCallId: "tc-42")
    → Shell tool (withTimeout context: { runId, agentId, toolCallId })
      → onTimeout callback
        → DiagnosticSink.emit(diag with context)
          → multiplex(consoleSink, eventStoreSink)
            → .alix/diagnostics/events.jsonl:
              { "boundary": "timeout", "operation": "shell.run: npm install",
                "context": { "runId": "run-abc", "agentId": "coder", "toolCallId": "tc-42" } }
```

This makes it possible to answer: "Show me all timeouts from the coder agent during run-abc."

## Non-Goals

- **No implementation in this PR** — design doc only.
- **No orchestration rewrite** — context flows through existing boundaries, not a new execution engine.
- **No global runtime scheduler** — context is passed explicitly, not managed globally.
- **No distributed tracing backend** — no OpenTelemetry, Jaeger, or similar in this phase.
- **No dashboard** — CLI query is the interface.
- **No changes to planning/adaptation execution** — deferred to step 8.

## Recommended follow-up PRs

1. `feat(observability): add ExecutionContext type and wire into RuntimeDiagnostic`
2. `feat(observability): thread context through withTimeout and withRetry`
3. `feat(observability): thread context through provider/shell/MCP/file boundaries`
4. `feat(observability): add context to DiagnosticEvent and event store`
5. `feat(cli): filter diagnostics by run/session/agent context`

## Verification (for implementation PRs)

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```
