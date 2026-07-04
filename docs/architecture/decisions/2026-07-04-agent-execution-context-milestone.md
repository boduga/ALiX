# Agent-Loop Execution Context — Milestone Checkpoint

**Date:** 2026-07-04
**PRs:** #197–#199
**Status:** Complete — agent-loop context creation, diagnostics query examples, parent/child lineage.

## Summary

Delivered real execution context propagation from the agent loop through provider calls and diagnostics. Agent runs now produce attributable diagnostics with `runId`, `sessionId`, `workflowId`, `providerId`, `model`, and optional `parentRunId` for parent/child lineage.

## Delivered PRs

| PR | Title | Scope |
|----|-------|-------|
| #197 | feat(orchestration): create execution context for agent runs | Create `ExecutionContext` at the agent-run boundary; thread through `TaskLoopDeps` → `NormalizedRequest` → `withProviderContracts` → diagnostics |
| #198 | docs(observability): add execution-context diagnostics query examples | Practical CLI examples for querying diagnostics by `runId`, `sessionId`, `workflowId`, `providerId`, `model` |
| #199 | feat(orchestration): propagate parentRunId for child agent runs | Add `runId` to `RunResult` and `parentRunId` to `RunOpts`; thread through agent loop; lineage tests |

## Context flow

```
agent-loop (runTask)
  → creates ExecutionContext { runId, sessionId, workflowId, providerId, model, parentRunId }
  → TaskLoopDeps.context
    → NormalizedRequest.context
      → withProviderContracts.resolveContext(request)
        → merge(defaultContext, request.context)
          → RuntimeDiagnostic.context / ContractDiagnostic.context (contract errors)
            → runtimeDiagToEvent / contractDiagToEvent
              → multiplex(consoleSink, eventStoreSink)
                → .alix/diagnostics/events.jsonl
```

### Parent/child lineage

```
Parent: runTask → RunResult { runId: "run-parent-001", ... }
  → caller passes RunOpts { parentRunId: "run-parent-001" }
    → child runTask → ExecutionContext { runId: "run-child-001", parentRunId: "run-parent-001", ... }
```

Root runs have no `parentRunId`. Child runs set `parentRunId` to the parent's `runId`.

## Diagnostics query

After #197, provider diagnostics emitted during agent runs include context fields:

```bash
alix observability diagnostics list --context.runId run-abc123
alix observability diagnostics list --context.sessionId sess-20260704-xyz
alix observability diagnostics list --context.workflowId wf-xyz-001
```

See `docs/observability/diagnostics-query-examples.md` for complete usage.

## Files changed

```
src/agent/agent-loop.ts                       — context creation, runId in result
src/providers/types.ts                        — context field on NormalizedRequest
src/providers/provider-contract-validation.ts — resolveContext, per-request context merge
src/run/task-loop.ts                          — context in TaskLoopDeps, request construction
src/run.ts                                    — runId in RunResult, parentRunId in RunOpts
tests/observability/execution-context-lineage.test.ts — 6 lineage tests
docs/observability/diagnostics-query-examples.md      — CLI usage examples
```

## Non-Goals

- **No subagent caller wiring** — `RunOpts.parentRunId` is defined and `runId` is returned, but callers haven't been updated to pass `parentRunId` to child runs
- **No `agentId` population** — field exists but not yet set by the agent loop
- **No OpenTelemetry** — no distributed tracing backend
- **No dashboard** — CLI-only diagnostics query
- **No orchestration rewrite** — context flows through existing boundaries

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```

All clean: 2669+ tests, 256+ files, 0 type errors.
