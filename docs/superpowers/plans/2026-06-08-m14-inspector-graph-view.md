# M0.14: Inspector Graph Execution View

**Status:** ✅ Completed (M0.14) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Graph tab to the Inspector UI that surfaces graph run data — node list, status, capability resolution, and rerun command helpers — without adding server-side execution.

**Architecture:** The server already has `GET /api/graphs/{id}/projection` returning `GraphRunProjection`. We add `GET /api/graphs` to list graphs, then wire a new "Graph" tab that fetches projection data and renders a node table, capability detail, and CLI rerun command helper. All data flows through existing read-only endpoints.

**Tech Stack:** TypeScript (server), vanilla JS (browser), CSS, no framework.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server/server.ts` | **Modify** | Add `GET /api/graphs` route for graph list |
| `src/kernel/graph-projection.ts` | **Modify** | Add `requiredCapabilities` and `capabilityResolution` to `NodeRunInfo` |
| `src/ui/index.html` | **Modify** | Add Graph tab button + panel with selector, overview, node table, rerun command regions |
| `src/ui/app.js` | **Modify** | Add `loadGraphList()`, `fetchProjection()`, `renderGraphOverview()`, `renderNodeTable()`, `renderNodeDetail()`, `showRerunCommand()` |
| `src/ui/styles.css` | **Modify** | Graph tab layout, overview cards, node table, detail panel, command snippet box |
| `tests/server/server.test.ts` | **Modify** | Add HTTP smoke tests for `GET /api/graphs` |

---

### Task 1 (M0.14-A): Graph list API — `GET /api/graphs`

**Files:**
- Modify: `src/server/server.ts`

**What it builds:** A read-only endpoint that scans `.alix/graphs/*.json`, returns lightweight metadata for each graph (id, status, node counts, dates), skips `*.runs.json` and invalid JSON, sorted newest-first.

- [ ] **Step 1: Add `GET /api/graphs` route to `server.ts`**

Insert this route in `src/server/server.ts` before the existing `/api/graphs/{id}/projection` route (around line 84):

```typescript
      if (url.pathname === "/api/graphs") {
        try {
          const graphsDir = join(root, ".alix", "graphs");
          if (!existsSync(graphsDir)) {
            res.setHeader("content-type", "application/json");
            res.end("[]");
            return;
          }
          const { readdirSync, readFileSync } = await import("node:fs");
          const files = readdirSync(graphsDir);
          const items: Array<{
            graphId: string; rootGoal?: string; status?: string; strategy?: string;
            nodeCount: number; completedNodes?: number; failedNodes?: number; blockedNodes?: number;
            updatedAt?: string; createdAt?: string; hasRuns: boolean; reportIds?: string[];
          }> = [];

          for (const f of files) {
            if (!f.endsWith(".json") || f.endsWith(".runs.json")) continue;
            try {
              const raw = readFileSync(join(graphsDir, f), "utf-8");
              const graph = JSON.parse(raw);
              const graphId = f.replace(/\.json$/, "");
              const nodes: any[] = graph.nodes ?? [];
              items.push({
                graphId,
                rootGoal: graph.rootGoal,
                status: graph.status,
                strategy: graph.strategy,
                nodeCount: nodes.length,
                completedNodes: nodes.filter((n: any) => n.status === "done").length,
                failedNodes: nodes.filter((n: any) => n.status === "failed").length,
                blockedNodes: nodes.filter((n: any) => n.status === "blocked").length,
                updatedAt: graph.updatedAt,
                createdAt: graph.createdAt,
                hasRuns: existsSync(join(graphsDir, `${graphId}.runs.json`)),
                reportIds: [],
              });
            } catch { /* skip invalid JSON */ }
          }

          items.sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(items));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/server.ts
