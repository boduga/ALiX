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
    const graph = { schemaVersion: "1.0", workflowId: "wf_1", rootGoal: "test", status: "draft", strategy: "sequential", nodes: [], edges: [], createdAt: "", updatedAt: "" } as unknown as TaskGraph;
    const result = validateGraphSchema(graph);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("id")));
  });

  it("validateGraphSchema rejects invalid status", () => {
    const graph = { id: "g1", schemaVersion: "1.0", workflowId: "wf_1", rootGoal: "test", status: "invalid_status", strategy: "sequential", nodes: [{ id: "n1", graphId: "g1", title: "x", goal: "x", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" }], edges: [], createdAt: "", updatedAt: "" } as unknown as TaskGraph;
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
