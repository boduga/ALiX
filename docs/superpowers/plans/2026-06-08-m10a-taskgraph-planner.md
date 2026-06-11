# M0.10-A: TaskGraph Planner — Dry-Run Only

**Status:** ✅ Completed (M0.10) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a user task, ALiX generates a valid multi-node TaskGraph without executing any tools.

**Architecture:** A `GraphPlanner` class that calls the configured fast model with a planning prompt, parses the JSON response into a `TaskGraph`, validates it against the JSON schema, persists it to `.alix/graphs/<graphId>.json`, and emits `graph.created` + `task.ready` events. The planner never calls tools — it's a pure LLM + validation pipeline.

**Tech Stack:** TypeScript, node:test, Ollama API, JSON Schema validation.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/graph-planner.ts` | **Create** | `GraphPlanner` class — calls model, parses, validates, persists |
| `src/cli.ts` | **Modify** | Add `alix graph plan "<task>"` command handler |
| `.alix/graphs/` | **Create dir** | Graph artifact storage |
| `tests/kernel/graph-planner.test.ts` | **Create** | Tests for planner logic |

---

### Task 1: Create GraphPlanner module

**Files:**
- Create: `src/kernel/graph-planner.ts`

- [ ] **Step 1: Write GraphPlanner**

```typescript
/**
 * graph-planner.ts — TaskGraph planner (dry-run only).
 *
 * Calls the configured fast model with a planning prompt, parses the
 * response into a multi-node TaskGraph, validates it, and persists
 * it to disk. NO tools are executed.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { TaskGraph, TaskNode, GraphStrategy } from "./task-graph.js";

export interface PlannerResult {
  graph: TaskGraph;
  rawModelOutput: string;
  valid: boolean;
  errors: string[];
}

const DEFAULT_PLAN_PROMPT = `You are a software architecture planner. Given a user task, decompose it into a TaskGraph with 3-6 nodes.

Each node represents one atomic step. Nodes can be:
- sequential (must complete before next starts)
- parallel (can run simultaneously)
- critic (reviews and validates output)

Return ONLY valid JSON matching this schema:
{
  "graph": {
    "strategy": "sequential" | "parallel" | "map_reduce" | "critic_loop" | "hybrid",
    "nodes": [
      {
        "id": "node_1",
        "title": "short title",
        "goal": "what this node does",
        "domain": "coding | research | infra | docs | business",
        "dependencies": [],
        "riskLevel": "low | medium | high",
        "approvalMode": "auto | ask | deny",
        "requiredCapabilities": ["filesystem.read", "web.search", ...]
      }
    ]
  }
}

Task:`;

/** Validate a parsed TaskGraph structure. */
function validateGraph(json: unknown): string[] {
  const errors: string[] = [];
  if (!json || typeof json !== "object") { errors.push("Response is not an object"); return errors; }
  const obj = json as Record<string, unknown>;
  if (!obj.graph || typeof obj.graph !== "object") { errors.push("Missing 'graph' key"); return errors; }
  const graph = obj.graph as Record<string, unknown>;
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 2) { errors.push("Graph must have 2+ nodes"); }
  if (!graph.strategy) { errors.push("Missing strategy"); }
  const validStrategies = ["sequential", "parallel", "map_reduce", "critic_loop", "hybrid"];
  if (graph.strategy && !validStrategies.includes(graph.strategy as string)) {
    errors.push(`Invalid strategy: ${graph.strategy}`);
  }
  for (let i = 0; i < (graph.nodes as unknown[])?.length ?? 0; i++) {
    const n = (graph.nodes as Record<string, unknown>[])[i];
    if (!n.id) errors.push(`Node ${i}: missing id`);
    if (!n.title) errors.push(`Node ${i}: missing title`);
    if (!n.goal) errors.push(`Node ${i}: missing goal`);
  }
  return errors;
}

/** Create a fallback sequential graph when the model fails. */
function createFallbackGraph(goal: string, workflowId: string): TaskGraph {
  const now = new Date().toISOString();
  const graphId = `graph_${randomUUID()}`;
  const node: TaskNode = {
    id: `node_${randomUUID()}`,
    graphId, title: "Execute task", goal, domain: "legacy",
    status: "ready", dependencies: [], requiredCapabilities: [],
    riskLevel: "low", approvalMode: "auto", inputs: { goal }, artifacts: [], memoryRefs: [],
    createdAt: now, updatedAt: now,
  };
  return {
    id: graphId, schemaVersion: "1.0", workflowId, rootGoal: goal,
    status: "draft", strategy: "sequential", nodes: [node], edges: [],
    createdAt: now, updatedAt: now,
  };
}

