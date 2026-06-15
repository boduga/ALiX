import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CoordinationPlanner, DOMAIN_SCOPE_MAP } from "../../src/kernel/coordination-planner.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";
import type { TaskGraphPlanner } from "../../src/kernel/coordination-planner.js";
import type { TaskGraph, TaskNode } from "../../src/kernel/task-graph.js";
import type { ToolRegistry } from "../../src/tools/tool-registry.js";

function makeNode(id: string, dependencies: string[] = [], overrides: Partial<TaskNode> = {}): TaskNode {
  const now = new Date().toISOString();
  return {
    id, graphId: "test", title: `Node ${id}`, goal: `Do ${id}`,
    domain: "coding", status: "pending", dependencies,
    requiredCapabilities: ["file.create"],
    riskLevel: "low", approvalMode: "auto",
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
  return {
    plan: async () => ({ graph, rawModelOutput: JSON.stringify(graph), valid, errors }),
  };
}

describe("CoordinationPlanner", () => {
  let cwd: string;
  let store: CoordinationStore;
  let registry: ToolRegistry;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coordination-planner-"));
    store = new CoordinationStore(cwd);
    registry = buildDefaultToolIndex().registry;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates workers from a valid graph", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a"), makeNode("b", ["a"])])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, true);
    assert.equal(result.run!.workers.length, 2);
  });

  it("round-robins the configured agent pool", async () => {
    const planner = new CoordinationPlanner(cwd, { agentPool: ["agent-a", "agent-b"] }, { store, planner: makeMockPlanner(makeGraph([makeNode("x"), makeNode("y"), makeNode("z")])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers.map(w => w.agentId), ["agent-a", "agent-b", "agent-a"]);
  });

  it("falls back to coordinator when pool is empty", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.run!.workers[0].agentId, "coordinator");
  });

  it("blocks invalid planner result", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")]), false, ["model failed"]), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.status, "blocked");
    assert.equal(result.run!.workers[0].status, "blocked");
  });

  it("blocks a cyclic graph", async () => {
    const graph = makeGraph([makeNode("a", ["b"]), makeNode("b", ["a"])]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.status, "blocked");
  });

  it("blocks a planner exception", async () => {
    const throwingPlanner: TaskGraphPlanner = { plan: async () => { throw new Error("timeout"); } };
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: throwingPlanner, toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("timeout")));
  });

  it("assigns ownership scopes by domain", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("coding-node", [], { domain: "coding" }),
      makeNode("docs-node", [], { domain: "docs" }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers[0].ownershipScopes, DOMAIN_SCOPE_MAP.coding);
    assert.deepEqual(result.run!.workers[1].ownershipScopes, DOMAIN_SCOPE_MAP.docs);
  });

  it("assigns no scopes to confirmed read-only tasks", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("read", [], { requiredCapabilities: ["file.read"] }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers[0].ownershipScopes, []);
  });

  it("links a relative persisted graph reference", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.ok(result.run!.taskGraphId);
    assert.ok(result.run!.taskGraphRef);
    assert.equal(result.run!.taskGraphRef!.startsWith("/"), false);
    assert.ok(existsSync(join(cwd, result.run!.taskGraphRef!)));
  });

  it("persists the coordination run for reload", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    const loaded = await store.load(result.run!.id);
    assert.ok(loaded);
    assert.equal(loaded.id, result.run!.id);
  });

  it("keeps valid decomposition in planning status", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a"), makeNode("b", ["a"])])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, true);
    assert.equal(result.run!.status, "planning");
  });

  it("remaps node dependencies to worker IDs", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("research"), makeNode("write", ["research"]), makeNode("verify", ["write"]),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    const workers = result.run!.workers;
    assert.deepEqual(workers[1].dependencies, [workers[0].id]);
    assert.deepEqual(workers[2].dependencies, [workers[1].id]);
  });

  it("uses workspace-wide scope for unknown-write", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("unknown", [], { domain: "unknown", requiredCapabilities: ["custom.tool"] }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers[0].ownershipScopes, ["**"]);
  });

  it("unknown-write overrides known domain scope", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("unknown", [], { domain: "coding", requiredCapabilities: ["custom.tool"] }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers[0].ownershipScopes, ["**"]);
  });

  it("does not persist unsafe graph IDs", async () => {
    const graph = { ...makeGraph([makeNode("a")]), id: "../../outside" };
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph, false, ["invalid output"]), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.taskGraphRef, undefined);
    assert.ok(result.errors.some(e => e.includes("Unsafe graph ID")));
  });

  it("persists invalid planner graph when structurally safe", async () => {
    const graph = makeGraph([makeNode("a")]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph, false, ["model failed"]), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.run!.taskGraphId, graph.id);
    assert.ok(result.run!.taskGraphRef);
    assert.ok(existsSync(join(cwd, result.run!.taskGraphRef!)));
  });

  it("persists cyclic graphs with safe IDs for diagnosis", async () => {
    const graph = makeGraph([makeNode("a", ["b"]), makeNode("b", ["a"])]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.taskGraphId, graph.id);
    assert.ok(result.run!.taskGraphRef);
  });

  it("blocks malformed graph data without throwing", async () => {
    const malformedPlanner = { plan: async () => ({
      graph: { id: "graph-safe", nodes: undefined },
      rawModelOutput: "{}", valid: true, errors: [],
    }) } as unknown as TaskGraphPlanner;
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: malformedPlanner, toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.status, "blocked");
    assert.ok(result.errors.some(e => e.includes("nodes must be an array")));
  });

  it("blocks planner returning null", async () => {
    const malformedPlanner = { plan: async () => null } as unknown as TaskGraphPlanner;
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: malformedPlanner, toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("malformed result")));
  });

  it("blocks planner result missing graph", async () => {
    const malformedPlanner = { plan: async () => ({
      rawModelOutput: "", valid: false, errors: [],
    }) } as unknown as TaskGraphPlanner;
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: malformedPlanner, toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.status, "blocked");
  });
});
