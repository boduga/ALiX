# Observability & Diagnostics — Milestone Checkpoint

**Date:** 2026-07-03
**PRs:** #186–#189
**Status:** Complete — design, durable store, wiring, and CLI query.

## Summary

Delivered durable diagnostics telemetry for both contract and runtime diagnostic families. Diagnostics are now persisted to a JSONL event store, wired into all hardened runtime boundaries, and queryable via the `alix observability diagnostics list` CLI command — all without changing runtime behavior.

## Delivered PRs

| PR | Title | Scope |
|----|-------|-------|
| #186 | docs(observability): design durable diagnostics telemetry | Design doc — event shape, JSONL store, multiplex sink, phased plan |
| #187 | feat(observability): add diagnostic event store sink | `DiagnosticEvent`, `runtimeDiagToEvent()`, `contractDiagToEvent()`, `DiagnosticEventStore` (JSONL append-only) |
| #188 | feat(observability): wire diagnostic event store sink | `createMultiplexDiagnosticSink()`, wired into all 5 runtime boundaries |
| #189 | feat(observability): add diagnostics query CLI | `alix observability diagnostics list` with filters and JSON output |

## Architecture

```
withTimeout / withRetry / validateShape
  → onDiagnostic callback
  → multiplex(consoleSink, eventStoreSink)
    → console.warn                         (visible in logs)
    → DiagnosticEventStore.append(event)   (persisted to .alix/diagnostics/events.jsonl)

Query: alix observability diagnostics list [--type] [--boundary] [--severity] [--limit] [--json]
```

## Diagnostic event pipeline

| Layer | Component | Location |
|-------|-----------|----------|
| Sources | 5 runtime boundaries (shell, provider complete, provider stream, MCP, file.read) | `src/tools/`, `src/providers/`, `src/mcp/` |
| Normalization | `runtimeDiagToEvent()`, `contractDiagToEvent()` | `src/observability/diagnostic-event.ts` |
| Persistence | `DiagnosticEventStore` (append-only JSONL) | `src/observability/diagnostic-event-store.ts` |
| Multiplex | `createMultiplexDiagnosticSink()` | `src/runtime/runtime-diagnostics.ts` |
| Query | `alix observability diagnostics list` | `src/cli/commands/observability-diagnostics.ts` |

## Wired boundaries

All 5 runtime diagnostic sources now emit to both `consoleSink` and the event store:

| Boundary | Event types | File |
|----------|-------------|------|
| Shell tool timeout | `timeout` | `shell-tool.ts` |
| Provider complete timeout | `timeout` | `provider-contract-validation.ts` |
| Provider stream idle timeout | `timeout` | `provider-contract-validation.ts` |
| MCP callTool timeout | `timeout` | `mcp/client.ts` |
| file.read retry | `retry.attempt`, `retry.exhausted` | `file-tools.ts` |

Contract diagnostics (provider, planning, proposal validation) are mappable via `contractDiagToEvent()` but not yet wired into the event store. This is deferred to a follow-up phase.

## Non-Goals

- **No SQLite or OpenTelemetry** — JSONL is the first durable target
- **No contract diagnostics wiring** — mapping functions exist but not wired (deferred)
- **No dashboard or alerting** — query is CLI-only
- **No metrics aggregation** — no counters, histograms, or time-series
- **No correlation ID plumbing** — field reserved but not populated
- **No orchestration rewrite** — agent loop, planner, applier unchanged

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```

All clean: 2664+ tests, 256+ files, 0 type errors.
