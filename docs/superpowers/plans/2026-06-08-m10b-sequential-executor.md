# M0.10-B: Sequential Multi-Node Executor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute a planned TaskGraph one node at a time, stopping on first failure.

**Architecture:** A `GraphExecutor` class that loads a graph from `.alix/graphs/`, topologically sorts nodes, normalizes missing fields, then runs each node through `runTask()`. Each node emits `task.started`/`task.done`/`task.failed` events. The graph emits `graph.completed` or `graph.failed`.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/graph-executor.ts` | **Create** | `GraphExecutor` class — load, validate, sort, execute, normalize |
| `src/cli.ts` | **Modify** | Add `alix graph run <graphId>` and `alix graph list` |
| `tests/kernel/graph-executor.test.ts` | **Create** | Tests |

---

### Task 1: Create GraphExecutor module

**Files:**
- Create: `src/kernel/graph-executor.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * graph-executor.ts — Sequential multi-node TaskGraph executor.
 *
 * Loads a planned graph from .alix/graphs/, validates it, sorts nodes
 * topologically, normalizes missing fields, and executes each node
 * sequentially through runTask(). Stops on first failure.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { TaskGraph, TaskNode, TaskNodeStatus } from "./task-graph.js";
import { transitionNodeStatus, transitionGraphStatus } from "./task-graph.js";
import type { RunResult } from "../run.js";
import { runTask } from "../run.js";

export interface NodeResult {
  nodeId: string;
  title: string;
  status: TaskNodeStatus;
  summary?: string;
  reason?: string;
  durationMs: number;
}

export interface ExecutorResult {
  graphId: string;
  strategy: string;
  nodeCount: number;
  completedNodes: number;
  failedNode?: string;
  results: NodeResult[];
  graphStatus: "completed" | "failed";
}

/** Load a TaskGraph from disk. */
export async function loadGraph(graphId: string, cwd: string): Promise<TaskGraph> {
  const filePath = join(cwd, ".alix", "graphs", `${graphId}.json`);
  if (!existsSync(filePath)) throw new Error(`Graph not found: ${graphId} (${filePath})`);
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as TaskGraph;
}

/** Normalize a node, filling missing fields with safe defaults. */
export function normalizeNode(node: TaskNode): TaskNode {
  return {
    ...node,
    requiredCapabilities: node.requiredCapabilities ?? [],
    riskLevel: node.riskLevel || "medium",
    domain: node.domain || "general",
    dependencies: node.dependencies ?? [],
    status: "ready" as TaskNodeStatus,
  };
}

