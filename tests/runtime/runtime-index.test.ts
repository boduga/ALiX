import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimeIndex } from "../../src/runtime/runtime-index.js";
import { TaskRegistry } from "../../src/daemon/task-registry.js";
import { resolveDaemonTasksPath } from "../../src/daemon/daemon-paths.js";

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

function writeSessionEvent(dir: string, sessionId: string, event: any) {
  const sessionDir = join(dir, ".alix", "sessions", sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "events.jsonl"), JSON.stringify(event) + "\n", { flag: "a" });
}

describe("RuntimeIndex", () => {
  // The daemon_task source reads the global ~/.alix registry — isolate HOME
  // so the suite is hermetic on machines with a real daemon registry.
  // (Individual daemon tests below override HOME further and restore it.)
  let suiteHome: string;
  let suiteOrigHome: string | undefined;
  before(() => {
    suiteOrigHome = process.env.HOME;
    suiteHome = mkdtempSync(join(tmpdir(), "runtime-index-home-"));
    process.env.HOME = suiteHome;
  });
  after(() => {
    process.env.HOME = suiteOrigHome;
    rmSync(suiteHome, { recursive: true, force: true });
  });

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

  it("includes allowlisted session events", async () => {
    const dir = seedDir();
    try {
      writeSessionEvent(dir, "sess_1", { type: "session.started", timestamp: "2026-06-09T12:00:00Z", seq: 1, sessionId: "sess_1", payload: {} });
      writeSessionEvent(dir, "sess_1", { type: "graph.created", timestamp: "2026-06-09T12:01:00Z", seq: 2, sessionId: "sess_1", meta: { graphId: "g1" }, payload: {} });
      writeSessionEvent(dir, "sess_1", { type: "user.message", timestamp: "2026-06-09T12:02:00Z", seq: 3, sessionId: "sess_1", payload: { text: "hi" } }); // should be filtered out
      writeSessionEvent(dir, "sess_1", { type: "tool.completed", timestamp: "2026-06-09T12:03:00Z", seq: 4, sessionId: "sess_1", payload: { toolName: "file.create", status: "success" } });
      const idx = await buildRuntimeIndex(dir);
      // Only 3 of 4 events should appear (user.message filtered)
      assert.equal(idx.events.length, 3);
      assert.equal(idx.bySession("sess_1").length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges session events with other sources", async () => {
    const dir = seedDir();
    try {
      writeAudit(dir, [
        `{"id":"audit_1","action":"policy.allowed","timestamp":"2026-06-09T12:00:00Z","details":{"graphId":"g1"}}`,
      ]);
      writeSessionEvent(dir, "sess_1", { type: "task.done", timestamp: "2026-06-09T12:01:00Z", seq: 1, sessionId: "sess_1", meta: { graphId: "g1" }, payload: { summary: "ok" } });
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events.length, 2);
      assert.equal(idx.byGraph("g1").length, 2);
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

  it("reads daemon tasks from the global registry when cwd != HOME", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "runtime-proj-"));
    const fakeHome = mkdtempSync(join(tmpdir(), "runtime-home-"));
    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      mkdirSync(join(fakeHome, ".alix"), { recursive: true });
      // Writer resolves the global path under the isolated HOME
      const reg = new TaskRegistry();
      await reg.load();
      const rec = reg.create("global task", projectDir);
      // create() persists via fire-and-forget enqueueSave — poll for the file
      const deadline = Date.now() + 5000;
      while (!existsSync(resolveDaemonTasksPath()) && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 25));
      }
      assert.ok(existsSync(resolveDaemonTasksPath()), "writer should persist to the global registry");
      // Reader runs from a project dir that is NOT $HOME
      assert.notEqual(projectDir, fakeHome);
      const idx = await buildRuntimeIndex(projectDir);
      const daemonEvents = idx.events.filter(e => e.source === "daemon_task");
      assert.equal(daemonEvents.length, 1);
      assert.equal(daemonEvents[0].id, rec.id);
      assert.equal(daemonEvents[0].action, "daemon.task.queued");
    } finally {
      process.env.HOME = origHome;
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("falls back to the legacy project-scoped daemon tasks file", async () => {
    const projectDir = seedDir();
    const fakeHome = mkdtempSync(join(tmpdir(), "runtime-home-legacy-"));
    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      // No global registry — only a legacy file under the project dir
      assert.ok(!existsSync(resolveDaemonTasksPath()));
      writeFileSync(
        join(projectDir, ".alix", "daemon-tasks.json"),
        JSON.stringify([{ id: "task_legacy", task: "legacy task", cwd: projectDir, status: "completed", createdAt: "2026-06-09T12:00:00Z", updatedAt: "2026-06-09T12:05:00Z" }]),
      );
      const idx = await buildRuntimeIndex(projectDir);
      const daemonEvents = idx.events.filter(e => e.source === "daemon_task");
      assert.equal(daemonEvents.length, 1);
      assert.equal(daemonEvents[0].id, "task_legacy");
    } finally {
      process.env.HOME = origHome;
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("prefers the global registry over the legacy file when both exist", async () => {
    const projectDir = seedDir();
    const fakeHome = mkdtempSync(join(tmpdir(), "runtime-home-both-"));
    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      mkdirSync(join(fakeHome, ".alix"), { recursive: true });
      writeFileSync(
        resolveDaemonTasksPath(),
        JSON.stringify([{ id: "task_global", task: "global", cwd: projectDir, status: "queued", createdAt: "2026-06-09T12:00:00Z", updatedAt: "2026-06-09T12:00:00Z" }]),
      );
      writeFileSync(
        join(projectDir, ".alix", "daemon-tasks.json"),
        JSON.stringify([{ id: "task_legacy", task: "legacy", cwd: projectDir, status: "completed", createdAt: "2026-06-09T12:00:00Z", updatedAt: "2026-06-09T12:00:00Z" }]),
      );
      const idx = await buildRuntimeIndex(projectDir);
      const daemonEvents = idx.events.filter(e => e.source === "daemon_task");
      assert.equal(daemonEvents.length, 1);
      assert.equal(daemonEvents[0].id, "task_global");
    } finally {
      process.env.HOME = origHome;
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  // #702: a repeated build reuses cached sources until they change.
  it("reuses cached sources on repeat builds and invalidates on change", async () => {
    const dir = seedDir();
    try {
      writeSessionEvent(dir, "sess_cache", {
        type: "task.done", timestamp: "2026-06-09T12:00:00Z", seq: 1, sessionId: "sess_cache", payload: { summary: "first" },
      });
      const first = await buildRuntimeIndex(dir);
      assert.equal(first.bySession("sess_cache").length, 1);

      // Unchanged sources: identical result (served from cache).
      const second = await buildRuntimeIndex(dir);
      assert.deepEqual(second.events, first.events);

      // Changed source: the new event is visible.
      writeSessionEvent(dir, "sess_cache", {
        type: "task.done", timestamp: "2026-06-09T12:01:00Z", seq: 2, sessionId: "sess_cache", payload: { summary: "second" },
      });
      const third = await buildRuntimeIndex(dir);
      assert.equal(third.bySession("sess_cache").length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // #702: per-source caps bound memory — only the newest N events are kept.
  it("caps session events per source to the newest N", async () => {
    const dir = seedDir();
    try {
      const sessionDir = join(dir, ".alix", "sessions", "sess_cap");
      mkdirSync(sessionDir, { recursive: true });
      const lines: string[] = [];
      for (let i = 1; i <= 2_001; i++) {
        lines.push(JSON.stringify({
          type: "task.done", timestamp: `2026-06-09T12:00:${String(i % 60).padStart(2, "0")}Z`,
          seq: i, sessionId: "sess_cap", payload: { n: i },
        }));
      }
      writeFileSync(join(sessionDir, "events.jsonl"), lines.join("\n") + "\n");

      const idx = await buildRuntimeIndex(dir);
      const capped = idx.bySession("sess_cap");
      assert.equal(capped.length, 2_000, "cap should retain exactly 2000");
      // Newest retained: seq 2001 present, seq 1 evicted (id embeds seq).
      const ids = new Set(capped.map((e) => e.id));
      assert.ok(ids.has("sess_sess_cap_2001"));
      assert.ok(!ids.has("sess_sess_cap_1"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
