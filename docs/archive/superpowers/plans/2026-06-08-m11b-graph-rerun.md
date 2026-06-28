# M0.11-B: Rerun Failed Graph Node

**Status:** ✅ Completed (M0.11) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix graph rerun <graphId> --node <nodeId>` to rerun a single failed node, preserving its goal, executionProfile, and constraints, while creating a new child session and tracking attempts.

**Architecture:** Extend `GraphExecutor` with `rerunNode(graphId, nodeId)` method. Extend `GraphRunProjection` to track multiple attempts per node. CLI command finds the failed node, reruns it, captures the new session ID, and updates the graph JSON status.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/graph-projection.ts` | **Modify** | Add `attempts` array to `NodeRunInfo` |
| `src/kernel/graph-executor.ts` | **Modify** | Add `rerunNode(graphId, nodeId)` method |
| `src/cli.ts` | **Modify** | Add `alix graph rerun` command handler |
| `tests/kernel/graph-executor.test.ts` | **Modify** | Add rerun tests |

---

### Task 1: Extend NodeRunInfo with attempts

**Files:** `src/kernel/graph-projection.ts`

- [ ] **Step 1: Add attempts to NodeRunInfo**

Replace the `NodeRunInfo` interface:

```typescript
export interface NodeAttempt {
  attempt: number;
  sessionId?: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
  error?: string;
}

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
}
```

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -3
git add src/kernel/graph-projection.ts
git commit -m "feat(graph): add attempts tracking to NodeRunInfo"
```

---

### Task 2: Add rerunNode method to GraphExecutor

**Files:** `src/kernel/graph-executor.ts`

- [ ] **Step 1: Add rerunNode method**

Add a new method to `GraphExecutor`:

```typescript
/**
 * Rerun a single node from a graph by ID.
 * Only failed nodes can be rerun without --force.
 */
async rerunNode(graphId: string, nodeId: string, opts?: { force?: boolean }): Promise<NodeResult> {
  const graph = await loadGraph(graphId, this.cwd);
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId} in graph ${graphId}`);

  // Only failed nodes can be rerun by default
  if (node.status !== "failed" && !opts?.force) {
    throw new Error(`Node ${nodeId} status is "${node.status}". Use --force to rerun anyway.`);
  }

  const startTime = Date.now();
  let status: TaskNodeStatus = "done";
  let summary = "";
  let reason: string | undefined;

  try {
    const isResearch = (node as any).executionProfile === "research";
    let researchPrefix = "";
    if (isResearch && node.id !== "write_artifacts") {
      researchPrefix = "\n\nIMPORTANT: You are a research agent. You may ONLY use: web_search, web_fetch, and done. Do NOT read or write local project files.";
    } else if (node.id === "write_artifacts") {
      researchPrefix = "\n\nIMPORTANT: You may ONLY use: file.create, file.exists, and done. Write artifacts ONLY under .alix/reports/. Do NOT read project source files.";
    }
    const result: RunResult = await runTask(this.cwd, node.goal + researchPrefix, {
      planMode: false,
      skipContext: isResearch ? true : undefined,
      sessionMode: node.riskLevel === "high" || node.riskLevel === "critical" ? "ask" : "bypass",
    });
    summary = result.summary;
    if (result.reason && result.reason !== "completed") {
      status = "failed";
      reason = result.reason;
    }
  } catch (err) {
    status = "failed";
    reason = err instanceof Error ? err.message : String(err);
  }

  // Update node status in graph file
  node.status = status === "done" ? "done" : "failed";
  graph.status = status === "done" ? "running" : "failed";
  node.updatedAt = new Date().toISOString();

  // Persist updated graph
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await writeFile(
    join(this.cwd, ".alix", "graphs", `${graphId}.json`),
    JSON.stringify(graph, null, 2),
    "utf-8",
  );

  const durationMs = Date.now() - startTime;
  return { nodeId: node.id, title: node.title, status, summary, reason, durationMs };
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/kernel/graph-executor.ts
git commit -m "feat(graph): add rerunNode for single-node rerun"
```

---

### Task 3: Add CLI command

**Files:** `src/cli.ts`

- [ ] **Step 1: Add rerun handler**

Add after the existing `alix graph run` handler:

```typescript
// --- alix graph rerun --- rerun a failed node ---
if (command === "graph" && args[0] === "rerun") {
  const graphId = args[1];
  const nodeIdx = args.indexOf("--node");
  const nodeId = nodeIdx >= 0 ? args[nodeIdx + 1] : undefined;
  const force = args.includes("--force");

  if (!graphId || !nodeId) {
    console.error("Usage: alix graph rerun <graphId> --node <nodeId> [--force]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const { GraphExecutor } = await import("./kernel/graph-executor.js");
  const executor = new GraphExecutor(cwd);

  try {
    const result = await executor.rerunNode(graphId, nodeId, { force });
    const icon = result.status === "done" ? "✓" : "✗";
    console.log(`  ${icon} ${result.title} (${result.durationMs}ms)`);
    if (result.reason) console.log(`     reason: ${result.reason}`);
    process.exit(result.status === "done" ? 0 : 1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Add help text entry**

Find the `--help` block and add after the `alix graph run` line:
```
  alix graph rerun <id> --node <id>  Rerun a failed graph node
```

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add alix graph rerun command"
```

---

### Task 4: Tests

**Files:** `tests/kernel/graph-executor.test.ts`

- [ ] **Step 1: Add rerun tests**

```typescript
it("rerunNode throws for unknown graph", async () => {
  const { GraphExecutor } = await import("../../src/kernel/graph-executor.js");
  const exec = new GraphExecutor("/tmp");
  await assert.rejects(
    () => exec.rerunNode("nonexistent", "node_a"),
    /Graph not found/,
  );
});

it("rerunNode throws for non-failed node without force", async () => {
  // Create a minimal graph with a "done" node
  const { randomUUID } = await import("node:crypto");
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const tmpDir = mkdtempSync(join(tmpdir(), "rerun-test-"));
  const graphId = `graph_rerun_test`;
  const graphsDir = join(tmpDir, ".alix", "graphs");
  mkdirSync(graphsDir, { recursive: true });
  writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
    id: graphId, schemaVersion: "1.0", workflowId: "wf_test", rootGoal: "test",
    status: "completed", strategy: "sequential",
    nodes: [{
      id: "node_a", graphId, title: "Node A", goal: "test",
      domain: "test", status: "done", dependencies: [], requiredCapabilities: [],
      riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [],
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }],
    edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
  }));
  const exec = new (await import("../../src/kernel/graph-executor.js")).GraphExecutor(tmpDir);
  await assert.rejects(
    () => exec.rerunNode(graphId, "node_a"),
    /status is "done"/,
  );
  rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/kernel/graph-executor.test.js 2>&1 | grep -E "ℹ|fail"
```

Expected: 8 tests pass (6 existing + 2 new).

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/graph-executor.test.ts
git commit -m "test(graph): rerunNode validation tests"
```
