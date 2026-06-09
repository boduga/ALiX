# M0.19: Persistent Runtime Event Unification

**Goal:** Build a read-only, on-demand RuntimeIndex that aggregates events from ALiX's multiple storage backends into a single queryable view — without introducing new storage.

**Boundary:** RuntimeIndex is an on-the-fly aggregator (Approach A). SQLite mirror is deferred to M0.19-D / M0.20.

## Architecture

```
Queries (CLI + Inspector)
        │
        ▼
   RuntimeIndex ─── on-the-fly aggregation, no new storage
        │
        ├──► audit/audit.jsonl          (M0.19-A)
        ├──► approvals/approvals.json   (M0.19-A)
        ├──► graphs/*.json              (M0.19-A)
        ├──► graphs/*.runs.json         (M0.19-A)
        ├──► sessions/*/events.jsonl    (M0.19-B)
        └──► reports/*/run_manifest.json (future)
```

## Core Type

```typescript
export type RuntimeIndexEvent = {
  id: string;
  timestamp?: string;
  source: "session" | "graph" | "graph_run" | "approval" | "audit" | "report";
  action: string;
  graphId?: string;
  nodeId?: string;
  sessionId?: string;
  approvalId?: string;
  reportId?: string;
  status?: string;
  capability?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};
```

## Core API

```typescript
export async function buildRuntimeIndex(cwd: string): Promise<RuntimeIndex>;

export type RuntimeIndex = {
  events: RuntimeIndexEvent[];
  byGraph(graphId: string): RuntimeIndexEvent[];
  bySession(sessionId: string): RuntimeIndexEvent[];
  byApproval(approvalId: string): RuntimeIndexEvent[];
  byAction(action: string): RuntimeIndexEvent[];
};
```

## Sub-milestones

| # | Title | Sources | Output |
|---|-------|---------|--------|
| A | Core RuntimeIndex | audit, approvals, graphs, graph_runs | Module + tests |
| B | Add session events | sessions/*/events.jsonl (filtered) | Enhanced index |
| C | CLI + Inspector | RuntimeIndex queries | Commands + tab |
| D | SQLite mirror | All sources | Persistent schema |

## Files

| File | Action |
|------|--------|
| `src/runtime/runtime-index.ts` | Create — RuntimeIndex builder + query functions |
| `tests/runtime/runtime-index.test.ts` | Create — tests with example data |
| `src/cli.ts` | Modify — add `alix runtime` commands (M0.19-C) |
| `src/server/server.ts` | Modify — add `GET /api/runtime` route (M0.19-C) |
| `src/ui/index.html` | Modify — add Runtime tab (M0.19-C) |
| `src/ui/app.js` | Modify — render timeline (M0.19-C) |
| `src/ui/styles.css` | Modify — timeline styles (M0.19-C) |
