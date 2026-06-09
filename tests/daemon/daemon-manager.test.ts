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
});
