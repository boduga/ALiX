import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResearchDeepReportGraph } from "../../src/sop/research-deep-report.js";

describe("research.deep_report", () => {

  it("builds a 6-node sequential graph", () => {
    const { graph } = buildResearchDeepReportGraph("test topic", "report_1");
    assert.equal(graph.nodes.length, 6);
    assert.equal(graph.strategy, "sequential");
  });

  it("nodes are in correct dependency order", () => {
    const { graph } = buildResearchDeepReportGraph("test", "report_2");
    const nodeIds = graph.nodes.map(n => n.id);
    assert.equal(nodeIds[0], "scope_topic");
    assert.equal(nodeIds[1], "search_sources");
    assert.equal(nodeIds[2], "extract_claims");
    assert.equal(nodeIds[3], "synthesize");
    assert.equal(nodeIds[4], "critic_review");
    assert.equal(nodeIds[5], "write_artifacts");
  });

  it("every node has a non-empty goal referencing the topic", () => {
    const { graph } = buildResearchDeepReportGraph("vector databases", "report_3");
    for (const node of graph.nodes) {
      assert.ok(node.goal.length > 10, `Node ${node.id} goal should be meaningful`);
    }
  });

  it("creates edges between consecutive nodes", () => {
    const { graph } = buildResearchDeepReportGraph("test", "report_4");
    assert.equal(graph.edges.length, 5);
    assert.equal(graph.edges[0].from, "scope_topic");
    assert.equal(graph.edges[0].to, "search_sources");
    assert.equal(graph.edges[4].from, "critic_review");
    assert.equal(graph.edges[4].to, "write_artifacts");
  });

  it("report path is under .alix/reports/", () => {
    const { reportDir } = buildResearchDeepReportGraph("test", "report_5");
    assert.ok(reportDir.startsWith(".alix/reports/"));
  });

  it("research nodes have executionProfile set", () => {
    const { graph } = buildResearchDeepReportGraph("test", "report_profile");
    for (const node of graph.nodes) {
      assert.equal((node as any).executionProfile, "research",
        `Node ${node.id} should have executionProfile: "research"`);
    }
  });

  it("research nodes do not have filesystem.read capability", () => {
    const { graph } = buildResearchDeepReportGraph("test", "report_caps");
    for (const node of graph.nodes) {
      if (node.id !== "write_artifacts") {
        assert.ok(!node.requiredCapabilities.includes("filesystem.read"),
          `Node ${node.id} should not require filesystem.read`);
      }
    }
  });

  it("node goals instruct web-only tool use", () => {
    const { graph } = buildResearchDeepReportGraph("test", "report_goals");
    for (const node of graph.nodes) {
      if (node.id === "write_artifacts") {
        assert.ok(node.goal.includes(".alix/reports/"),
          `Node ${node.id} goal should reference .alix/reports/`);
      } else {
        assert.ok(node.goal.includes("web_search") || node.goal.includes("ONLY"),
          `Node ${node.id} goal should restrict to web-only tools`);
      }
    }
  });
});
