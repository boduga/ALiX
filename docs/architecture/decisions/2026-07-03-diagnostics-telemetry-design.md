# Durable Diagnostics Telemetry — Design

**Date:** 2026-07-03
**Status:** Design — implementation deferred.

## Context

ALiX now has two structured diagnostic families that emit via `console.warn` (`consoleSink`):

- **ContractDiagnostic** (#170) — schema validation failures at provider, planning, and proposal boundaries.
- **RuntimeDiagnostic** (#178) — timeout and retry events at shell, provider, MCP, and file boundaries.

Both are currently fire-and-forget logs. There is no persistence, query, or correlation model. This design defines how they become durable, queryable evidence.

## Current Diagnostic Sources

### ContractDiagnostic

| Source | Domain | Boundary | When emitted |
|--------|--------|----------|-------------|
| `withProviderContracts` | provider | `complete.request`, `complete.response` | Before throwing on malformed request/response |
| `withProviderContracts` | provider | `stream.chunk` | Before throwing on malformed chunk |
| `StrategicPlanStore` | planning | `plan.save` | Before throwing on shape mismatch |
| `ProposalStore` | adaptation | `proposal.save`, `proposal.load`, `proposal.list` | Before throwing on shape mismatch |

### RuntimeDiagnostic

| Source | Event | When emitted |
|--------|-------|-------------|
| Shell tool `withTimeout` | `timeout` | Before throwing `SideEffectTimeoutError` |
| Provider `withTimeout` | `timeout` | Before throwing on complete() timeout |
| Provider `withStreamIdleTimeout` | `timeout` | Before throwing on stream idle timeout |
| MCP `withTimeout` | `timeout` | Before throwing on callTool timeout |
| `file.read` `withRetry` | `retry.attempt`, `retry.exhausted` | Before each retry and on exhaustion |

## Decision: Diagnostic Event Store

Write diagnostics as append-only structured records in a JSONL diagnostic event file, parallel to the existing evidence-chain pattern.

### Rationale

| Approach | Pros | Cons |
|----------|------|------|
| JSONL event file | Simple, append-only, no schema migrations, grep-able, same pattern as evidence chain | No indexing, no query engine, manual cleanup |
| SQLite table | Queryable, indexable, joinable with evidence | Schema migration overhead, adds dependency for a diagnostic feature |
| Evidence chain adapter | Reuses existing evidence model, joinable with proposals/plans | Evidence chain has specific semantics (provenance, fingerprints) that don't map cleanly to diagnostics |
| External telemetry (OpenTelemetry, Datadog) | Rich ecosystem, dashboards, alerting | Infrastructure dependency, not local-first, contradicts ALiX's offline-friendly architecture |

JSONL is the right first target: it is simple, local-first, matches the existing evidence-file pattern, and can be consumed by the same `alix` CLI query commands that read evidence.

## Normalized Event Shape

```typescript
interface DiagnosticEvent {
  id: string;                    // e.g. "diag-<safeTimestamp>-<random>"
  timestamp: string;             // ISO 8601
  type: "contract" | "runtime";
  domain: string;                // "provider" | "planning" | "adaptation" | "runtime"
  boundary: string;              // e.g. "complete.request", "stream.chunk", "timeout", "retry.attempt"
  operation?: string;            // e.g. "shell.run: git status", "file.read: config.json"
  entityId?: string;             // planId, proposalId, or toolCallId when available
  error: string;                 // truncated error summary (200 chars)
  severity: "error" | "warning";
  correlationId?: string;        // run ID, session ID, or trace ID when available
}
```

### Fields mapped from current diagnostics

| `DiagnosticEvent` | Source: `ContractDiagnostic` | Source: `RuntimeDiagnostic` |
|------------------|------------------------------|---------------------------|
| `type` | `"contract"` | `"runtime"` |
| `domain` | `diag.domain` | `"runtime"` |
| `boundary` | `diag.boundary` | `diag.boundary` |
| `operation` | — (use schema name) | `diag.operation` |
| `entityId` | `diag.entityId` | — |
| `error` | `diag.error` | `diag.event` |
| `severity` | `"error"` | `"error"` for timeout/exhausted, `"warning"` for retry attempt |

## Sink Strategy

### Current (no changes)

```
withTimeout / withRetry / validateShape
  → onDiagnostic callback
  → consoleSink.emit(diag)
  → console.warn(formatDiagnostic(diag))
```

### Proposed (additive)

```
withTimeout / withRetry / validateShape
  → onDiagnostic callback
  → multiplexSink.emit(diag)        ← NEW: multiplex both sinks
    → consoleSink.emit(diag)        ← existing behavior preserved
    → evidenceSink.emit(diag)       ← NEW: persists to JSONL file
```

### Design constraints

1. `consoleSink` remains the default — diagnostics are always visible in logs.
2. The evidence sink is optional and wired where an evidence writer already exists (e.g. `ProposalStore`, provider wrappers).
3. No global mutable state — the multiplex or evidence sink is injected at construction time, same as the current `onDiagnostic` pattern.
4. The evidence sink writes to a dedicated diagnostics JSONL file, not mixed with other evidence event types.

### Recommended follow-up implementation order

| Step | Description |
|------|-------------|
| 1 | Add `DiagnosticEvent` type and `toDiagnosticEvent()` converter helpers. |
| 2 | Add `diagnosticStoreSink` — `DiagnosticSink` implementation that appends `DiagnosticEvent` JSON lines to a `.alix/diagnostics/diagnostics.jsonl` file. |
| 3 | Add `multiplexSink` — combiner that fans out to multiple sinks. |
| 4 | Wire into existing boundaries one at a time, starting where an evidence writer or store directory already exists. |
| 5 | Add `alix diagnostics list` CLI command to read and filter the JSONL file. |

## Non-Goals

- **No implementation in this PR** — design doc only.
- **No dashboard** — diagnostics are file-based; dashboards are a separate concern.
- **No alerting** — no threshold, no notification.
- **No metrics aggregation** — no counters, histograms, or time-series transform.
- **No SQLite migration** — JSONL is the first target.
- **No OpenTelemetry export** — deferred until an OTLP layer is explicitly needed.
- **No orchestration rewrite** — agent loop, planner, applier unchanged.
- **No behavior changes** to existing hardened boundaries — diagnostics are additive.
- **No correlation ID plumbing** yet — `correlationId` is reserved for future use but not populated in this phase.

## Verification (for implementation PR)

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```