git commit -m "feat(server): add GET /api/graphs listing endpoint"
```

---

### Task 2 (M0.14-A): Graph list tests

**Files:**
- Modify: `tests/server/server.test.ts`

- [ ] **Step 1: Add HTTP smoke tests for `GET /api/graphs`**

Append this test suite to `tests/server/server.test.ts`:

```typescript
describe("Graph list API", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "graph-list-test-"));
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });

    // Valid graph
    writeFileSync(join(graphsDir, "graph_a.json"), JSON.stringify({
      id: "graph_a", rootGoal: "Research task", status: "completed",
      strategy: "sequential", createdAt: "2026-06-01", updatedAt: "2026-06-02",
      nodes: [
        { id: "n1", status: "done" },
        { id: "n2", status: "failed" },
        { id: "n3", status: "blocked" },
      ],
    }));

    // Run file (should be ignored)
    writeFileSync(join(graphsDir, "graph_a.runs.json"), JSON.stringify([{ attempt: 1 }]));

    // Invalid JSON file (should not break response)
    writeFileSync(join(graphsDir, "bad.json"), "not valid json");

    // Empty dir for one test
    const emptyDir = mkdtempSync(join(tmpdir(), "graph-list-empty-"));
    (tmpDir as any) = { graphsDir, emptyDir, graphADir: tmpDir };
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/graphs returns [] when no graph dir exists", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const blankDir = mkdtempSync(join(tmpdir(), "no-graphs-"));
    try {
      const { url, close } = await startServer(blankDir, "127.0.0.1", 0);
      const body = await httpGet(`${url}/api/graphs`);
      assert.equal(body, "[]");
      await close();
    } finally {
      rmSync(blankDir, { recursive: true, force: true });
    }
  });

  it("GET /api/graphs returns graph_a with metadata", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/graphs`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 1);
      const ga = data.find((g: any) => g.graphId === "graph_a");
      assert.ok(ga, "graph_a should appear");
      assert.equal(ga.nodeCount, 3);
      assert.equal(ga.completedNodes, 1);
      assert.equal(ga.failedNodes, 1);
      assert.equal(ga.blockedNodes, 1);
      assert.equal(ga.status, "completed");
      assert.equal(ga.strategy, "sequential");
      assert.equal(ga.hasRuns, true);
      await close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips .runs.json files and bad JSON", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/graphs`);
      const data = JSON.parse(body);
      // graph_a is the only valid graph file
      assert.equal(data.length, 1);
      assert.equal(data[0].graphId, "graph_a");
      await close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/server/server.test.js 2>&1
```

Expected: 7 tests pass (4 existing + 3 new).

- [ ] **Step 3: Commit**

```bash
git add tests/server/server.test.ts
git commit -m "test(server): add GET /api/graphs smoke tests"
```

---

### Task 3 (M0.14-A): Graph selector UI

**Files:**
- Modify: `src/ui/index.html`
- Modify: `src/ui/app.js`

- [ ] **Step 1: Add Graph tab button to `index.html`**

Insert after the Registry tab button (after the Registry button):

```html
          <button class="tab" data-panel="graph">Graph</button>
```

- [ ] **Step 2: Add Graph panel to `index.html`**

Insert after the Registry panel:

```html
        <section class="panel" id="panel-graph" aria-label="Graph execution view">
          <div class="panel-header"><h2>Graph Execution</h2></div>
          <div class="panel-body graph-view">
            <div class="graph-selector">
              <label for="graph-select">Graph</label>
              <select id="graph-select">
                <option value="">— Select a graph —</option>
              </select>
              <input type="text" id="graph-id-input" placeholder="Or paste graph ID..." />
              <button id="graph-load-btn">Load</button>
            </div>
            <div id="graph-overview" class="graph-overview hidden"></div>
            <div id="graph-nodes" class="graph-nodes hidden"></div>
            <div id="graph-detail" class="graph-detail hidden"></div>
            <div id="graph-rerun" class="graph-rerun hidden"></div>
          </div>
        </section>
```

- [ ] **Step 3: Add graph load/render functions to `app.js`**

Add after the registry loading functions (around line 96 in the current file). Insert these functions:

```javascript
// ── Graph tab ──────────────────────────────────────────────
let graphList = [];
let currentProjection = null;

async function loadGraphList() {
  try {
    const res = await fetch("/api/graphs");
    graphList = await res.json();
    const select = document.getElementById("graph-select");
    if (!select) return;
    select.innerHTML = `<option value="">— Select a graph —</option>`;
    for (const g of graphList) {
      const opt = document.createElement("option");
      opt.value = g.graphId;
      opt.textContent = `${g.graphId}  (${g.status ?? "?"}, ${g.nodeCount ?? 0} nodes)`;
      select.append(opt);
    }
  } catch { /* silently skip if server doesn't support /api/graphs */ }
}

