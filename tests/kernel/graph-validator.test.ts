import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateGraphDag } from "../../src/kernel/graph-validator.js";
import type { TaskGraph, TaskNode } from "../../src/kernel/task-graph.js";

function makeNode(id: string, dependencies: string[] = []): TaskNode {
  const now = new Date().toISOString();
  return {
    id, graphId: "test", title: `Node ${id}`, goal: `Do ${id}`,
    domain: "coding", status: "pending", dependencies,
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
    const graph = { ...makeGraph([makeNode("a")]), id: "../../outside" };
    const result = validateGraphDag(graph);
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, false);
    assert.ok(result.errors.some(error => error.includes("Unsafe graph ID")));
  });

  it("rejects node ID containing path separators", () => {
    const result = validateGraphDag(makeGraph([makeNode("../escape")]));
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, false);
  });

  it("rejects null graph", () => {
    const result = validateGraphDag(null);
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, false);
    assert.ok(result.errors.some(error => error.includes("must be an object")));
  });

  it("rejects graph with undefined nodes", () => {
    const result = validateGraphDag({ id: "safe", nodes: undefined });
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, false);
    assert.ok(result.errors.some(error => error.includes("must be an array")));
  });

  it("rejects graph with null node entry", () => {
    const result = validateGraphDag(makeGraph([null as unknown as TaskNode]));
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, false);
    assert.ok(result.errors.some(error => error.includes("must be an object")));
  });

  it("rejects empty graph", () => {
    const result = validateGraphDag(makeGraph([]));
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, true);
  });

  it("accepts a single independent node", () => {
    const result = validateGraphDag(makeGraph([makeNode("a")]));
    assert.equal(result.valid, true);
    assert.equal(result.safeToPersist, true);
    assert.deepEqual(result.topologicalOrder, ["a"]);
  });

  it("rejects duplicate node IDs", () => {
    const result = validateGraphDag(makeGraph([makeNode("a"), makeNode("a")]));
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, true);
  });

  it("rejects self-dependency", () => {
    const result = validateGraphDag(makeGraph([makeNode("a", ["a"])]));
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, true);
  });

  it("rejects unknown dependency", () => {
    const result = validateGraphDag(makeGraph([makeNode("a", ["missing"])]));
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, true);
  });

  it("rejects a dependency cycle", () => {
    const result = validateGraphDag(makeGraph([
      makeNode("a", ["c"]), makeNode("b", ["a"]), makeNode("c", ["b"]),
    ]));
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, true);
    assert.ok(result.errors.some(error => error.includes("Cycle")));
  });

  it("accepts a linear dependency chain", () => {
    const result = validateGraphDag(makeGraph([
      makeNode("a"), makeNode("b", ["a"]), makeNode("c", ["b"]),
    ]));
    assert.equal(result.valid, true);
    assert.deepEqual(result.topologicalOrder, ["a", "b", "c"]);
  });

  it("accepts a diamond dependency graph", () => {
    const result = validateGraphDag(makeGraph([
      makeNode("a"), makeNode("b", ["a"]), makeNode("c", ["a"]), makeNode("d", ["b", "c"]),
    ]));
    assert.equal(result.valid, true);
    assert.equal(result.topologicalOrder[0], "a");
    assert.equal(result.topologicalOrder.at(-1), "d");
  });

  it("accepts independent nodes", () => {
    const result = validateGraphDag(makeGraph([makeNode("a"), makeNode("b"), makeNode("c")]));
    assert.equal(result.valid, true);
    assert.equal(result.topologicalOrder.length, 3);
  });

  it("rejects non-array dependencies", () => {
    const node = makeNode("a");
    (node as unknown as { dependencies: unknown }).dependencies = undefined;
    const result = validateGraphDag(makeGraph([node]));
    assert.equal(result.valid, false);
    assert.equal(result.safeToPersist, true);
    assert.ok(result.errors.some(error => error.includes("must be an array")));
  });
});
