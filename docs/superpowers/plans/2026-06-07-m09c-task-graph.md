# M0.9-C: Single-Node TaskGraph Wrapper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `alix run` creates a single-node TaskGraph internally, emits `graph.created`, `task.ready`, `task.started`, `task.done`/`task.failed` events, and supports `alix graph inspect <graph-id>`.

**Architecture:** Uses `createSingleNodeGraph()` from the scaffold to wrap the current task loop. The graph and node IDs are attached to all events via `EventMeta`. The existing `runTaskLoop` runs inside the single node — no scheduling changes needed.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/task-graph.ts` | **Create** | TaskGraph/TaskNode types, `createSingleNodeGraph()`, status helpers |
| `src/agent/agent-loop.ts` | **Modify** | Create graph, emit events, attach meta |
| `tests/kernel/task-graph.test.ts` | **Create** | Tests |

---

### Task 1: Create TaskGraph module

**Files:**
- Create: `src/kernel/task-graph.ts`

- [ ] **Step 1: Write the module**

```typescript
import { randomUUID } from "node:crypto";

export type TaskNodeStatus =
  | "pending" | "ready" | "running" | "blocked" | "awaiting_approval"
  | "cancelling" | "done" | "failed" | "cancelled" | "skipped";

export type TaskGraphStatus =
  | "draft" | "ready" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalMode = "auto" | "ask" | "deny";
export type GraphStrategy = "sequential" | "parallel" | "map_reduce" | "critic_loop" | "human_gated" | "hybrid";
export type EdgeType = "requires" | "informs" | "blocks" | "critiques" | "approves";

export interface TaskNode {
  id: string;
  graphId: string;
  title: string;
  goal: string;
  domain: string;
  status: TaskNodeStatus;
  dependencies: string[];
  assignedAgent?: string;
  requiredCapabilities: string[];
  forbiddenCapabilities?: string[];
  riskLevel: RiskLevel;
  approvalMode: ApprovalMode;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  artifacts: string[];
  memoryRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskGraph {
  id: string;
  schemaVersion: "1.0";
  workflowId: string;
  rootGoal: string;
  status: TaskGraphStatus;
  strategy: GraphStrategy;
  nodes: TaskNode[];
  edges: { id: string; graphId: string; from: string; to: string; type: EdgeType }[];
  createdAt: string;
  updatedAt: string;
}

export function createSingleNodeGraph(workflowId: string, goal: string, domain = "legacy"): { graph: TaskGraph; node: TaskNode } {
  const now = new Date().toISOString();
  const graphId = `graph_${randomUUID()}`;
  const node: TaskNode = {
    id: `node_${randomUUID()}`,
    graphId,
    title: "Legacy run node",
    goal,
    domain,
    status: "ready",
    dependencies: [],
    requiredCapabilities: [],
    riskLevel: "low",
    approvalMode: "auto",
    inputs: { goal },
    artifacts: [],
    memoryRefs: [],
    createdAt: now,
    updatedAt: now,
  };
  const graph: TaskGraph = {
    id: graphId,
    schemaVersion: "1.0",
    workflowId,
    rootGoal: goal,
    status: "ready",
    strategy: "sequential",
    nodes: [node],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  return { graph, node };
}

export function transitionNodeStatus(node: TaskNode, status: TaskNodeStatus): TaskNode {
  return { ...node, status, updatedAt: new Date().toISOString() };
}

export function transitionGraphStatus(graph: TaskGraph, status: TaskGraphStatus): TaskGraph {
  return { ...graph, status, updatedAt: new Date().toISOString() };
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit src/kernel/task-graph.ts 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add src/kernel/task-graph.ts
git commit -m "feat(kernel): TaskGraph types and createSingleNodeGraph"
```

---

### Task 2: Wire into agent-loop.ts

**Files:**
- Modify: `src/agent/agent-loop.ts`

- [ ] **Step 1: Create graph alongside WorkflowRun**

After WorkflowRun creation, add:

```typescript
import { createSingleNodeGraph, transitionNodeStatus, transitionGraphStatus } from "../kernel/task-graph.js";

const { graph: taskGraph, node: taskNode } = createSingleNodeGraph(wfRun.id, task);
const graphMeta = { ...wfMeta, graphId: taskGraph.id, nodeId: taskNode.id };

// Emit graph.created
await ctx.log.append({
  ...session, type: "graph.created", actor: "system",
  payload: { graphId: taskGraph.id, workflowId: wfRun.id, nodeCount: 1 },
  meta: graphMeta,
});

// Emit task.ready
await ctx.log.append({
  ...session, type: "task.ready", actor: "system",
  payload: { nodeId: taskNode.id, graphId: taskGraph.id, goal: task },
  meta: graphMeta,
});
```

- [ ] **Step 2: Emit task.started before runTaskLoop, task.done/failed after**

Before `return await runTaskLoop(...)`, emit `task.started`. After the loop returns, emit `task.done` or `task.failed` and `graph.completed` or `graph.failed`.

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/agent-loop.ts
git commit -m "feat(kernel): single-node TaskGraph with graph.created/task.* events"
```

---

### Task 3: Write tests

**Files:**
- Create: `tests/kernel/task-graph.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSingleNodeGraph, transitionNodeStatus, transitionGraphStatus } from "../../src/kernel/task-graph.js";

describe("TaskGraph", () => {

  it("creates single-node graph with ready status", () => {
    const { graph, node } = createSingleNodeGraph("wf_1", "test task");
    assert.ok(graph.id.startsWith("graph_"));
    assert.ok(node.id.startsWith("node_"));
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, node.id);
    assert.equal(graph.status, "ready");
    assert.equal(node.status, "ready");
  });

  it("transitions node status", () => {
    const { node } = createSingleNodeGraph("wf_1", "test");
    const running = transitionNodeStatus(node, "running");
    assert.equal(running.status, "running");
  });

  it("transitions graph status", () => {
    const { graph } = createSingleNodeGraph("wf_1", "test");
    const done = transitionGraphStatus(graph, "completed");
    assert.equal(done.status, "completed");
  });

  it("generates unique graph IDs", () => {
    const { graph: g1 } = createSingleNodeGraph("wf_1", "a");
    const { graph: g2 } = createSingleNodeGraph("wf_1", "b");
    assert.notEqual(g1.id, g2.id);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/kernel/task-graph.test.js 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/task-graph.test.ts
git commit -m "test(kernel): TaskGraph creation and transition tests"
```
