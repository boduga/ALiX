import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { buildGraphProjection } from "../../src/kernel/graph-projection.js";

describe("GraphProjection", () => {
  let tmpDir: string;
  const graphId = `graph_${randomUUID()}`;
  const sessionId = `session_${randomUUID()}`;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "graph-proj-test-"));

    // Write graph file
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });
    writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
      id: graphId, schemaVersion: "1.0",
      workflowId: "wf_test", rootGoal: "test research task",
      status: "completed", strategy: "sequential",
      nodes: [
        { id: "search", graphId, title: "Search sources", goal: "search", domain: "research",
          status: "done", dependencies: [], requiredCapabilities: ["web.search"],
          riskLevel: "low", approvalMode: "auto", inputs: {},
          artifacts: [], memoryRefs: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" },
        { id: "synthesize", graphId, title: "Synthesize", goal: "synthesize", domain: "research",
          status: "done", dependencies: ["search"], requiredCapabilities: [],
          riskLevel: "low", approvalMode: "auto", inputs: {},
          artifacts: [], memoryRefs: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      ],
      edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));

    // Write session events
    const sessionDir = join(tmpDir, ".alix", "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const timestamp = "2026-06-08T12:00:00.000Z";
    const lines = [
      `{"id":"1","sessionId":"${sessionId}","type":"graph.created","meta":{"graphId":"${graphId}"},"timestamp":"${timestamp}","actor":"system","payload":{"graphId":"${graphId}"}}`,
      `{"id":"2","sessionId":"${sessionId}","type":"task.started","meta":{"graphId":"${graphId}","nodeId":"search"},"timestamp":"${timestamp}","actor":"system","payload":{"nodeId":"search"}}`,
      `{"id":"3","sessionId":"${sessionId}","type":"task.done","meta":{"graphId":"${graphId}","nodeId":"search"},"timestamp":"${timestamp}","actor":"system","payload":{"nodeId":"search","summary":"found sources"}}`,
      `{"id":"4","sessionId":"${sessionId}","type":"task.started","meta":{"graphId":"${graphId}","nodeId":"synthesize"},"timestamp":"${timestamp}","actor":"system","payload":{"nodeId":"synthesize"}}`,
      `{"id":"5","sessionId":"${sessionId}","type":"task.done","meta":{"graphId":"${graphId}","nodeId":"synthesize"},"timestamp":"${timestamp}","actor":"system","payload":{"nodeId":"synthesize","summary":"wrote report"}}`,
    ].join("\n");
    writeFileSync(join(sessionDir, "events.jsonl"), lines);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds projection with correct graphId and rootGoal", async () => {
    const p = await buildGraphProjection(graphId, tmpDir);
    assert.equal(p.graphId, graphId);
    assert.equal(p.rootGoal, "test research task");
    assert.equal(p.nodeCount, 2);
  });

  it("reconstructs node status from events", async () => {
    const p = await buildGraphProjection(graphId, tmpDir);
    const search = p.nodes.find(n => n.nodeId === "search");
    assert.ok(search, "search node should exist");
    assert.equal(search?.status, "done");
    assert.equal(search?.summary, "found sources");

    const syn = p.nodes.find(n => n.nodeId === "synthesize");
    assert.ok(syn, "synthesize node should exist");
    assert.equal(syn?.status, "done");
  });

  it("detects session IDs that participated in the graph", async () => {
    const p = await buildGraphProjection(graphId, tmpDir);
    assert.ok(p.sessionIds.includes(sessionId), `session ${sessionId} should be in sessionIds`);
  });

  it("computes durationMs from timestamps", async () => {
    const p = await buildGraphProjection(graphId, tmpDir);
    for (const node of p.nodes) {
      assert.equal(typeof node.durationMs, "number");
    }
  });

  it("throws for nonexistent graph", async () => {
    await assert.rejects(
      () => buildGraphProjection("nonexistent_graph", tmpDir),
      /Graph not found/
    );
  });
});