export class GraphPlanner {
  private modelEndpoint: string;
  private modelName: string;

  constructor(opts?: { modelEndpoint?: string; modelName?: string }) {
    this.modelEndpoint = opts?.modelEndpoint ?? "http://localhost:11434/api/generate";
    this.modelName = opts?.modelName ?? "qwen3:4b";
  }

  async plan(goal: string, workflowId: string): Promise<PlannerResult> {
    const prompt = DEFAULT_PLAN_PROMPT + `\n${goal}`;

    let rawModelOutput = "";
    try {
      const response = await fetch(this.modelEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          prompt,
          stream: false,
          format: "json",
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json() as Record<string, unknown>;
      rawModelOutput = (data.response || data.thinking || "") as string;
    } catch (err) {
      return {
        graph: createFallbackGraph(goal, workflowId),
        rawModelOutput: String(err),
        valid: false,
        errors: [`Model call failed: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    // Parse model output
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawModelOutput);
    } catch {
      return {
        graph: createFallbackGraph(goal, workflowId),
        rawModelOutput,
        valid: false,
        errors: ["Invalid JSON from model"],
      };
    }

    // Validate
    const errors = validateGraph(parsed);
    if (errors.length > 0) {
      return {
        graph: createFallbackGraph(goal, workflowId),
        rawModelOutput,
        valid: false,
        errors,
      };
    }

    // Build TaskGraph from parsed model output
    const modelGraph = (parsed as Record<string, unknown>).graph as Record<string, unknown>;
    const now = new Date().toISOString();
    const graphId = `graph_${randomUUID()}`;
    const modelNodes = modelGraph.nodes as Record<string, unknown>[];

    const nodes: TaskNode[] = modelNodes.map((n, i) => ({
      id: (n.id as string) || `node_${graphId}_${i}`,
      graphId,
      title: n.title as string,
      goal: n.goal as string,
      domain: (n.domain as string) || "unknown",
      status: "pending" as const,
      dependencies: (n.dependencies as string[]) || [],
      requiredCapabilities: (n.requiredCapabilities as string[]) || [],
      riskLevel: (n.riskLevel as TaskNode["riskLevel"]) || "low",
      approvalMode: (n.approvalMode as TaskNode["approvalMode"]) || "auto",
      inputs: { goal },
      artifacts: [],
      memoryRefs: [],
      createdAt: now,
      updatedAt: now,
    }));

    // Build edges from dependency declarations
    const edges: TaskGraph["edges"] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (const dep of nodes[i].dependencies) {
        const depNode = nodes.find(n => n.id === dep);
        if (depNode) {
          edges.push({
            id: `edge_${graphId}_${i}`,
            graphId,
            from: depNode.id,
            to: nodes[i].id,
            type: "requires",
          });
        }
      }
    }

    const graph: TaskGraph = {
      id: graphId,
      schemaVersion: "1.0",
      workflowId,
      rootGoal: goal,
      status: "draft",
      strategy: modelGraph.strategy as GraphStrategy,
      nodes,
      edges,
      createdAt: now,
      updatedAt: now,
    };

    return { graph, rawModelOutput, valid: true, errors: [] };
  }
}

/** Persist a TaskGraph to `.alix/graphs/<graphId>.json`. */
export async function persistGraph(graph: TaskGraph, cwd: string): Promise<string> {
  const dir = join(cwd, ".alix", "graphs");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${graph.id}.json`);
  await writeFile(filePath, JSON.stringify(graph, null, 2), "utf-8");
  return filePath;
}

/** Validate a TaskGraph against the JSON schema. */
export function validateGraphSchema(graph: TaskGraph): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!graph.id) errors.push("Missing id");
  if (graph.schemaVersion !== "1.0") errors.push(`Invalid schemaVersion: ${graph.schemaVersion}`);
  if (!graph.workflowId) errors.push("Missing workflowId");
  if (!graph.rootGoal) errors.push("Missing rootGoal");
  if (!["draft", "ready", "running", "completed", "failed", "cancelled"].includes(graph.status)) {
    errors.push(`Invalid status: ${graph.status}`);
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 1) errors.push("Must have at least 1 node");
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/graph-planner.ts
git commit -m "feat(graph): add GraphPlanner dry-run planner"
```

---

### Task 2: Wire `alix graph plan` CLI command

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add graph command handler**

Add before the `alix config` block:

```typescript
// --- alix graph --- TaskGraph management ---
if (command === "graph" && args[0] === "plan") {
  const task = args.slice(1).join(" ");
  if (!task) {
    console.error("Usage: alix graph plan \"<task>\"");
    process.exit(1);
  }
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const sessionId = `plan_${Date.now()}`;
  const { GraphPlanner, persistGraph, validateGraphSchema } = await import("./kernel/graph-planner.js");
  const { createWorkflowRun } = await import("./kernel/workflow-run.js");
  const { EventLog } = await import("./events/event-log.js");

  // Create a minimal workflow run for planning
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const planLog = new EventLog(sessionDir);
  await planLog.init();

  const wfRun = createWorkflowRun(sessionId, task);
  const planner = new GraphPlanner({
    modelName: config.model.name,
    modelEndpoint: config.model.provider === "ollama"
      ? "http://localhost:11434/api/generate"
      : undefined,
  });

  console.log(`Planning: ${task}`);
  console.log();

  const result = await planner.plan(task, wfRun.id);

  // Persist graph
  const filePath = await persistGraph(result.graph, cwd);
  console.log(`Graph:      ${result.graph.id}`);
  console.log(`Strategy:   ${result.graph.strategy}`);
  console.log(`Nodes:      ${result.graph.nodes.length}`);
  console.log(`Edges:      ${result.graph.edges.length}`);
  console.log(`Valid:      ${result.valid ? "✓" : "✗"}`);
  console.log(`Saved:      ${filePath}`);
  console.log();

  // Emit graph.created and task.ready events
  for (const node of result.graph.nodes) {
    await planLog.append({
      sessionId, actor: "system", type: "task.ready",
      payload: { nodeId: node.id, graphId: result.graph.id, goal: node.goal },
      meta: { workflowId: wfRun.id, graphId: result.graph.id },
    });
  }
  await planLog.append({
    sessionId, actor: "system", type: "graph.created",
    payload: { graphId: result.graph.id, workflowId: wfRun.id, nodeCount: result.graph.nodes.length },
    meta: { workflowId: wfRun.id },
  });

  // Validate against schema
  const schemaCheck = validateGraphSchema(result.graph);
  if (!schemaCheck.valid) {
    console.log("Schema validation errors:");
    for (const err of schemaCheck.errors) console.log(`  - ${err}`);
  }

  // Show nodes
  console.log();
  console.log("Nodes:");
  for (const node of result.graph.nodes) {
    const deps = node.dependencies.length > 0 ? ` (after: ${node.dependencies.join(", ")})` : "";
    console.log(`  ${node.id}: ${node.title}${deps}`);
  }

  if (!result.valid) {
    console.log();
    console.log("Errors:");
    for (const err of result.errors) console.log(`  - ${err}`);
    console.log("Used fallback single-node graph.");
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
git commit -m "feat(cli): add alix graph plan command"
```

---

### Task 3: Write tests

**Files:**
- Create: `tests/kernel/graph-planner.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateGraphSchema, createFallbackGraph } from "../../src/kernel/graph-planner.js";
import type { TaskGraph } from "../../src/kernel/task-graph.js";

describe("GraphPlanner", () => {

  it("validateGraphSchema accepts a valid graph", () => {
    const graph: TaskGraph = {
      id: "graph_test_1",
      schemaVersion: "1.0",
      workflowId: "wf_1",
      rootGoal: "test task",
      status: "draft",
      strategy: "sequential",
      nodes: [{
        id: "node_1", graphId: "graph_test_1", title: "Do thing", goal: "test",
        domain: "coding", status: "pending", dependencies: [],
        requiredCapabilities: [], riskLevel: "low", approvalMode: "auto",
        inputs: {}, artifacts: [], memoryRefs: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = validateGraphSchema(graph);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("validateGraphSchema rejects missing id", () => {
    const graph = { schemaVersion: "1.0", workflowId: "wf_1", rootGoal: "test", status: "draft", strategy: "sequential", nodes: [], edges: [], createdAt: "", updatedAt: "" } as TaskGraph;
    const result = validateGraphSchema(graph);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("id")));
  });

  it("validateGraphSchema rejects invalid status", () => {
    const graph = { id: "g1", schemaVersion: "1.0", workflowId: "wf_1", rootGoal: "test", status: "invalid_status", strategy: "sequential", nodes: [{ id: "n1", graphId: "g1", title: "x", goal: "x", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" }], edges: [], createdAt: "", updatedAt: "" } as TaskGraph;
    const result = validateGraphSchema(graph);
    assert.equal(result.valid, false);
  });

  it("fallback graph has one node and sequential strategy", () => {
    const graph = createFallbackGraph("test goal", "wf_fallback");
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.strategy, "sequential");
    assert.equal(graph.rootGoal, "test goal");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/kernel/graph-planner.test.js 2>&1
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/graph-planner.test.ts
git commit -m "test(graph): graph planner validation and fallback tests"
```
