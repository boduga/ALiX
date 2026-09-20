import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  handleStateQuery,
  STATE_QUERY_KINDS,
  type StateQueryDeps,
} from "../../src/tools/state-query.js";
import type { DaemonTaskRecord } from "../../src/daemon/task-registry.js";
import type { ScheduledTaskRecord } from "../../src/schedule/scheduled-task-store.js";
import type { UnifiedAuditRow } from "../../src/audit/audit-read-model.js";

describe("state.query", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "state-query-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("exposes the documented kinds", () => {
    assert.deepEqual(
      [...STATE_QUERY_KINDS],
      ["sessions", "audit", "approvals", "daemon", "schedule", "graphs"],
    );
  });

  it("rejects a missing or unknown kind", async () => {
    const missing = await handleStateQuery(cwd, {});
    assert.equal(missing.kind, "error");
    assert.match(missing.message ?? "", /requires kind/);

    const unknown = await handleStateQuery(cwd, { kind: "nope" });
    assert.equal(unknown.kind, "error");
  });

  it("lists sessions with the last event type", async () => {
    const dir = join(cwd, ".alix", "sessions", "sess-1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "events.jsonl"),
      `${JSON.stringify({ type: "session.start", timestamp: "2026-01-01T00:00:00.000Z" })}\n` +
        `${JSON.stringify({ type: "turn.complete", timestamp: "2026-01-01T00:01:00.000Z" })}\n`,
    );

    const result = await handleStateQuery(cwd, { kind: "sessions" });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /sess-1/);
    assert.match(result.output ?? "", /turn\.complete/);
  });

  it("lists saved graphs", async () => {
    const dir = join(cwd, ".alix", "graphs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "graph_1.json"),
      JSON.stringify({ status: "completed", rootGoal: "do the thing", nodes: [{}, {}] }),
    );

    const result = await handleStateQuery(cwd, { kind: "graphs" });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /graph_1/);
    assert.match(result.output ?? "", /2 nodes/);
  });

  it("projects audit rows via the injected reader", async () => {
    const row: UnifiedAuditRow = {
      id: "a1",
      timestamp: "2026-01-01T00:00:00.000Z",
      domain: "runtime",
      action: "tool.invoked",
      summary: "shell.run",
    };
    const result = await handleStateQuery(cwd, { kind: "audit" }, { audit: async () => [row] });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /runtime/);
    assert.match(result.output ?? "", /tool\.invoked/);
  });

  it("reports pending approvals", async () => {
    const deps = {
      approvals: {
        load: async () => {},
        listPending: () => [
          {
            id: "ap_1",
            status: "pending",
            riskLevel: "high",
            toolId: "shell.run",
            capabilities: ["shell.exec"],
            reason: "run it",
          },
        ],
      },
    } as unknown as StateQueryDeps;

    const result = await handleStateQuery(cwd, { kind: "approvals" }, deps);
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /ap_1/);
    assert.match(result.output ?? "", /shell\.run/);
  });

  it("reports daemon tasks", async () => {
    const task: DaemonTaskRecord = {
      id: "task_1",
      task: "build it",
      cwd,
      status: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = await handleStateQuery(cwd, { kind: "daemon" }, { daemon: { load: async () => {}, list: () => [task] } });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /task_1/);
    assert.match(result.output ?? "", /build it/);
  });

  it("reports scheduled jobs", async () => {
    const job: ScheduledTaskRecord = {
      id: "sched_1",
      name: "nightly",
      task: "run tests",
      cwd,
      schedule: { kind: "every", minutes: 60 },
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      approvalId: "ap_1",
      expiresAt: "2026-02-01T00:00:00.000Z",
      nextRunAt: "2026-01-01T01:00:00.000Z",
      runCount: 0,
    };
    const result = await handleStateQuery(cwd, { kind: "schedule" }, { schedule: { load: async () => {}, list: () => [job] } });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /nightly/);
    assert.match(result.output ?? "", /active/);
  });

  it("returns empty-state messages for workspace surfaces", async () => {
    for (const kind of ["sessions", "graphs"] as const) {
      const result = await handleStateQuery(cwd, { kind });
      assert.equal(result.kind, "success");
      assert.match(result.output ?? "", /No /);
    }
  });
});
