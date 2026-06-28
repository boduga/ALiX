# M0.77f — Coordination Visibility

> **Status:** Implementation-ready specification  
> **Target branch:** `feat/m077f-coordination-visibility`  
> **Builds on:** M0.77a–M0.77e.1

## 1. Goal

Add first-class visibility into coordination runs through a shared read model, expanded CLI commands, a dedicated TUI panel, Inspector API routes, and live updates — all backed by a single `CoordinationRunView` projection that CLI, TUI, and Inspector share.

## 2. Shared read model

Create `src/kernel/coordination-view.ts` — a projection service that builds a unified view from CoordinationStore, ApprovalStore, OwnershipRegistry, ResultAggregator, and CoordinationAggregateStore.

```typescript
export type CoordinationRunView = {
  run: RunSummary;
  workers: WorkerView[];
  approvals: ApprovalView[];
  ownershipLeases: OwnershipLeaseView[];
  failureChains: FailureChain[];
  aggregate?: RunResultSummary;
  freshness: "fresh" | "stale" | "missing";
  events: CoordinationEventView[];
};

export type RunSummary = {
  id: string; goal: string; status: CoordinationRunStatus;
  outcome?: CoordinationRunOutcome; workerCount: number; createdAt: string; updatedAt: string;
};

export type WorkerView = {
  id: string; taskLabel: string; agentId: string; status: WorkerStatus;
  attempt: number; maxAttempts: number; planOrder?: number;
  outcome?: "success" | "failure"; summary?: string; error?: string;
  failureKind?: WorkerFailureKind; blockReason?: WorkerBlockReason;
  failureProvenance?: WorkerFailureProvenance;
  startedAt?: string; completedAt?: string; durationMs?: number;
  ownershipScopes: string[]; leaseIds?: string[];
  approvalId?: string; resultRef?: string;
};

export type ApprovalView = { id: string; status: string; capabilities: string[]; bindingKey: string; workerId?: string; createdAt: string; expiresAt: string; };

export type OwnershipLeaseView = { id: string; agentId: string; scope: string; mode: string; status: string; acquiredAt: string; ttlMs: number; taskId?: string; };

export type CoordinationEventView = { type: string; timestamp: string; workerId?: string; payload: Record<string, unknown>; };
```

The view builder loads from all stores and composes the result. CLI, TUI, and Inspector all call the same `buildCoordinationRunView()` function.

## 3. CLI

Extend the existing `alix coordination` command group:

```
alix coordination list                          — list all runs with status summary
alix coordination inspect <run-id>              — full detail view
alix coordination watch <run-id>                — live-updating watch (poll every 2s)
alix coordination workers <run-id>              — worker table
alix coordination approvals <run-id>            — approval view
alix coordination ownership <run-id>            — lease view
alix coordination events <run-id>               — event timeline
alix coordination results <run-id>              — existing, unchanged
```

All commands support `--json`.

## 4. TUI coordination panel

Add a `CoordinationPanel` to the existing TUI. Accessible via cycle or a direct `/coordination` command.

Layout:
- Header row: run ID, status, outcome, worker count
- Worker table: worker ID, label, status, attempt, duration
- Selected worker detail panel: full worker view with scopes, leases, failure provenance
- Bottom bar: key bindings (↑↓ select, Enter drill, a=approvals, o=ownership, f=failures, r=results, x=cancel, R=refresh)

Data source: `CoordinationRunView` from the shared model.

## 5. Inspector API

Add Inspector HTTP routes:

```
GET  /api/coordination                      — list runs
GET  /api/coordination/:runId               — full view
GET  /api/coordination/:runId/workers       — worker list
GET  /api/coordination/:runId/workers/:workerId — single worker
GET  /api/coordination/:runId/results       — aggregate result
GET  /api/coordination/:runId/events        — event timeline
```

Responses return the `CoordinationRunView` (or subsets), JSON-formatted with `Content-Type: application/json`.

SSE endpoint for live updates: `GET /api/coordination/:runId/stream` — streams coordination events as they happen.

## 6. Live updates

Use the existing daemon event infrastructure:

1. Initial snapshot via `CoordinationRunView`
2. SSE stream of coordination events from EventLog
3. Periodic reconciliation refresh (every 5s fallback)

Events improve responsiveness, but the snapshot remains authoritative.

## 7. Drill-down views

- **Approval detail:** binding key, policy revision, expiry, consumption status, linked worker
- **Ownership leases:** scope path, mode, agent, acquired time, TTL, staleness
- **Failure chains:** root cause → all affected workers with depth
- **Results:** aggregate summary, outcome, timing, final synthesis if available

## 8. File structure

### Modify
- `src/tui/index.ts` — register CoordinationPanel
- `src/tui/panel-manager.ts` — add coordination panel type
- `src/cli/commands/coordination.ts` — add list/inspect/watch/workers/approvals/ownership/events
- `src/server/server.ts` — add Inspector routes
- `src/events/types.ts` — ensure all coordination event types are in VISIBLE_EVENTS

### Create
- `src/kernel/coordination-view.ts` — `buildCoordinationRunView()` shared projection
- `src/tui/coordination-panel.ts` — TUI coordination panel
- `src/server/coordination-routes.ts` — Inspector HTTP routes
- `tests/kernel/coordination-view.test.ts`
- `tests/cli/coordination-view.test.ts`
- `tests/server/coordination-routes.test.ts`
