import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DaemonManager } from "../../src/daemon/daemon-manager.js";

describe("DaemonManager", () => {
  it("returns null status when no status file exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "daemon-test-"));
    try {
      const mgr = new DaemonManager(tmpDir);
      const status = await mgr.status();
      assert.equal(status, null);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("isRunning returns false when no pid file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "daemon-liveness-"));
    try {
      const mgr = new DaemonManager(tmpDir);
      assert.equal(await mgr.isRunning(), false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads written status file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "daemon-status-"));
    try {
      const mgr = new DaemonManager(tmpDir);
      mkdirSync(join(tmpDir, ".alix"), { recursive: true });
      writeFileSync(join(tmpDir, ".alix", "daemon.json"), JSON.stringify({
        pid: 12345, startedAt: "2026-01-01T00:00:00Z", socketPath: "/tmp/test.sock", status: "running",
      }));
      const status = await mgr.status();
      assert.ok(status);
      assert.equal(status!.pid, 12345);
      assert.equal(status!.status, "running");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("stop does not throw when daemon not running", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "daemon-stop-"));
    try {
      const mgr = new DaemonManager(tmpDir);
      await mgr.stop(); // should not throw
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("start cleans stale state before spawning", async () => {
    // When daemon.json records a running status but the PID is dead,
    // start() should clean up stale state and proceed, not throw
    // "already running".
    const tmpDir = mkdtempSync(join(tmpdir(), "daemon-stale-"));
    try {
      mkdirSync(join(tmpDir, ".alix"), { recursive: true });
      // A PID that is guaranteed not to exist on any machine
      const deadPid = 2_147_483_647;
      writeFileSync(join(tmpDir, ".alix", "daemon.json"), JSON.stringify({
        pid: deadPid, startedAt: "2026-01-01T00:00:00Z",
        socketPath: "/tmp/nonexistent.sock", status: "running",
      }));
      writeFileSync(join(tmpDir, ".alix", "daemon.pid"), String(deadPid));

      const mgr = new DaemonManager(tmpDir);

      // This should NOT throw "Daemon already running"
      // because the recorded PID is dead.
      const result = await mgr.start();

      assert.ok(result.pid > 0, "started with a real PID");
      assert.notEqual(result.pid, deadPid, "PID differs from stale one");
      assert.equal(result.status, "running");

      // Clean up
      await mgr.stop().catch(() => {});
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
