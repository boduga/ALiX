# M0.77b — Coordination Planner: Task Decomposition + Dependency DAG

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge the existing `GraphPlanner` (LLM-based task decomposition) into the new `CoordinationRun`/`WorkerAssignment` model from M0.77a, producing a validated dependency DAG with ownership scopes and a persistent reference from the run to its planning evidence.

**Architecture:** A `CoordinationPlanner` class backed by an injectable `TaskGraphPlanner` interface. The planner pipeline is: call injected planner → validate DAG + check `valid` flag → classify mutation via shared `ToolRegistry` metadata → map nodes to `WorkerAssignment`s using canonical constructors → persist both the `TaskGraph` file and `CoordinationRun` (linked). Invalid planning results produce a `blocked` diagnostic run, never an executable one. Pure validators and mock-based tests need no real LLM endpoint.

**Tech Stack:** TypeScript, existing `GraphPlanner`, `TaskGraph`/`TaskNode`, `CoordinationRun`/`CoordinationStore` (M0.77a), `ToolRegistry` (M0.69).

---

## File Structure

### Modify
- `src/kernel/coordination-types.ts` — add `taskGraphId?` and `taskGraphRef?` to `CoordinationRun`; extend `createWorkerAssignment` to accept optional `id`, `status`, `error`

### Create
- `src/kernel/graph-validator.ts` — pure DAG validator (unique IDs, known deps, no cycles, no self-deps)
- `src/kernel/mutation-classifier.ts` — shared mutation classifier using `ToolRegistry` metadata
- `src/kernel/coordination-planner.ts` — `CoordinationPlanner` with injectable planner/store/registry

### Tests (all mock-based, no real LLM calls)
- `tests/kernel/graph-validator.test.ts`
- `tests/kernel/mutation-classifier.test.ts`
- `tests/kernel/coordination-planner.test.ts`

---

## Correction summary (applied against earlier draft)

1. `planResult.valid === false` is now checked before DAG validation — blocked diagnostic run, never executable
2. `classifyCapabilities()` uses `ToolRegistry.getAll()` to search by both `name` and `capabilityId` — no hardcoded mutation list
3. `taskGraphRef` stored relative to cwd (via `path.relative`)
4. `WorkerAssignment` type import present
5. Invalid planning graphs also persisted and linked (enables post-mortem analysis)
6. All workers use canonical `createWorkerAssignment()` — including the blocked diagnostic worker
7. Misleading test name fixed
8. Only `tests/kernel/coordination-planner.test.ts` — no duplicate path
9. Planner exceptions caught — produce blocked diagnostic run

---

### Task 1: Extend coordination-types.ts

**Files:**
- Modify: `src/kernel/coordination-types.ts`

- [ ] **Step 1: Add fields to CoordinationRun interface, extend createWorkerAssignment**

Add to `CoordinationRun`:
```typescript
  /** Reference to the persisted TaskGraph (planning evidence). */
  taskGraphId?: string;

  /** File path to the persisted TaskGraph, relative to cwd. */
  taskGraphRef?: string;
```

Update `createCoordinationRun` to accept the new optional fields.

Extend `createWorkerAssignment` to accept optional `id`, `status`, `error`:
```typescript
export function createWorkerAssignment(opts: {
  id?: string;
  coordinationRunId: string;
  agentId: string;
  taskLabel: string;
  goalPrompt: string;
  dependencies?: string[];
  ownershipScopes?: string[];
  status?: WorkerStatus;
  error?: string;
}): WorkerAssignment {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? `worker_${randomUUID()}`,
    coordinationRunId: opts.coordinationRunId,
    agentId: opts.agentId,
    taskLabel: opts.taskLabel,
    goalPrompt: opts.goalPrompt,
    dependencies: opts.dependencies ?? [],
    ownershipScopes: opts.ownershipScopes ?? [],
    status: opts.status ?? "pending",
    error: opts.error,
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/kernel/coordination-types.ts
git commit -m "feat(coordination): add taskGraphId/taskGraphRef to CoordinationRun; extend createWorkerAssignment with id/status/error"
```

---

### Task 2: GraphValidator (pure DAG validator)

**Files:**
- Create: `src/kernel/graph-validator.ts`
- Create: `tests/kernel/graph-validator.test.ts`

- [ ] **Step 1: Create `src/kernel/graph-validator.ts`**

