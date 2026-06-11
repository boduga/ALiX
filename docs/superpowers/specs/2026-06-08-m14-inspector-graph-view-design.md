# M0.14: Inspector Graph Execution View

**Status:** ✅ Completed (M0.14) — Design implemented and committed to main.

**Goal:** Add a read-only Graph tab to the Inspector UI that surfaces graph run data — node status, capability resolution, and rerun command helpers — without adding server-side execution.

**Boundary:** Inspector remains observability-only. No POST/PUT/DELETE endpoints. Rerun uses CLI command copying, not browser-triggered execution.

---

## Architecture

```
Browser                          Server
┌─────────────────┐             ┌──────────────────────────┐
│  Graph tab       │   GET       │  .alix/graphs/*.json     │
│  ┌─ graph list   │◄───────────│  → GraphListItem[]       │
│  │  (selector)   │  /api/graphs│  (skip *.runs.json,     │
│  ├─ select graph │             │   skip invalid JSON)    │
│  │  → fetch proj │   GET       │                         │
│  │  /api/graphs/ │◄───────────│  .alix/graphs/<id>.json │
│  │  {id}/projection│          │  .alix/sessions/ events  │
│  ├─ overview     │             │  → GraphRunProjection   │
│  ├─ node table   │             │                         │
│  │  (status,     │             │  All read-only          │
│  │   duration,   │             │  No POST/PUT endpoint   │
│  │   caps,       │             │                         │
│  │   markers)    │             │                         │
│  ├─ detail panel │             │                         │
│  │  (capability  │             │                         │
│  │   resolution) │             │                         │
│  └─ rerun helper │             │  CLI copyable cmd:      │
│     (copy cmd)   │             │  alix graph rerun ...   │
└─────────────────┘             └──────────────────────────┘
```

---

## Server Endpoints

### `GET /api/graphs` (NEW)

Returns list of saved graphs with lightweight metadata. Read-only.

**Response: `GraphListItem[]`**

```typescript
type GraphListItem = {
  graphId: string;
  rootGoal?: string;
  status?: string;
  strategy?: string;
  nodeCount: number;
  completedNodes?: number;
  failedNodes?: number;
  blockedNodes?: number;
  updatedAt?: string;
  createdAt?: string;
  hasRuns: boolean;
  reportIds?: string[];
};
```

**Behavior:**
- Scan `.alix/graphs/*.json`
- Skip `*.runs.json` files
- Skip malformed/invalid JSON gracefully (don't fail the whole request)
- Sort by `updatedAt` desc, then `createdAt` desc
- Return `[]` if no graph dir exists or dir is empty

### `GET /api/graphs/{id}/projection` (EXISTING)

Already returns `GraphRunProjection`:
```typescript
type GraphRunProjection = {
  graphId: string;
  rootGoal: string;
  strategy: string;
  status: string;
  nodeCount: number;
  nodes: NodeRunInfo[];
  reports: string[];
  sessionIds: string[];
  attempts: Array<Record<string, unknown>>;
};
```

Each `NodeRunInfo` contains: `nodeId`, `title`, `status`, `startedAt`, `completedAt`, `durationMs`, `sessionId`, `summary`, `error`, `attempts`.

If `capabilityResolution` is not yet populated in the projection, M0.14-C includes the enhancement to persist and surface it.

### No POST/PUT/DELETE endpoints

Rerun is CLI-only: the UI shows a copyable `alix graph rerun <graphId> --node <nodeId>` command.

---

## UI: Graph Tab

### Tab button + panel (index.html)

- New tab button labeled "Graph", order after Registry
- Panel with three visual regions:

#### 1. Graph Selector
- Dropdown populated from `GET /api/graphs` — shows `graphId` and `rootGoal` snippet
- Manual graph ID input field as fallback
- "Load" button to fetch projection

#### 2. Graph Overview
- Status badge (completed/failed/running) with color coding
- Strategy, node counts (total/completed/failed/blocked)
- Session IDs linked (clickable to switch to Timeline tab)
- Report IDs listed

#### 3. Node Table
- One row per node
- Columns: status icon, title, duration, required capabilities (cap-badges), capability status (ready/blocked/needs_approval), attempts count
- Failed rows show a "rerun" action that opens a CLI command panel
- Expandable detail: CapabilityResolution info per node

### JS functions (app.js)

| Function | Purpose |
|----------|---------|
| `loadGraphList()` | Fetch `GET /api/graphs`, populate dropdown |
| `fetchProjection(graphId)` | Fetch `GET /api/graphs/{id}/projection` |
| `renderGraphOverview(projection)` | Render overview section |
| `renderNodeTable(projection)` | Render node table with status, caps, markers |
| `renderNodeDetail(node)` | Render expandable CapabilityResolution panel |
| `showRerunCommand(node, graphId)` | Render CLI command + copy button |

---

## Sub-Milestones

| # | Title | Server | HTML | JS | CSS | Tests |
|---|-------|--------|------|----|-----|-------|
| A | Graph list API + selector | `GET /api/graphs` route | Selector region | `loadGraphList()` | Dropdown styles | `/api/graphs` HTTP test |
| B | Graph tab + overview | — | Tab button + panel | `fetchProjection()`, `renderGraphOverview()` | Overview section | — |
| C | Node table + markers | Projection enhancement if needed | Node table markup | `renderNodeTable()`, markers | Table + status badges | — |
| D | CapabilityResolution detail | — | Expandable detail panel | `renderNodeDetail()` | Detail card styles | — |
| E | Rerun command helper | — | CLI command panel | `showRerunCommand()`, copy-to-clipboard | Command snippet styles | — |

---

## CSS Additions

- Graph tab layout (selector row, overview cards, node table)
- Status badges for graph-level status (completed=green, failed=red, running=yellow)
- Node table with status icons, duration formatting
- Expandable detail panel for CapabilityResolution
- CLI command snippet box with copy button
- Enforcement markers (blocked/needs_approval) using existing cap-badge styling

---

## Testing

| Test | What it verifies |
|------|-----------------|
| `GET /api/graphs` returns array | Empty directory → `[]` |
| `GET /api/graphs` skips runs files | `graph_a.runs.json` ignored |
| `GET /api/graphs` skips bad JSON | `bad.json` doesn't break response |
| `GET /api/graphs` returns metadata | `graphId`, `status`, `nodeCount` populated |
| Graph list sorts by date | `updatedAt` desc ordering |
