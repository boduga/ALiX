# M0.77f — Coordination Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute tasks in order.
>
> **Target branch:** `feat/m077f-coordination-visibility`
> **Builds on:** M0.77a–M0.77e.1

**Goal:** Add first-class visibility into coordination runs through a shared read model, expanded CLI, dedicated TUI panel, and Inspector API routes — all backed by one `CoordinationRunView` projection.

---

## Files

### Create
- `src/kernel/coordination-view.ts` — `buildCoordinationRunView()` shared projection
- `src/tui/coordination-panel.ts` — TUI coordination panel
- `src/server/coordination-routes.ts` — Inspector HTTP routes

### Modify
- `src/cli/commands/coordination.ts` — add list/inspect/watch/workers/approvals/ownership/events
- `src/tui/index.ts` — register coordination panel
- `src/tui/panel-manager.ts` — add coordination panel type
- `src/server/server.ts` — register coordination routes
- `src/events/types.ts` — ensure coordination events in VISIBLE_EVENTS

### Tests
- `tests/kernel/coordination-view.test.ts`
- `tests/cli/coordination-view.test.ts`
- `tests/server/coordination-routes.test.ts`

---

## M0.77f.1 — Shared read model

**Files:** Create `src/kernel/coordination-view.ts`

Build a single `buildCoordinationRunView(runId)` that composes from:

- `CoordinationStore.load()` for the run + workers
- `ApprovalStore` for approvals filtered by `coordinationRunId`
- `OwnershipRegistry` for leases associated with worker IDs
- `CoordinationAggregateStore.load()` for the aggregate
- `buildFailureChains()` for failure chains
- `computeAggregationSourceFingerprint()` for freshness

Types:
```
CoordinationRunView, RunSummary, WorkerView, ApprovalView, OwnershipLeaseView, CoordinationEventView
```

**Commit:** `feat(visibility): add shared coordination run view projection`

---

## M0.77f.2 — Expanded CLI

**Files:** Modify `src/cli/commands/coordination.ts`

Add commands:
```
alix coordination list
alix coordination inspect <run-id>
alix coordination watch <run-id>
alix coordination workers <run-id>
alix coordination approvals <run-id>
alix coordination ownership <run-id>
alix coordination events <run-id>
```

All support `--json`. The `list` command shows all runs in a table. `watch` polls every 2 seconds and re-renders the summary. Others use `buildCoordinationRunView()` and format subsets.

**Commit:** `feat(cli): add coordination list inspect watch and drill-down commands`

---

## M0.77f.3 — TUI coordination panel

**Files:** Create `src/tui/coordination-panel.ts`, Modify `src/tui/index.ts`, `src/tui/panel-manager.ts`

A `CoordinationPanel` class that:
- Shows run header (ID, status, outcome, worker counts)
- Worker table with scrollable selection
- Detail panel for selected worker
- Bottom bar with key bindings
- Polls `buildCoordinationRunView()` every 2 seconds

Key bindings: `↑/↓` select worker, `Enter` drill down, `a` approvals, `o` ownership, `f` failures, `r` results, `x` cancel run, `R` refresh.

Accessible via panel cycle or `/coordination` command.

**Commit:** `feat(tui): add coordination panel with worker table and drill-down views`

---

## M0.77f.4 — Inspector API

**Files:** Create `src/server/coordination-routes.ts`, Modify `src/server/server.ts`

HTTP routes:
```
GET /api/coordination                    → array of RunSummary
GET /api/coordination/:runId             → full CoordinationRunView
GET /api/coordination/:runId/workers     → WorkerView[]
GET /api/coordination/:runId/workers/:workerId → single WorkerView
GET /api/coordination/:runId/results     → RunResultSummary
GET /api/coordination/:runId/events      → CoordinationEventView[]
GET /api/coordination/:runId/stream      → SSE stream of coordination events
```

All return `Content-Type: application/json`. SSE endpoint streams events from EventLog.

**Commit:** `feat(server): add coordination inspector routes with SSE live updates`

---

## Verification

```bash
npm run build
node --test dist/tests/kernel/coordination-view.test.js
node --test dist/tests/cli/coordination-view.test.js
node --test dist/tests/server/coordination-routes.test.js
npm run test:node:ci
```