```typescript
/**
 * graph-validator.ts — Pure DAG validator for TaskGraph dependency topology.
 *
 * Checks run in order, fail-fast:
 *   1. Safe graph/node IDs (prevent path injection via custom planners)
 *   2. Not empty (≥1 node)
 *   3. All node IDs unique
 *   4. No self-dependencies
 *   5. All dependency references exist
 *   6. No cycles (Kahn's algorithm)
 *
 * Returns topological order on success.
 */

import type { TaskGraph } from "./task-graph.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export type DagValidationResult = {
  valid: boolean;
  safeToPersist: boolean;
  errors: string[];
  topologicalOrder: string[];
};

/** Validate that graph and node IDs are safe for file-system use.
 *  Accepts unknown because injected planners are a runtime boundary. */
function validateGraphIdentity(graph: unknown): string[] {
  const errors: string[] = [];
  if (!graph || typeof graph !== "object") {
    errors.push("Graph must be an object");
    return errors;
  }

  const candidate = graph as { id?: unknown; nodes?: unknown };

  if (typeof candidate.id !== "string" || !SAFE_ID.test(candidate.id)) {
    errors.push(`Unsafe graph ID: "${String(candidate.id ?? "")}"`);
  }

  if (!Array.isArray(candidate.nodes)) {
    errors.push("Graph nodes must be an array");
    return errors;
  }

  for (const rawNode of candidate.nodes) {
    if (!rawNode || typeof rawNode !== "object") {
      errors.push("Graph node must be an object");
      continue;
    }
    const node = rawNode as { id?: unknown };
    if (typeof node.id !== "string" || !SAFE_ID.test(node.id)) {
      errors.push(`Unsafe node ID: "${String(node.id ?? "")}"`);
    }
  }

  return errors;
}

export function validateGraphDag(graph: unknown): DagValidationResult {
  const identityErrors = validateGraphIdentity(graph);

  if (identityErrors.length > 0) {
    return { valid: false, safeToPersist: false, errors: identityErrors, topologicalOrder: [] };
  }

  const typedGraph = graph as TaskGraph;
  const errors: string[] = [];
  const nodes = typedGraph.nodes;

  if (nodes.length === 0) {
    return { valid: false, safeToPersist: true, errors: ["Graph must have at least 1 node"], topologicalOrder: [] };
  }

  const ids = new Set<string>();
  const dupes: string[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) dupes.push(node.id);
    ids.add(node.id);
  }
  if (dupes.length > 0) {
    return { valid: false, safeToPersist: true, errors: [`Duplicate node IDs: ${dupes.join(", ")}`], topologicalOrder: [] };
  }

  for (const node of nodes) {
    if (!Array.isArray(node.dependencies)) {
      errors.push(`Node "${node.id}" dependencies must be an array`);
      continue;
    }
    if (node.dependencies.includes(node.id)) {
      errors.push(`Node "${node.id}" depends on itself`);
    }
  }
  if (errors.length > 0) return { valid: false, safeToPersist: true, errors, topologicalOrder: [] };

  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (!ids.has(dep)) {
        errors.push(`Node "${node.id}" references unknown dependency "${dep}"`);
      }
    }
  }
  if (errors.length > 0) return { valid: false, safeToPersist: true, errors, topologicalOrder: [] };

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of nodes) { inDegree.set(node.id, 0); adj.set(node.id, []); }
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      adj.get(dep)!.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }

  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topologicalOrder.push(id);
    for (const neighbor of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (topologicalOrder.length !== nodes.length) {
    const cycleNodes = nodes.filter(n => !topologicalOrder.includes(n.id)).map(n => n.id);
    return { valid: false, safeToPersist: true, errors: [`Cycle detected involving nodes: ${cycleNodes.join(", ")}`], topologicalOrder: [] };
  }

  return { valid: true, safeToPersist: true, errors: [], topologicalOrder };
}
}
```

- [ ] **Step 2: Create `tests/kernel/graph-validator.test.ts`**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateGraphDag } from "../../src/kernel/graph-validator.js";
import type { TaskGraph, TaskNode } from "../../src/kernel/task-graph.js";

function makeNode(id: string, deps: string[] = []): TaskNode {
  const now = new Date().toISOString();
  return {
    id, graphId: "test", title: `Node ${id}`, goal: `Do ${id}`,
    domain: "coding", status: "pending", dependencies: deps,
    requiredCapabilities: [], riskLevel: "low", approvalMode: "auto",
    inputs: {}, artifacts: [], memoryRefs: [],
    createdAt: now, updatedAt: now,
  };
}

