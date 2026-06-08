# M0.11-A: Graph Run Projection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a projection layer that reconstructs what happened during a graph run from event logs and graph JSON — which nodes ran, which sessions they created, which failed, what artifacts resulted.

**Architecture:** A `GraphRunProjection` module that takes a `graphId` and scans the `.alix/graphs/<graphId>.json` file for node definitions, then reads session events from `.alix/sessions/` looking for `graph.*` and `task.*` events that reference that graphId. The result is a structured `GraphRunProjection` object that the `alix graph inspect` command can display.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/graph-projection.ts` | **Create** | `GraphRunProjection` type + `buildGraphProjection()` function |
| `src/cli.ts` | **Modify** | Wire projection into `alix graph inspect` |
| `tests/kernel/graph-projection.test.ts` | **Create** | Tests for projection reconstruction |

---

### Task 1: Create graph projection module

**Files:**
- Create: `src/kernel/graph-projection.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * graph-projection.ts — Reconstruct graph run state from events and graph JSON.
 *
 * A GraphRunProjection answers: What graph ran? Which nodes?
 * Which sessions? Which nodes failed? What artifacts exist?
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

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
}

export interface GraphRunProjection {
  graphId: string;
  rootGoal: string;
  strategy: string;
  status: string;
  nodeCount: number;
  nodes: NodeRunInfo[];
  reports: string[];
  sessionIds: string[];
}

/**
 * Build a GraphRunProjection from graph JSON + session events.
 *
 * Reads the graph file from .alix/graphs/<graphId>.json for node definitions.
 * Then scans session event logs in .alix/sessions/ for events that
 * carry matching graphId in their meta field.
 */
export async function buildGraphProjection(
  graphId: string,
  cwd: string,
): Promise<GraphRunProjection> {
  // Load graph definition
  const graphPath = join(cwd, ".alix", "graphs", `${graphId}.json`);
  if (!existsSync(graphPath)) {
    throw new Error(`Graph not found: ${graphId}`);
  }
  const graphJson = JSON.parse(await readFile(graphPath, "utf-8"));
  const nodes: NodeRunInfo[] = (graphJson.nodes || []).map((n: any) => ({
    nodeId: n.id,
    title: n.title || n.id,
    status: n.status || "pending",
  }));

  // Scan sessions for events matching this graphId
  const sessionsDir = join(cwd, ".alix", "sessions");
  const sessionIds = new Set<string>();
  const nodeTimestamps: Record<string, { started?: string; completed?: string; sessionId?: string }> = {};
  let reports: string[] = [];

  if (existsSync(sessionsDir)) {
    const sessionDirs = await readdir(sessionsDir);
    for (const sd of sessionDirs) {
      const eventsPath = join(sessionsDir, sd, "events.jsonl");
      if (!existsSync(eventsPath)) continue;
      const raw = await readFile(eventsPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      let foundGraph = false;
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          const meta = ev.meta || {};
          if (meta.graphId === graphId || ev.payload?.graphId === graphId) {
            foundGraph = true;
            sessionIds.add(sd);

            if (ev.type === "task.started" || ev.type === "task.ready") {
              const nid = meta.nodeId || ev.payload?.nodeId;
              if (nid) {
                if (!nodeTimestamps[nid]) nodeTimestamps[nid] = {};
                nodeTimestamps[nid].started = ev.timestamp;
                nodeTimestamps[nid].sessionId = sd;
              }
            }
            if (ev.type === "task.done" || ev.type === "task.failed") {
              const nid = meta.nodeId || ev.payload?.nodeId;
              if (nid) {
                if (!nodeTimestamps[nid]) nodeTimestamps[nid] = {};
                nodeTimestamps[nid].completed = ev.timestamp;
                nodeTimestamps[nid].sessionId = sd;
              }
              // Track task.failed error
              if (ev.type === "task.failed") {
                const nodeIdx = nodes.findIndex(n => n.nodeId === (meta.nodeId || ev.payload?.nodeId));
                if (nodeIdx >= 0) {
                  nodes[nodeIdx].status = "failed";
                  nodes[nodeIdx].error = ev.payload?.reason || ev.payload?.error || "Unknown error";
                }
              }
              if (ev.type === "task.done") {
                const nodeIdx = nodes.findIndex(n => n.nodeId === (meta.nodeId || ev.payload?.nodeId));
                if (nodeIdx >= 0) {
                  nodes[nodeIdx].status = "done";
                  nodes[nodeIdx].summary = ev.payload?.summary;
                }
              }
            }
            // Track report references
            if (ev.payload?.reportDir || ev.payload?.reportId) {
              reports.push(ev.payload?.reportDir || ev.payload?.reportId);
            }
          }
        } catch { /* skip malformed lines */ }
      }
    }
  }

  // Merge timestamps into nodes
  for (const [nid, ts] of Object.entries(nodeTimestamps)) {
    const nodeIdx = nodes.findIndex(n => n.nodeId === nid);
    if (nodeIdx >= 0) {
      nodes[nodeIdx].startedAt = ts.started;
      nodes[nodeIdx].completedAt = ts.completed;
      nodes[nodeIdx].sessionId = ts.sessionId;
      if (ts.started && ts.completed) {
        nodes[nodeIdx].durationMs = new Date(ts.completed).getTime() - new Date(ts.started).getTime();
      }
    }
  }

  // Determine graph-level status
  const hasFailed = nodes.some(n => n.status === "failed");
  const allDone = nodes.every(n => n.status === "done");
  const status = hasFailed ? "failed" : allDone ? "completed" : graphJson.status || "running";

  return {
    graphId,
    rootGoal: graphJson.rootGoal || "",
    strategy: graphJson.strategy || "sequential",
    status,
    nodeCount: nodes.length,
    nodes,
    reports: [...new Set(reports)],
    sessionIds: [...sessionIds],
  };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/graph-projection.ts
