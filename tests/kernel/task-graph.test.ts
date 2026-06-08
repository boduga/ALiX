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

  it("creates graph with specified domain", () => {
    const { graph, node } = createSingleNodeGraph("wf_1", "test task", "custom-domain");
    assert.equal(node.domain, "custom-domain");
    assert.equal(graph.workflowId, "wf_1");
    assert.equal(graph.rootGoal, "test task");
  });

  it("transition does not mutate original node", () => {
    const { node } = createSingleNodeGraph("wf_1", "test");
    const originalStatus = node.status;
    transitionNodeStatus(node, "running");
    assert.equal(node.status, originalStatus);
  });

  it("transition does not mutate original graph", () => {
    const { graph } = createSingleNodeGraph("wf_1", "test");
    const originalStatus = graph.status;
    transitionGraphStatus(graph, "completed");
    assert.equal(graph.status, originalStatus);
  });
});