function makeGraph(nodes: TaskNode[]): TaskGraph {
  const now = new Date().toISOString();
  return {
    id: "test-graph", schemaVersion: "1.0", workflowId: "wf-test",
    rootGoal: "Test", status: "draft", strategy: "sequential",
    nodes, edges: [], createdAt: now, updatedAt: now,
  };
}

describe("validateGraphDag", () => {
  it("rejects graph ID with path separators", () => {
    const nodes = [makeNode("a")];
    const base = makeGraph(nodes);
    const bad = { ...base, id: "../../outside" };
    const r = validateGraphDag(bad);
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, false);
    assert.ok(r.errors[0].includes("Unsafe"));
  });

  it("rejects node ID containing path separators", () => {
    const r = validateGraphDag(makeGraph([makeNode("../escape")]));
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, false);
    assert.ok(r.errors[0].includes("Unsafe"));
  });

  it("rejects null graph", () => {
    const r = validateGraphDag(null);
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, false);
    assert.ok(r.errors[0].includes("must be an object"));
  });

  it("rejects graph with undefined nodes", () => {
    const r = validateGraphDag({ id: "safe", nodes: undefined });
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, false);
    assert.ok(r.errors[0].includes("must be an array"));
  });

  it("rejects graph with null node entry", () => {
    const r = validateGraphDag(makeGraph([null as any]));
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, false);
    assert.ok(r.errors.some(e => e.includes("must be an object")));
  });

  it("rejects empty graph", () => {
    const r = validateGraphDag(makeGraph([]));
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, true);
    assert.ok(r.errors[0].includes("at least 1 node"));
  });

  it("accepts single node with no dependencies", () => {
    const r = validateGraphDag(makeGraph([makeNode("a")]));
    assert.equal(r.valid, true);
    assert.equal(r.safeToPersist, true);
    assert.deepEqual(r.topologicalOrder, ["a"]);
  });

  it("rejects duplicate node IDs", () => {
    const r = validateGraphDag(makeGraph([makeNode("a"), makeNode("a")]));
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, true);
    assert.ok(r.errors[0].includes("Duplicate"));
  });

  it("rejects self-dependency", () => {
    const r = validateGraphDag(makeGraph([makeNode("a", ["a"])]));
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, true);
    assert.ok(r.errors[0].includes("depends on itself"));
  });

  it("rejects unknown dependency", () => {
    const r = validateGraphDag(makeGraph([makeNode("a", ["nonexistent"])]));
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, true);
    assert.ok(r.errors[0].includes("unknown dependency"));
  });

  it("rejects cycle a→b→c→a", () => {
    const r = validateGraphDag(makeGraph([
      makeNode("a", ["c"]), makeNode("b", ["a"]), makeNode("c", ["b"]),
    ]));
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, true); // safe IDs, just cyclic
    assert.ok(r.errors[0].includes("Cycle"));
  });

  it("accepts linear chain a→b→c", () => {
    const r = validateGraphDag(makeGraph([
      makeNode("a"), makeNode("b", ["a"]), makeNode("c", ["b"]),
    ]));
    assert.equal(r.valid, true);
    assert.equal(r.safeToPersist, true);
    assert.deepEqual(r.topologicalOrder, ["a", "b", "c"]);
  });

  it("accepts diamond a→[b,c]→d", () => {
    const r = validateGraphDag(makeGraph([
      makeNode("a"), makeNode("b", ["a"]), makeNode("c", ["a"]), makeNode("d", ["b", "c"]),
    ]));
    assert.equal(r.valid, true);
    assert.equal(r.safeToPersist, true);
    assert.equal(r.topologicalOrder[0], "a");
    assert.equal(r.topologicalOrder[3], "d");
  });

  it("accepts independent nodes", () => {
    const r = validateGraphDag(makeGraph([makeNode("a"), makeNode("b"), makeNode("c")]));
    assert.equal(r.valid, true);
    assert.equal(r.safeToPersist, true);
    assert.equal(r.topologicalOrder.length, 3);
  });

  it("rejects node with non-array dependencies", () => {
    const r = validateGraphDag(makeGraph([makeNode("a", undefined as any)]));
    assert.equal(r.valid, false);
    assert.equal(r.safeToPersist, true);
    assert.ok(r.errors[0].includes("must be an array"));
  });
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build && node --test dist/tests/kernel/graph-validator.test.js
```

Expected: 15 pass, no HTTP calls.

- [ ] **Step 4: Commit**

```bash
git add src/kernel/graph-validator.ts tests/kernel/graph-validator.test.ts
git commit -m "feat(coordination): add pure DAG validator for TaskGraph dependency topology"
```

---

### Task 3: MutationClassifier (shared ToolRegistry-based classification)

**Files:**
- Create: `src/kernel/mutation-classifier.ts`
- Create: `tests/kernel/mutation-classifier.test.ts`

- [ ] **Step 1: Create `src/kernel/mutation-classifier.ts`**

```typescript
/**
 * mutation-classifier.ts — Reusable ToolRegistry-based mutation classification.
 *
 * Consumed by CoordinationPlanner during task decomposition.
 * Can also be adopted by ExecutionAuthorization in a future refactor
 * to eliminate register lookup duplication.
 *
 * A capability is "known-write" if the registry has a tool or capability
 * entry with mutates: true. It is "unknown-write" if the capability
 * is not found in the registry. It is "no-write" only when every
 * capability is found and none mutate.
 */

