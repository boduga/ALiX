import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("TuiRuntimeSnapshot", () => {
  it("returns null when no daemon data exists", async () => {
    const { buildRuntimeSnapshot } = await import("../../src/tui/runtime-snapshot.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "tui-snap-"));
    try {
      const snap = await buildRuntimeSnapshot(tmpDir);
      assert.ok(snap);
      assert.equal(snap.daemonRunning, false);
      assert.equal(snap.pendingApprovalsCount, 0);
      assert.ok(snap.sopsCount >= 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads daemon-tasks.json", async () => {
    const { buildRuntimeSnapshot } = await import("../../src/tui/runtime-snapshot.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "tui-tasks-"));
    try {
      mkdirSync(join(tmpDir, ".alix"), { recursive: true });
      writeFileSync(join(tmpDir, ".alix", "daemon-tasks.json"), JSON.stringify([
        { id: "t1", status: "running", task: "test" },
        { id: "t2", status: "queued", task: "test2" },
        { id: "t3", status: "completed", task: "test3" },
        { id: "t4", status: "failed_orphaned", task: "test4" },
      ]));
      const snap = await buildRuntimeSnapshot(tmpDir);
      assert.ok(snap);
      assert.equal(snap.daemonTasks.running, 1);
      assert.equal(snap.daemonTasks.queued, 1);
      assert.equal(snap.daemonTasks.completed, 1);
      assert.equal(snap.daemonTasks.failed, 1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads daemon status file without crashing", async () => {
    const { buildRuntimeSnapshot } = await import("../../src/tui/runtime-snapshot.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "tui-dstatus-"));
    try {
      mkdirSync(join(tmpDir, ".alix"), { recursive: true });
      writeFileSync(join(tmpDir, ".alix", "daemon.json"), JSON.stringify({
        pid: 99999, status: "running", startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      }));
      const snap = await buildRuntimeSnapshot(tmpDir);
      assert.ok(snap);
      assert.equal(snap.daemonRunning, false); // PID 99999 doesn't exist
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
