# Execution Context & Correlation — Milestone Checkpoint

**Date:** 2026-07-03
**PRs:** #191–#195
**Status:** Complete — design, context type, runtime/contract wiring, CLI filters.

## Summary

Delivered execution context correlation for diagnostics across all boundaries. Diagnostics now carry optional run/session/agent identifiers and are filterable by context fields via the CLI.

## Delivered PRs

| PR | Title | Scope |
|----|-------|-------|
| #191 | docs(observability): design execution context correlation | Design doc — `ExecutionContext` shape, flow through boundaries, non-goals |
| #192 | feat(observability): add execution context type | `ExecutionContext` type, `EMPTY_CONTEXT`, helpers, added to `RuntimeDiagnostic`, `ContractDiagnostic`, `DiagnosticEvent` |
| #193 | feat(observability): attach execution context to runtime diagnostics | Optional `context` param in `withTimeout()` and `withRetry()` |
| #194 | feat(observability): attach execution context to contract diagnostics | Optional `context` in `buildDiagnostic()`, `withProviderContracts()`, `StrategicPlanStore`, `ProposalStore` |
| #195 | feat(cli): filter diagnostics by execution context | `--context.runId`, `--context.agentId`, `--context.sessionId` filters in CLI |

## Context flow

```
Caller provides ExecutionContext
  → withTimeout / withRetry / withProviderContracts / StrategicPlanStore / ProposalStore
    → RuntimeDiagnostic / ContractDiagnostic
      → runtimeDiagToEvent / contractDiagToEvent
        → multiplex(consoleSink, eventStoreSink)
          → .alix/diagnostics/events.jsonl  (with context preserved)
          → alix observability diagnostics list --context.runId run-abc
```

## Context available in

| Boundary | Context field | How passed |
|----------|--------------|------------|
| Provider `complete()` | `runId`, `agentId`, etc. | `withProviderContracts(request, ... , context)` |
| Provider `stream()` | `runId`, `agentId`, etc. | `withProviderContracts(request, ... , context)` |
| Shell tool | `runId`, `agentId`, etc. | `withTimeout(operation, ms, effect, onDiag, context)` |
| MCP `callTool()` | `runId`, `agentId`, etc. | `withTimeout(operation, ms, effect, onDiag, context)` |
| `file.read` retry | `runId`, `agentId`, etc. | `withRetry(operation, effect, policy, onDiag, context)` |
| Strategic plan validation | `runId`, `agentId`, etc. | `StrategicPlanStore(dir, onDiag, context)` |
| Proposal validation | `runId`, `agentId`, etc. | `ProposalStore(dir, logger, onDiag, context)` |

## Non-Goals

- **No global mutable context** — context is passed explicitly, never global
- **No agent loop wiring** — the agent loop hasn't been modified to pass context yet
- **No correlation ID generation** — `runId` etc. must be provided by the caller
- **No distributed tracing** — no OpenTelemetry, no trace propagation
- **No dashboard** — CLI-only

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```

All clean: 2669+ tests, 256+ files, 0 type errors.
