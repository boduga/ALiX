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

  it("normalizeNode preserves timeoutMs when set", () => {
    const raw = {
      id: "n1", graphId: "g1", title: "Research", goal: "test",
      domain: "research", status: "pending" as const,
      dependencies: [], requiredCapabilities: ["web.search"],
      riskLevel: "low" as const, approvalMode: "auto" as const,
      inputs: {}, artifacts: [], memoryRefs: [],
      timeoutMs: 120000, maxIterations: 3,
      createdAt: "", updatedAt: "",
    };
    const norm = normalizeNode(raw);
    assert.equal(norm.timeoutMs, 120000);
    assert.equal((norm as any).maxIterations, 3);
  });

  it("sortNodesByDependencies handles empty dependencies", () => {
    const nodes: TaskNode[] = [
      { id: "a", graphId: "g1", title: "A", goal: "a", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
    ];
    const sorted = sortNodesByDependencies(nodes);
    assert.equal(sorted.length, 1);
    assert.equal(sorted[0].id, "a");
  });
});
