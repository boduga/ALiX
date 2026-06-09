import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimeIndex } from "../../src/runtime/runtime-index.js";

function seedDir(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "runtime-index-test-"));
  const auditDir = join(tmpDir, ".alix", "audit");
  const approvalsDir = join(tmpDir, ".alix", "approvals");
  const graphsDir = join(tmpDir, ".alix", "graphs");
  mkdirSync(auditDir, { recursive: true });
  mkdirSync(approvalsDir, { recursive: true });
  mkdirSync(graphsDir, { recursive: true });
  return tmpDir;
}

function writeAudit(dir: string, lines: string[]) {
  writeFileSync(join(dir, ".alix", "audit", "audit.jsonl"), lines.join("\n") + "\n");
}

function writeApprovals(dir: string, records: any[]) {
  writeFileSync(join(dir, ".alix", "approvals", "approvals.json"), JSON.stringify(records));
}

function writeGraph(dir: string, graphId: string, graph: any) {
  writeFileSync(join(dir, ".alix", "graphs", `${graphId}.json`), JSON.stringify(graph));
}

function writeRuns(dir: string, graphId: string, runs: any[]) {
  writeFileSync(join(dir, ".alix", "graphs", `${graphId}.runs.json`), JSON.stringify(runs));
}

describe("RuntimeIndex", () => {
  it("returns empty index when no data dirs exist", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "runtime-empty-"));
    try {
      const idx = await buildRuntimeIndex(tmpDir);
      assert.equal(idx.events.length, 0);
      assert.equal(idx.byGraph("x").length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("includes audit records", async () => {
    const dir = seedDir();
    try {
      writeAudit(dir, [
        `{"id":"audit_1","action":"policy.allowed","timestamp":"2026-06-09T12:00:00Z","details":{"capability":"web.search"}}`,
        `{"id":"audit_2","action":"runtime.blocked","timestamp":"2026-06-09T12:01:00Z","details":{"graphId":"g1","nodeId":"n1","reason":"Missing caps"}}`,
      ]);
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events.length, 2);
      assert.equal(idx.byAction("policy.allowed").length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes approval records", async () => {
    const dir = seedDir();
    try {
      writeApprovals(dir, [
        { id: "app_1", status: "pending", createdAt: "2026-06-09T12:00:00Z", reason: "Need approval", capability: "shell.exec", graphId: "g1", nodeId: "n1" },
        { id: "app_2", status: "approved", createdAt: "2026-06-09T12:05:00Z", decidedAt: "2026-06-09T12:06:00Z", reason: "Looks good", capability: "shell.exec" },
      ]);
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events.length, 2);
      const approvals = idx.byApproval("app_1");
      assert.equal(approvals.length, 1);
      assert.equal(approvals[0].action, "approval.created");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes graph and node events", async () => {
    const dir = seedDir();
    try {
      writeGraph(dir, "graph_abc", {
        id: "graph_abc", rootGoal: "Research task", status: "running", strategy: "sequential",
        updatedAt: "2026-06-09T12:00:00Z",
        nodes: [
          { id: "n1", title: "Search", status: "done", requiredCapabilities: ["web.search"] },
          { id: "n2", title: "Synthesize", status: "pending" },
        ],
      });
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events.length, 3); // 1 graph + 2 nodes
      const graphEvents = idx.byGraph("graph_abc");
      assert.equal(graphEvents.length, 3);
      const nodes = graphEvents.filter(e => e.nodeId);
      assert.equal(nodes.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes graph run attempts", async () => {
    const dir = seedDir();
    try {
      writeGraph(dir, "graph_abc", { id: "graph_abc", status: "completed", nodes: [] });
      writeRuns(dir, "graph_abc", [
        { attempt: 1, nodeId: "n1", status: "failed", error: "Timeout", startedAt: "2026-06-09T12:00:00Z" },
        { attempt: 2, nodeId: "n1", status: "done", summary: "Success", startedAt: "2026-06-09T12:05:00Z" },
      ]);
      const idx = await buildRuntimeIndex(dir);
      const runs = idx.byAction("rerun.done");
      assert.equal(runs.length, 1);
      assert.equal(runs[0].nodeId, "n1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sorts events newest first", async () => {
    const dir = seedDir();
    try {
      writeAudit(dir, [
        `{"id":"audit_1","action":"policy.allowed","timestamp":"2026-06-09T12:00:00Z","details":{}}`,
        `{"id":"audit_2","action":"runtime.blocked","timestamp":"2026-06-09T12:05:00Z","details":{}}`,
      ]);
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events[0].id, "audit_2");
      assert.equal(idx.events[1].id, "audit_1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("byAction filters correctly", async () => {
    const dir = seedDir();
    try {
      writeAudit(dir, [
        `{"id":"a1","action":"policy.allowed","timestamp":"2026-06-09T12:00:00Z","details":{}}`,
        `{"id":"a2","action":"policy.denied","timestamp":"2026-06-09T12:01:00Z","details":{}}`,
        `{"id":"a3","action":"policy.allowed","timestamp":"2026-06-09T12:02:00Z","details":{}}`,
      ]);
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.byAction("policy.allowed").length, 2);
      assert.equal(idx.byAction("policy.denied").length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