/** Topological sort: return nodes in dependency order. Throws on cycles. */
export function sortNodesByDependencies(nodes: TaskNode[]): TaskNode[] {
  const sorted: TaskNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cycle detected: node ${id}`);
    visiting.add(id);
    const node = nodeMap.get(id);
    if (node) {
      for (const dep of node.dependencies) visit(dep);
      sorted.push(node);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of nodes) visit(node.id);
  return sorted;
}

export class GraphExecutor {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async execute(graphId: string): Promise<ExecutorResult> {
    const graph = await loadGraph(graphId, this.cwd);
    const nodes = graph.nodes.map(normalizeNode);
    const sorted = sortNodesByDependencies(nodes);
    const results: NodeResult[] = [];
    let failed = false;

    for (const node of sorted) {
      const startTime = Date.now();
      let status: TaskNodeStatus = "done";
      let summary = "";
      let reason: string | undefined;

      try {
        const result: RunResult = await runTask(this.cwd, node.goal, {
          planMode: false,
          sessionMode: node.riskLevel === "high" || node.riskLevel === "critical" ? "ask" : "bypass",
        });
        summary = result.summary;
        if (result.reason && result.reason !== "completed") {
          status = "failed";
          reason = result.reason;
          failed = true;
        }
      } catch (err) {
        status = "failed";
        reason = err instanceof Error ? err.message : String(err);
        failed = true;
      }

      results.push({
        nodeId: node.id,
        title: node.title,
        status,
        summary,
        reason,
        durationMs: Date.now() - startTime,
      });

      if (failed) break;
    }

    return {
      graphId,
      strategy: graph.strategy,
      nodeCount: sorted.length,
      completedNodes: results.filter(r => r.status === "done").length,
      failedNode: failed ? results[results.length - 1].nodeId : undefined,
      results,
      graphStatus: failed ? "failed" : "completed",
    };
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/kernel/graph-executor.ts
git commit -m "feat(graph): add GraphExecutor sequential runner"
```

---

### Task 2: Wire CLI commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `alix graph run <graphId>` and `alix graph list`**

Find the existing `alix graph plan` handler and add after it:

```typescript
// --- alix graph run --- execute a planned graph ---
if (command === "graph" && args[0] === "run") {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph run <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { GraphExecutor } = await import("./kernel/graph-executor.js");
  const executor = new GraphExecutor(cwd);
  console.log(`Executing graph: ${graphId}`);
  console.log();
  const result = await executor.execute(graphId);
  for (const nr of result.results) {
    const icon = nr.status === "done" ? "✓" : nr.status === "failed" ? "✗" : "○";
    console.log(`  ${icon} ${nr.title} (${nr.durationMs}ms)`);
    if (nr.reason) console.log(`     reason: ${nr.reason}`);
  }
  console.log();
  console.log(`Graph: ${result.graphStatus} — ${result.completedNodes}/${result.nodeCount} nodes`);
  process.exit(0);
}

// --- alix graph list --- list saved graphs ---
if (command === "graph" && args[0] === "list") {
  const { readdir } = await import("node:fs/promises");
  const graphsDir = join(cwd, ".alix", "graphs");
  if (!existsSync(graphsDir)) { console.log("No graphs found."); process.exit(0); }
  const files = await readdir(graphsDir);
  const jsonFiles = files.filter(f => f.endsWith(".json") && !f.includes(".raw") && !f.includes(".validation"));
  if (jsonFiles.length === 0) { console.log("No graphs found."); process.exit(0); }
  console.log("Saved graphs:");
  for (const f of jsonFiles.sort().reverse()) {
    const id = f.replace(/\.json$/, "");
    try {
      const graph = JSON.parse(await readFile(join(cwd, ".alix", "graphs", f), "utf-8"));
      console.log(`  ${id} — ${graph.nodes?.length ?? "?"} nodes, "${(graph.rootGoal || "").slice(0, 60)}"`);
    } catch { console.log(`  ${id} — (unreadable)`); }
  }
  process.exit(0);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add alix graph run and alix graph list commands"
```

---

### Task 3: Write tests

**Files:**
- Create: `tests/kernel/graph-executor.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortNodesByDependencies, normalizeNode, loadGraph } from "../../src/kernel/graph-executor.js";
import type { TaskNode, TaskGraph } from "../../src/kernel/task-graph.js";

describe("GraphExecutor", () => {

  it("sortNodesByDependencies returns nodes in dependency order", () => {
    const nodes: TaskNode[] = [
      { id: "c", graphId: "g1", title: "C", goal: "c", domain: "x", status: "pending", dependencies: ["a"], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
      { id: "a", graphId: "g1", title: "A", goal: "a", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
      { id: "b", graphId: "g1", title: "B", goal: "b", domain: "x", status: "pending", dependencies: ["a"], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
    ];
    const sorted = sortNodesByDependencies(nodes);
    const ids = sorted.map(n => n.id);
    assert.equal(ids[0], "a", "a should be first (no deps)");
    assert.ok(ids.indexOf("b") > ids.indexOf("a"), "b should come after a");
    assert.ok(ids.indexOf("c") > ids.indexOf("a"), "c should come after a");
  });

  it("sortNodesByDependencies throws on cycle", () => {
    const nodes: TaskNode[] = [
      { id: "a", graphId: "g1", title: "A", goal: "a", domain: "x", status: "pending", dependencies: ["b"], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
      { id: "b", graphId: "g1", title: "B", goal: "b", domain: "x", status: "pending", dependencies: ["a"], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
    ];
    assert.throws(() => sortNodesByDependencies(nodes));
  });

  it("normalizeNode fills missing fields", () => {
    const raw = { id: "n1", graphId: "g1", title: "Test", goal: "test", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" } as TaskNode;
    // Remove optional fields to test defaults
    delete (raw as any).riskLevel;
    delete (raw as any).dependencies;
    const norm = normalizeNode(raw);
    assert.equal(norm.riskLevel, "medium", "default risk is medium");
    assert.deepEqual(norm.dependencies, [], "default deps is empty array");
  });

  it("loadGraph rejects missing graph", async () => {
    await assert.rejects(() => loadGraph("nonexistent_graph", "/tmp"), /Graph not found/);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/kernel/graph-executor.test.js 2>&1
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/graph-executor.test.ts
git commit -m "test(graph): sequential executor tests — sort, cycle detection, normalize, load"
```