import type { ToolRegistry } from "../tools/tool-registry.js";

export type MutationClass = "known-write" | "unknown-write" | "no-write";

export function classifyCapabilities(
  capabilities: string[],
  registry: ToolRegistry,
): MutationClass {
  // Absence of capability metadata is uncertainty, not proof of read-only behavior.
  // GraphPlanner can generate nodes with empty requiredCapabilities — don't assume no-write.
  if (capabilities.length === 0) return "unknown-write";

  let foundKnownWrite = false;
  let foundUnknown = false;

  for (const cap of capabilities) {
    const record = registry.getAll().find(
      tool => tool.name === cap || tool.capabilityId === cap,
    );

    if (!record) {
      foundUnknown = true;
      continue;
    }

    if (record.mutates) {
      foundKnownWrite = true;
    }
  }

  if (foundKnownWrite) return "known-write";
  if (foundUnknown) return "unknown-write";
  return "no-write";
}
```

- [ ] **Step 2: Create `tests/kernel/mutation-classifier.test.ts`**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyCapabilities } from "../../src/kernel/mutation-classifier.js";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";

describe("classifyCapabilities", () => {
  const { registry } = buildDefaultToolIndex();

  it("returns unknown-write for empty capabilities (absence of metadata is not read-only)", () => {
    assert.equal(classifyCapabilities([], registry), "unknown-write");
  });

  it("returns known-write for file.create (mutates: true)", () => {
    assert.equal(classifyCapabilities(["file.create"], registry), "known-write");
  });

  it("returns known-write for file.delete (mutates: true)", () => {
    assert.equal(classifyCapabilities(["file.delete"], registry), "known-write");
  });

  it("returns no-write for file.read (mutates: false)", () => {
    assert.equal(classifyCapabilities(["file.read"], registry), "no-write");
  });

  it("returns no-write for dir.search (mutates: false in registry)", () => {
    assert.equal(classifyCapabilities(["dir.search"], registry), "no-write");
  });

  it("returns unknown-write for capabilities not in registry", () => {
    assert.equal(classifyCapabilities(["custom.tool"], registry), "unknown-write");
  });

  it("returns known-write when any capability mutates even if others don't", () => {
    assert.equal(classifyCapabilities(["file.read", "file.create"], registry), "known-write");
  });

  it("matches by capabilityId not just tool name", () => {
    assert.equal(classifyCapabilities(["filesystem.create"], registry), "known-write");
  });

  it("known-write wins over unknown capability", () => {
    assert.equal(classifyCapabilities(["custom.tool", "file.create"], registry), "known-write");
  });

  it("unknown capability makes an otherwise read-only set unknown-write", () => {
    assert.equal(classifyCapabilities(["file.read", "custom.tool"], registry), "unknown-write");
  });
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build && node --test dist/tests/kernel/mutation-classifier.test.js
```

Expected: 10 pass.

- [ ] **Step 4: Commit**

```bash
git add src/kernel/mutation-classifier.ts tests/kernel/mutation-classifier.test.ts
git commit -m "feat(coordination): add shared ToolRegistry-based mutation classifier"
```

---

### Task 4: CoordinationPlanner (injectable interface, shared classifier, safe fallback)

**Files:**
- Create: `src/kernel/coordination-planner.ts`

- [ ] **Step 1: Create `src/kernel/coordination-planner.ts`**