async function loadGraphProjection(graphId) {
  const overview = document.getElementById("graph-overview");
  const nodes = document.getElementById("graph-nodes");
  const detail = document.getElementById("graph-detail");
  const rerun = document.getElementById("graph-rerun");
  if (!overview || !nodes) return;

  try {
    const res = await fetch(`/api/graphs/${encodeURIComponent(graphId)}/projection`);
    if (!res.ok) {
      overview.classList.remove("hidden");
      overview.innerHTML = `<p class="error">Graph not found: ${escapeHtml(graphId)}</p>`;
      return;
    }
    currentProjection = await res.json();
    renderGraphOverview(currentProjection);
    renderNodeTable(currentProjection);
    detail.classList.add("hidden");
    rerun.classList.add("hidden");
  } catch {
    overview.classList.remove("hidden");
    overview.innerHTML = `<p class="error">Failed to load graph projection</p>`;
  }
}

function renderGraphOverview(proj) {
  const el = document.getElementById("graph-overview");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="overview-row">
      <span class="graph-status status-${proj.status}">${escapeHtml(proj.status)}</span>
      <span class="graph-strategy">${escapeHtml(proj.strategy)}</span>
    </div>
    <div class="overview-metrics">
      <div class="metric"><span>Nodes</span><strong>${proj.nodeCount}</strong></div>
      <div class="metric"><span>Completed</span><strong>${proj.nodes.filter(n => n.status === "done").length}</strong></div>
      <div class="metric"><span>Failed</span><strong>${proj.nodes.filter(n => n.status === "failed").length}</strong></div>
      <div class="metric"><span>Blocked</span><strong>${proj.nodes.filter(n => n.status === "blocked").length}</strong></div>
    </div>
    <div class="overview-meta">
      ${proj.sessionIds.length > 0 ? `<p>Sessions: ${proj.sessionIds.map(s => escapeHtml(s)).join(", ")}</p>` : ""}
      ${proj.reports.length > 0 ? `<p>Reports: ${proj.reports.map(r => escapeHtml(r)).join(", ")}</p>` : ""}
      <p>Goal: ${escapeHtml(proj.rootGoal || "(none)")}</p>
    </div>
  `;
}

function renderNodeTable(proj) {
  const el = document.getElementById("graph-nodes");
  el.classList.remove("hidden");

  if (proj.nodes.length === 0) {
    el.innerHTML = '<p class="empty">No nodes in this graph.</p>';
    return;
  }

  el.innerHTML = `<table class="node-table">
    <thead><tr>
      <th></th>
      <th>Node</th>
      <th>Duration</th>
      <th>Capabilities</th>
      <th>Status</th>
      <th>Attempts</th>
      <th></th>
    </tr></thead>
    <tbody>${proj.nodes.map(n => renderNodeRow(n, proj.graphId)).join("")}</tbody>
  </table>`;
}

function renderNodeRow(node, graphId) {
  const statusIcon = node.status === "done" ? "✓" : node.status === "failed" ? "✗" : node.status === "blocked" ? "⊘" : "○";
  const statusClass = node.status === "done" ? "row-done" : node.status === "failed" ? "row-failed" : node.status === "blocked" ? "row-blocked" : "";
  const caps = (node.requiredCapabilities || []).map(c => `<span class="cap-badge">${escapeHtml(c)}</span>`).join(" ");

  let capStatus = "";
  if (node.capabilityResolution) {
    const cs = node.capabilityResolution.status;
    capStatus = `<span class="cap-badge cap-${cs}">${cs}</span>`;
  }

  const attemptsCount = node.attempts ? node.attempts.length : 0;
  const duration = node.durationMs != null ? `${node.durationMs}ms` : "—";
  const showRerun = node.status === "failed";

  return `<tr class="${statusClass}" data-node-id="${escapeHtml(node.nodeId)}">
    <td class="status-icon">${statusIcon}</td>
    <td class="node-title"><button class="link-btn node-detail-btn" data-node-id="${escapeHtml(node.nodeId)}">${escapeHtml(node.title)}</button></td>
    <td class="node-duration">${duration}</td>
    <td class="node-caps">${caps}</td>
    <td class="node-cap-status">${capStatus}</td>
    <td class="node-attempts">${attemptsCount > 0 ? attemptsCount : ""}</td>
    <td class="node-action">${showRerun ? `<button class="rerun-btn" data-graph-id="${escapeHtml(graphId)}" data-node-id="${escapeHtml(node.nodeId)}">Rerun</button>` : ""}</td>
  </tr>`;
}
```

- [ ] **Step 4: Wire graph controls into `connect()` function**

Inside the `connect()` function, after `loadRegistry();` add:

```javascript
  loadGraphList();
```

- [ ] **Step 5: Wire graph event listeners**

After the `compareBtn` event listener block, add graph event listeners:

```javascript
// ── Graph tab listeners ────────────────────────────────────
const graphSelect = document.getElementById("graph-select");
const graphLoadBtn = document.getElementById("graph-load-btn");
const graphIdInput = document.getElementById("graph-id-input");

graphSelect?.addEventListener("change", () => {
  const gid = graphSelect.value;
  if (gid) {
    graphIdInput.value = gid;
    loadGraphProjection(gid);
  }
});

graphLoadBtn?.addEventListener("click", () => {
  const gid = graphIdInput.value.trim();
  if (gid) loadGraphProjection(gid);
});

// Delegate click events for node-detail-btn and rerun-btn
document.getElementById("graph-nodes")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.classList.contains("node-detail-btn")) {
    const nodeId = btn.dataset.nodeId;
    showNodeDetail(nodeId);
  }
  if (btn.classList.contains("rerun-btn")) {
    showRerunCommand(btn.dataset.graphId, btn.dataset.nodeId);
  }
});
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/index.html src/ui/app.js
git commit -m "feat(ui): add Graph tab with selector, overview, and node table"
```

---

### Task 4 (M0.14-A/B): Graph tab CSS

**Files:**
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Add graph view styles**

Append to `src/ui/styles.css`:

```css
/* === Graph view === */
.graph-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.graph-selector {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.graph-selector select {
  flex: 1;
  min-width: 200px;
  padding: 0.4rem 0.6rem;
  background: var(--panel, #151a1b);
  color: var(--text, #f5f0df);
  border: 1px solid var(--panel-line, #2f3a36);
  border-radius: 4px;
}

.graph-selector input {
  flex: 1;
  min-width: 150px;
  padding: 0.4rem 0.6rem;
  background: var(--panel, #151a1b);
  color: var(--text, #f5f0df);
  border: 1px solid var(--panel-line, #2f3a36);
  border-radius: 4px;
}

/* Overview */
.graph-overview {
  background: var(--panel, #151a1b);
  border: 1px solid var(--panel-line, #2f3a36);
  border-radius: 6px;
  padding: 1rem;
}

.overview-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.graph-status {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
}

.graph-status.status-completed { background: rgba(63,185,80,0.15); color: #3fb950; }
.graph-status.status-failed { background: rgba(248,81,73,0.15); color: #f85149; }
.graph-status.status-running { background: rgba(210,153,34,0.15); color: #d29922; }
.graph-status.status-pending { background: rgba(139,148,158,0.15); color: #8b949e; }

.overview-metrics {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 0.75rem;
}

.overview-metrics .metric {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.overview-metrics .metric span {
  font-size: 0.75rem;
  color: var(--muted, #a59f90);
}

.overview-metrics .metric strong {
  font-size: 1.1rem;
}

.overview-meta {
  font-size: 0.85rem;
  color: var(--muted, #a59f90);
}

.overview-meta p { margin: 0.25rem 0; }

/* Node table */
.node-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.node-table th {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--panel-line, #2f3a36);
  color: var(--muted, #a59f90);
  font-weight: 600;
}

.node-table td {
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid rgba(47,58,54,0.5);
  vertical-align: middle;
}

.node-table .status-icon {
  text-align: center;
  font-size: 1rem;
  width: 2rem;
}

.node-table .row-failed { background: rgba(248,81,73,0.05); }
.node-table .row-blocked { background: rgba(210,153,34,0.05); }

.node-table .node-title button.link-btn {
  background: none;
  border: none;
  color: var(--accent, #58a6ff);
  cursor: pointer;
  padding: 0;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.node-table .node-title button.link-btn:hover {
  color: #79c0ff;
}

.node-table .node-duration {
  font-family: monospace;
  font-size: 0.8rem;
  white-space: nowrap;
}

.node-table .node-caps {
  max-width: 200px;
}

.node-table .node-action button.rerun-btn {
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--accent-2, #c05530);
  background: transparent;
  color: var(--accent-2, #c05530);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.node-table .node-action button.rerun-btn:hover {
  background: rgba(192,85,48,0.1);
}

/* Capability status badges */
.cap-ready { background: rgba(63,185,80,0.15); color: #3fb950; }
.cap-blocked { background: rgba(210,153,34,0.15); color: #d29922; }
.cap-needs_approval { background: rgba(248,81,73,0.15); color: #f85149; }

/* Detail panel */
.graph-detail {
  background: var(--panel, #151a1b);
  border: 1px solid var(--panel-line, #2f3a36);
  border-radius: 6px;
  padding: 1rem;
}

.graph-detail h3 {
  margin: 0 0 0.75rem;
  color: var(--accent, #58a6ff);
}

.detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  font-size: 0.85rem;
}

.detail-grid dt {
  color: var(--muted, #a59f90);
  font-weight: 600;
}

.detail-grid dd {
  margin: 0;
}

/* Rerun command panel */
.graph-rerun {
  background: var(--panel, #151a1b);
  border: 1px solid var(--accent-2, #c05530);
  border-radius: 6px;
  padding: 1rem;
}

.graph-rerun h3 {
  margin: 0 0 0.5rem;
  color: var(--accent-2, #c05530);
  font-size: 0.9rem;
}

.rerun-command-box {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  background: rgba(0,0,0,0.3);
  padding: 0.6rem 1rem;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.rerun-command-box code {
  flex: 1;
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--text, #f5f0df);
  user-select: all;
}

.rerun-command-box button {
  padding: 0.3rem 0.8rem;
  border: 1px solid var(--panel-line, #2f3a36);
  background: var(--bg, #0b0e0f);
  color: var(--text, #f5f0df);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.rerun-command-box button:hover {
  background: var(--panel-line, #2f3a36);
}

.rerun-options {
  display: flex;
  gap: 1rem;
  font-size: 0.8rem;
  color: var(--muted, #a59f90);
}

.rerun-options label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
}

.hidden { display: none; }
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles.css
git commit -m "feat(ui): add graph tab CSS — selector, overview, node table, detail, rerun"
```

---

### Task 5 (M0.14-C): Enhance projection with capability data

**Files:**
- Modify: `src/kernel/graph-projection.ts`

**What it builds:** The `NodeRunInfo` type and `buildGraphProjection()` currently don't include `requiredCapabilities` or `capabilityResolution`. This task adds them so the node table and detail panel can display capability info.

- [ ] **Step 1: Add `requiredCapabilities` and `capabilityResolution` to `NodeRunInfo`**

In `src/kernel/graph-projection.ts`, update the `NodeRunInfo` interface:

```typescript
export interface NodeRunInfo {
  nodeId: string;
  title: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  sessionId?: string;
  summary?: string;
  error?: string;
  attempts?: NodeAttempt[];
  requiredCapabilities?: string[];
  capabilityResolution?: {
    requiredCapabilities: string[];
    matchedAgents: string[];
    matchedTools: string[];
    missingCapabilities: string[];
    warnings: string[];
    status: "ready" | "blocked" | "needs_approval";
  };
}
```

- [ ] **Step 2: Read capability data from graph JSON node definitions**

In `buildGraphProjection()`, update the node mapping at line 65-69 to pass through capability data:

```typescript
  const nodes: NodeRunInfo[] = (graphJson.nodes || []).map((n: any) => ({
    nodeId: n.id,
    title: n.title || n.id,
    status: n.status || "pending",
    requiredCapabilities: n.requiredCapabilities,
    capabilityResolution: n.capabilityResolution,
  }));
```

- [ ] **Step 3: Verify build and existing tests still pass**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/kernel/graph-projection.test.js 2>&1
```

Expected: build passes, 5 projection tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/kernel/graph-projection.ts
git commit -m "feat(graph): add requiredCapabilities and capabilityResolution to projection"
```

---

### Task 6 (M0.14-D): Node detail panel — CapabilityResolution

**Files:**
- Modify: `src/ui/app.js`

- [ ] **Step 1: Add `showNodeDetail` function**

Add this function after `renderNodeRow()` in `app.js`:

```javascript
function showNodeDetail(nodeId) {
  if (!currentProjection) return;
  const node = currentProjection.nodes.find(n => n.nodeId === nodeId);
  if (!node) return;

  const el = document.getElementById("graph-detail");
  el.classList.remove("hidden");

  const cr = node.capabilityResolution;
  if (!cr) {
    el.innerHTML = `<h3>${escapeHtml(node.title)}</h3><p class="empty">No capability resolution data for this node.</p>`;
    return;
  }

  const statusClass = `cap-${cr.status}`;
  el.innerHTML = `
    <h3>${escapeHtml(node.title)} — Capability Resolution</h3>
    <dl class="detail-grid">
      <dt>Status</dt>
      <dd><span class="cap-badge ${statusClass}">${cr.status}</span></dd>
      ${cr.matchedAgents.length > 0 ? `<dt>Agents</dt><dd>${cr.matchedAgents.map(a => escapeHtml(a)).join(", ")}</dd>` : ""}
      ${cr.matchedTools.length > 0 ? `<dt>Tools</dt><dd>${cr.matchedTools.map(t => escapeHtml(t)).join(", ")}</dd>` : ""}
      ${cr.missingCapabilities.length > 0 ? `<dt>Missing</dt><dd class="error">${cr.missingCapabilities.map(c => escapeHtml(c)).join(", ")}</dd>` : ""}
      ${cr.warnings.length > 0 ? `<dt>Warnings</dt><dd class="warning">${cr.warnings.map(w => escapeHtml(w)).join("; ")}</dd>` : ""}
    </dl>
  `;
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(ui): add capability resolution detail panel per node"
```

---

### Task 7 (M0.14-E): Rerun command helper

**Files:**
- Modify: `src/ui/app.js`

- [ ] **Step 1: Add `showRerunCommand` function**

Add this function after `showNodeDetail()` in `app.js`:

```javascript
function showRerunCommand(graphId, nodeId) {
  const el = document.getElementById("graph-rerun");
  el.classList.remove("hidden");

  const baseCmd = `alix graph rerun ${graphId} --node ${nodeId}`;
  const forceCmd = `${baseCmd} --force`;

  el.innerHTML = `
    <h3>⤴ Rerun Node</h3>
    <div class="rerun-command-box">
      <code id="rerun-command-text">${escapeHtml(baseCmd)}</code>
      <button id="rerun-copy-btn">Copy</button>
    </div>
    <div class="rerun-options">
      <label>
        <input type="checkbox" id="rerun-force-toggle" />
        --force (rerun even if not failed)
      </label>
    </div>
  `;

  // Copy handler
  document.getElementById("rerun-copy-btn").addEventListener("click", async () => {
    const codeEl = document.getElementById("rerun-command-text");
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      const btn = document.getElementById("rerun-copy-btn");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    } catch {
      // Fallback for non-HTTPS environments
      const textArea = document.createElement("textarea");
      textArea.value = codeEl.textContent;
      document.body.append(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }
  });

  // Force toggle
  document.getElementById("rerun-force-toggle").addEventListener("change", (e) => {
    const codeEl = document.getElementById("rerun-command-text");
    codeEl.textContent = e.target.checked ? forceCmd : baseCmd;
  });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(ui): add rerun command helper with copy and --force toggle"
```

---

### Task 8: Full build and test pass

**Files:**
- Run: full build + test suite

- [ ] **Step 1: Build and run all tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/server/server.test.js dist/tests/kernel/graph-projection.test.js dist/tests/kernel/graph-executor.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 2: Push**

```bash
git push
```