git commit -m "feat(graph): add GraphRunProjection from events and graph JSON"
```

---

### Task 2: Wire projection into graph inspect CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Extend graph inspect to show projection data**

Find the existing `alix graph inspect` handler (around line 255). After the existing node display loop, add projection data:

```typescript
  // Show run projection data
  try {
    const { buildGraphProjection } = await import("./kernel/graph-projection.js");
    const projection = await buildGraphProjection(graphId, cwd);
    if (projection.sessionIds.length > 0) {
      console.log();
      console.log("Run sessions:");
      for (const sid of projection.sessionIds) {
        console.log(`  ${sid}`);
      }
    }
    if (projection.reports.length > 0) {
      console.log();
      console.log("Reports:");
      for (const r of projection.reports) {
        console.log(`  ${r}`);
      }
    }
  } catch {}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): show run sessions and reports in graph inspect"
```

---

### Task 3: Write tests

**Files:**
- Create: `tests/kernel/graph-projection.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { buildGraphProjection } from "../../src/kernel/graph-projection.js";

describe("GraphProjection", () => {
  let tmpDir: string;
  const graphId = `graph_${randomUUID()}`;
  const sessionId = `session_${randomUUID()}`;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "graph-proj-test-"));

    // Write graph file
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });
    writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
      id: graphId, schemaVersion: "1.0",
      workflowId: "wf_test", rootGoal: "test research task",
      status: "completed", strategy: "sequential",
      nodes: [
        { id: "search", graphId, title: "Search sources", goal: "search", domain: "research",
          status: "done", dependencies: [], requiredCapabilities: ["web.search"],
          riskLevel: "low", approvalMode: "auto", inputs: {},
          artifacts: [], memoryRefs: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" },
        { id: "synthesize", graphId, title: "Synthesize", goal: "synthesize", domain: "research",
          status: "done", dependencies: ["search"], requiredCapabilities: [],
          riskLevel: "low", approvalMode: "auto", inputs: {},
          artifacts: [], memoryRefs: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      ],
      edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));

    // Write session events
    const sessionDir = join(tmpDir, ".alix", "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const timestamp = "2026-06-08T12:00:00.000Z";
    const lines = [
      `{"id":"1","sessionId":"${sessionId}","type":"graph.created","meta":{"graphId":"${graphId}"},"timestamp":"${timestamp}","actor":"system","payload":{"graphId":"${graphId}"}}`,
      `{"id":"2","sessionId":"${sessionId}","type":"task.started","meta":{"graphId":"${graphId}","nodeId":"search"},"timestamp":"${timestamp}","actor":"system","payload":{"nodeId":"search"}}`,
      `{"id":"3","sessionId":"${sessionId}","type":"task.done","meta":{"graphId":"${graphId}","nodeId":"search"},"timestamp":"${timestamp}","actor":"system","payload":{"nodeId":"search","summary":"found sources"}}`,
      `{"id":"4","sessionId":"${sessionId}","type":"task.started","meta":{"graphId":"${graphId}","nodeId":"synthesize"},"timestamp":"${timestamp}","actor":"system","payload":{"nodeId":"synthesize"}}`,
      `{"id":"5","sessionId":"${sessionId}","type":"task.done","meta":{"graphId":"${graphId}","nodeId":"synthesize"},"timestamp":"${timestamp}","actor":"system","payload":{"nodeId":"synthesize","summary":"wrote report"}}`,
    ].join("\n");
    writeFileSync(join(sessionDir, "events.jsonl"), lines);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds projection with correct graphId and rootGoal", async () => {
    const p = await buildGraphProjection(graphId, tmpDir);
    assert.equal(p.graphId, graphId);
    assert.equal(p.rootGoal, "test research task");
    assert.equal(p.nodeCount, 2);
  });

  it("reconstructs node status from events", async () => {
    const p = await buildGraphProjection(graphId, tmpDir);
    const search = p.nodes.find(n => n.nodeId === "search");
    assert.ok(search, "search node should exist");
    assert.equal(search?.status, "done");
    assert.equal(search?.summary, "found sources");

    const syn = p.nodes.find(n => n.nodeId === "synthesize");
    assert.ok(syn, "synthesize node should exist");
    assert.equal(syn?.status, "done");
  });

  it("detects session IDs that participated in the graph", async () => {
    const p = await buildGraphProjection(graphId, tmpDir);
    assert.ok(p.sessionIds.includes(sessionId), `session ${sessionId} should be in sessionIds`);
  });

  it("computes durationMs from timestamps", async () => {
    const p = await buildGraphProjection(graphId, tmpDir);
    for (const node of p.nodes) {
      assert.equal(typeof node.durationMs, "number");
    }
  });

  it("throws for nonexistent graph", async () => {
    await assert.rejects(
      () => buildGraphProjection("nonexistent_graph", tmpDir),
      /Graph not found/
    );
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/kernel/graph-projection.test.js 2>&1
```

Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/graph-projection.test.ts
git commit -m "test(graph): projection reconstruction with events and graph JSON"
```