```typescript
/**
 * coordination-planner.ts — Bridge between TaskGraphPlanner (LLM decomposition)
 * and CoordinationRun/WorkerAssignment (multi-agent execution model).
 *
 * Pipeline:
 *   1. Call injected planner.plan() — catch exceptions
 *   2. Check planResult.valid — false → persist blocked diagnostic run
 *   3. Validate DAG — invalid → persist blocked diagnostic run
 *   4. Classify mutation via shared ToolRegistry classifier
 *   5. Map nodes → WorkerAssignments with canonical constructor
 *   6. Persist TaskGraph, link ref → CoordinationRun
 *   7. Persist CoordinationRun
 *
 * Invalid/decomposed runs are always blocked — never executable.
 */

import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { GraphPlanner, persistGraph } from "./graph-planner.js";
import { validateGraphDag } from "./graph-validator.js";
import { classifyCapabilities } from "./mutation-classifier.js";
import { CoordinationStore } from "./coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "./coordination-types.js";
import type { TaskGraph, TaskNode } from "./task-graph.js";
import type { CoordinationRun, WorkerAssignment } from "./coordination-types.js";
import type { MutationClass } from "./mutation-classifier.js";
import { buildDefaultToolIndex, type ToolRegistry } from "../tools/tool-registry.js";

// ─── Injectable interface ──────────────────────────────────────────

export interface TaskGraphPlanner {
  plan(goal: string, workflowId: string): Promise<{
    graph: TaskGraph;
    rawModelOutput: string;
    valid: boolean;
    errors: string[];
  }>;
}

// ─── Ownership scope inference ─────────────────────────────────────

export const DOMAIN_SCOPE_MAP: Record<string, string[]> = {
  coding: ["src/**", "tests/**", "package.json", "package-lock.json"],
  docs: ["docs/**", "README.md", "CHANGELOG.md"],
  infra: [
    ".github/**", "Dockerfile*", "docker-compose*.yml", "docker-compose*.yaml",
    "compose*.yml", "compose*.yaml", "infra/**", "terraform/**", "helm/**",
  ],
  research: ["docs/research/**"],
  business: ["docs/**", "README.md"],
};

export function inferOwnershipScopes(
  node: TaskNode,
  mutationClass: MutationClass,
): string[] {
  if (mutationClass === "no-write") return [];
  if (mutationClass === "unknown-write") return ["**"];
  const domain = (node.domain ?? "").toLowerCase();
  if (domain && DOMAIN_SCOPE_MAP[domain]) return [...DOMAIN_SCOPE_MAP[domain]];
  return ["**"];
}

// ─── Error type ────────────────────────────────────────────────────

/**
 * Thrown when a valid DAG's dependency cannot be remapped to worker IDs.
 * Should be unreachable after validateGraphDag() passes — defends against
 * graph mutation between validation and mapping.
 */
export class CoordinationPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinationPlanValidationError";
  }
}

// ─── Result type ───────────────────────────────────────────────────

export type CoordinationPlanResult = {
  run: CoordinationRun | null;
  graph: TaskGraph | null;
  valid: boolean;
  errors: string[];
};

// ─── Planner ───────────────────────────────────────────────────────

export type PlannerOptions = {
  agentPool?: string[];
  modelEndpoint?: string;
  modelName?: string;
};

export class CoordinationPlanner {
  private planner: TaskGraphPlanner;
  private store: CoordinationStore;
  private agentPool: string[];
  private cwd: string;
  private toolRegistry: ToolRegistry;

  constructor(
    cwd: string,
    opts: PlannerOptions = {},
    deps?: {
      planner?: TaskGraphPlanner;
      store?: CoordinationStore;
      toolRegistry?: ToolRegistry;
    },
  ) {
    this.planner = deps?.planner ?? new GraphPlanner({
      modelEndpoint: opts.modelEndpoint,
      modelName: opts.modelName,
    });
    this.store = deps?.store ?? new CoordinationStore(cwd);
    this.agentPool = opts.agentPool ?? [];
    this.cwd = cwd;
    this.toolRegistry = deps?.toolRegistry ?? buildDefaultToolIndex().registry;
  }

  async plan(
    goal: string,
    coordinatorAgentId: string,
    sessionId: string,
  ): Promise<CoordinationPlanResult> {
    // ── Step 1: Call injected planner (catch exceptions) ──────────
    let planResult: Awaited<ReturnType<TaskGraphPlanner["plan"]>>;
    try {
      planResult = await this.planner.plan(goal, `wf_${randomUUID()}`);
    } catch (error) {
      return this.persistBlockedDiagnostic(goal, coordinatorAgentId, sessionId, null, [
        `Planner threw: ${error instanceof Error ? error.message : String(error)}`,
      ], false);
    }

    // ── Step 2: Validate DAG topology (always — even for invalid plan
    //    results, so unsafe graph IDs are caught before persistence)
    const dagResult = validateGraphDag(planResult.graph);

    // ── Step 3: Combined validity gate ────────────────────────────
    if (!planResult.valid || !dagResult.valid) {
      return this.persistBlockedDiagnostic(
        goal, coordinatorAgentId, sessionId, planResult.graph,
        [...(planResult.errors ?? []), ...dagResult.errors],
        dagResult.safeToPersist,
      );
    }

    // ── Step 4: Persist TaskGraph for evidence ────────────────────
    const absoluteGraphPath = await persistGraph(planResult.graph, this.cwd);
    const taskGraphRef = relative(this.cwd, absoluteGraphPath).replaceAll("\\", "/");

    // ── Step 5: Create CoordinationRun ────────────────────────────
    const run = createCoordinationRun({
      sessionId, rootGoal: goal, coordinatorAgentId,
      taskGraphId: planResult.graph.id, taskGraphRef,
    });

    // ── Step 6: Assign agents (round-robin) ───────────────────────
    const pool = this.agentPool.length > 0 ? this.agentPool : [coordinatorAgentId];

    // ── Step 7: Map nodes → workers ──────────────────────────────
    const nodeToWorkerId = new Map<string, string>();
    const workers: WorkerAssignment[] = [];

    for (const node of planResult.graph.nodes) {
      const workerId = `worker_${randomUUID()}`;
      nodeToWorkerId.set(node.id, workerId);

      const mutationClass = classifyCapabilities(
        node.requiredCapabilities ?? [],
        this.toolRegistry,
      );
      const ownershipScopes = inferOwnershipScopes(node, mutationClass);
      const agentId = pool[workers.length % pool.length];

      workers.push(createWorkerAssignment({
        id: workerId,
        coordinationRunId: run.id,
        agentId,
        taskLabel: node.title,
        goalPrompt: node.goal,
        dependencies: [],
        ownershipScopes,
      }));
    }

    for (let i = 0; i < planResult.graph.nodes.length; i++) {
      const node = planResult.graph.nodes[i];
      for (const depId of node.dependencies) {
        const workerId = nodeToWorkerId.get(depId);
        if (!workerId) {
          throw new CoordinationPlanValidationError(
            `Unknown graph dependency: ${node.id} → ${depId}`,
          );
        }
        workers[i].dependencies.push(workerId);
      }
    }

    // ── Step 8: Persist and return ────────────────────────────────
    // Run stays in "planning" — M0.77c (scheduler) transitions to "running".
    run.workers = workers;
    await this.store.save(run);

    return { run, graph: planResult.graph, valid: true, errors: [] };
  }

  private async persistBlockedDiagnostic(
    goal: string,
    coordinatorAgentId: string,
    sessionId: string,
    graph: TaskGraph | null,
    errors: string[],
    graphSafeToPersist = false,
  ): Promise<CoordinationPlanResult> {
    const diagnosticErrors = [...errors];
    let taskGraphId: string | undefined;
    let taskGraphRef: string | undefined;

    if (graph && graphSafeToPersist) {
      try {
        const absolutePath = await persistGraph(graph, this.cwd);
        taskGraphRef = relative(this.cwd, absolutePath).replaceAll("\\", "/");
        taskGraphId = graph.id;
      } catch (error) {
        diagnosticErrors.push(`Failed to persist planning graph: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const run = createCoordinationRun({
      sessionId, rootGoal: goal, coordinatorAgentId,
      taskGraphId, taskGraphRef,
    });
    run.status = "blocked";

    run.workers.push(createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: coordinatorAgentId,
      taskLabel: "Planner diagnostic — requires review",
      goalPrompt: goal,
      ownershipScopes: ["**"],
      status: "blocked",
      error: `Planner validation failed: ${diagnosticErrors.join("; ")}`,
    }));

    await this.store.save(run);
    return { run, graph, valid: false, errors: diagnosticErrors };
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/coordination-planner.ts
git commit -m "feat(coordination): add CoordinationPlanner with injectable planner, shared classifier, safe fallback"
```

---

### Task 5: Tests (mock-based, no real LLM calls)

**Files:**
- Create: `tests/kernel/coordination-planner.test.ts`

- [ ] **Step 1: Create `tests/kernel/coordination-planner.test.ts`**

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  CoordinationPlanner,
  type TaskGraphPlanner,
  DOMAIN_SCOPE_MAP,
} from "../../src/kernel/coordination-planner.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";
import type { TaskGraph, TaskNode } from "../../src/kernel/task-graph.js";
import type { ToolRegistry } from "../../src/tools/tool-registry.js";

function makeNode(id: string, deps: string[] = [], overrides?: Partial<TaskNode>): TaskNode {
  const now = new Date().toISOString();
  return {
    id, graphId: "test", title: `Node ${id}`, goal: `Do ${id}`,
    domain: "coding", status: "pending", dependencies: deps,
    requiredCapabilities: ["file.create"], riskLevel: "low", approvalMode: "auto",
    inputs: {}, artifacts: [], memoryRefs: [],
    createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function makeGraph(nodes: TaskNode[]): TaskGraph {
  const now = new Date().toISOString();
  return {
    id: `graph_${randomUUID()}`, schemaVersion: "1.0", workflowId: `wf_${randomUUID()}`,
    rootGoal: "Test", status: "draft", strategy: "sequential",
    nodes, edges: [], createdAt: now, updatedAt: now,
  };
}

function makeMockPlanner(graph: TaskGraph, valid = true, errors: string[] = []): TaskGraphPlanner {
  return { plan: async () => ({ graph, rawModelOutput: JSON.stringify(graph), valid, errors }) };
}

describe("CoordinationPlanner", () => {
  let tmpDir: string;
  let store: CoordinationStore;
  let registry: ToolRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coord-plan-"));
    store = new CoordinationStore(tmpDir);
    registry = buildDefaultToolIndex().registry;
  });

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("creates a run with workers from a valid graph", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a"), makeNode("b", ["a"])])), toolRegistry: registry });
    const result = await planner.plan("Test", "c", "s1");
    assert.equal(result.valid, true);
    assert.ok(result.run);
    assert.equal(result.run!.workers.length, 2);
  });

  it("round-robins agentPool", async () => {
    const planner = new CoordinationPlanner(tmpDir, { agentPool: ["a", "b"] }, {
      store, planner: makeMockPlanner(makeGraph([makeNode("x"), makeNode("y"), makeNode("z")])), toolRegistry: registry,
    });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.run!.workers[0].agentId, "a");
    assert.equal(r.run!.workers[1].agentId, "b");
    assert.equal(r.run!.workers[2].agentId, "a");
  });

  it("falls back to coordinator when agentPool empty", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")])), toolRegistry: registry });
    const r = await planner.plan("T", "coord", "s1");
    assert.equal(r.run!.workers[0].agentId, "coord");
  });

  it("produces blocked run when planResult.valid is false", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")]), false, ["model failed"]), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.valid, false);
    assert.equal(r.run!.status, "blocked");
    assert.equal(r.run!.workers[0].status, "blocked");
    assert.ok(r.run!.workers[0].error);
  });

  it("produces blocked run on cycle", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a", ["c"]), makeNode("b", ["a"]), makeNode("c", ["b"])])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.valid, false);
    assert.equal(r.run!.status, "blocked");
  });

  it("produces blocked run on planner exception", async () => {
    const throwing: TaskGraphPlanner = { plan: async () => { throw new Error("timeout"); } };
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: throwing, toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.valid, false);
    assert.equal(r.run!.status, "blocked");
    assert.ok(r.errors[0].includes("timeout"));
  });

  it("assigns ownership scopes per domain", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("c", [], { domain: "coding" }),
      makeNode("d", [], { domain: "docs" }),
    ])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.deepEqual(r.run!.workers[0].ownershipScopes, DOMAIN_SCOPE_MAP.coding);
    assert.deepEqual(r.run!.workers[1].ownershipScopes, DOMAIN_SCOPE_MAP.docs);
  });

  it("assigns empty scopes for read-only tasks", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("r", [], { requiredCapabilities: ["file.read"] }),
    ])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.deepEqual(r.run!.workers[0].ownershipScopes, []);
  });

  it("links taskGraphRef to persisted graph", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.ok(r.run!.taskGraphId);
    assert.ok(r.run!.taskGraphRef);
    assert.match(r.run!.taskGraphRef!, /\.json$/);
    assert.ok(!r.run!.taskGraphRef!.startsWith("/"), "ref should be relative");
  });

  it("persists run for reload", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a"), makeNode("b", ["a"])])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    const loaded = await store.load(r.run!.id);
    assert.ok(loaded);
  });

  it("keeps a valid decomposed run in planning status", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a"), makeNode("b", ["a"])])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.valid, true);
    assert.equal(r.run!.status, "planning");
  });

  it("remaps dependency chain to worker IDs", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("r", [], { domain: "research" }),
      makeNode("w", ["r"], { domain: "docs" }),
      makeNode("v", ["w"], { domain: "docs" }),
    ])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.run!.workers[0].dependencies.length, 0);
    assert.deepEqual(r.run!.workers[1].dependencies, [r.run!.workers[0].id]);
    assert.deepEqual(r.run!.workers[2].dependencies, [r.run!.workers[1].id]);
  });

  it("assigns ** for unknown-write tasks", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("d", [], { domain: "unknown", requiredCapabilities: ["custom.script"] }),
    ])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.deepEqual(r.run!.workers[0].ownershipScopes, ["**"]);
  });

  it("uses ** for unknown-write even when domain is known", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("x", [], { domain: "coding", requiredCapabilities: ["custom.script"] }),
    ])), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.deepEqual(r.run!.workers[0].ownershipScopes, ["**"]);
  });

  it("does not persist an invalid graph with an unsafe ID", async () => {
    const graph = { ...makeGraph([makeNode("a")]), id: "../../outside" };
    const planner = new CoordinationPlanner(tmpDir, {}, {
      store,
      planner: makeMockPlanner(graph, false, ["model output invalid"]),
      toolRegistry: registry,
    });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.valid, false);
    assert.equal(r.run!.status, "blocked");
    assert.equal(r.run!.taskGraphRef, undefined);
    assert.ok(r.errors.some(e => e.includes("Unsafe graph ID")));
  });

  it("persists and links invalid planning graphs with safe IDs", async () => {
    const planner = new CoordinationPlanner(tmpDir, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")]), false, ["model failed"]), toolRegistry: registry });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.valid, false);
    assert.equal(r.run!.taskGraphId, r.graph!.id);
    assert.ok(r.run!.taskGraphRef);
    assert.ok(!r.run!.taskGraphRef!.startsWith("/"));
    assert.ok(existsSync(join(tmpDir, r.run!.taskGraphRef!)), "persisted diagnostic graph should exist");
  });

  it("persists a cyclic graph with safe IDs for diagnosis", async () => {
    const graph = makeGraph([
      makeNode("a", ["b"]),
      makeNode("b", ["a"]),
    ]);
    const planner = new CoordinationPlanner(tmpDir, {}, {
      store, planner: makeMockPlanner(graph, true), toolRegistry: registry,
    });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.valid, false);
    assert.equal(r.run!.status, "blocked");
    assert.equal(r.run!.taskGraphId, graph.id);
    assert.ok(r.run!.taskGraphRef);
    assert.ok(existsSync(join(tmpDir, r.run!.taskGraphRef!)), "cyclic diagnostic graph should exist");
  });

  it("blocks malformed graph data without throwing", async () => {
    const malformedPlanner = {
      plan: async () => ({
        graph: { id: "graph_safe", nodes: undefined },
        rawModelOutput: "{}",
        valid: true,
        errors: [],
      }),
    } as unknown as TaskGraphPlanner;
    const planner = new CoordinationPlanner(tmpDir, {}, {
      store, planner: malformedPlanner, toolRegistry: registry,
    });
    const r = await planner.plan("T", "c", "s1");
    assert.equal(r.valid, false);
    assert.equal(r.run!.status, "blocked");
    assert.ok(r.errors.some(e => e.includes("nodes must be an array")));
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build && node --test dist/tests/kernel/graph-validator.test.js dist/tests/kernel/mutation-classifier.test.js dist/tests/kernel/coordination-planner.test.js
```

Expected: 15 + 10 + 18 = 43 tests, all pass, no HTTP calls.

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/coordination-planner.test.ts
git commit -m "test(coordination): add mock-based unit tests for CoordinationPlanner"
```

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/kernel/graph-validator.test.js` — 15 passing
3. `node --test dist/tests/kernel/mutation-classifier.test.js` — 10 passing
4. `node --test dist/tests/kernel/coordination-planner.test.js` — 18 passing
5. `npm run test:node:ci` — all existing tests still pass
6. `mcp__gitnexus__detect_changes` — show only intended files
7. No test instantiates the real `GraphPlanner`. No test performs fetch/network calls. Every `CoordinationPlanner` test injects a mock `TaskGraphPlanner`.
