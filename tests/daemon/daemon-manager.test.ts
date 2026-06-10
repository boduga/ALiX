import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DaemonManager } from "../../src/daemon/daemon-manager.js";

describe("DaemonManager", () => {
  let origHome: string | undefined;
  let testHome: string;

  before(() => {
    origHome = process.env.HOME;
    testHome = mkdtempSync(join(tmpdir(), "daemon-mgr-"));
    process.env.HOME = testHome;
  });

  after(() => {
    process.env.HOME = origHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it("returns null status when no status file exists", async () => {
    const mgr = new DaemonManager("/tmp/project");
    const status = await mgr.status();
    assert.equal(status, null);
  });

  it("isRunning returns false when no pid file", async () => {
    const mgr = new DaemonManager("/tmp/project");
    assert.equal(await mgr.isRunning(), false);
  });

  it("reads written status file", async () => {
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    writeFileSync(join(testHome, ".alix", "daemon.json"), JSON.stringify({
      pid: 12345, startedAt: "2026-01-01T00:00:00Z", socketPath: "/tmp/test.sock", status: "running",
    }));
    const mgr = new DaemonManager("/tmp/project");
    const status = await mgr.status();
    assert.ok(status);
    assert.equal(status!.pid, 12345);
    assert.equal(status!.status, "running");
  });

  it("socketPath returns global ~/.alix/alixd.sock", () => {
    const mgr = new DaemonManager("/tmp/project");
    const sp = mgr.socketPath();
    assert.ok(sp.includes(".alix/alixd.sock"), "should contain .alix/alixd.sock");
    assert.ok(sp.startsWith(testHome), "should be under test home dir");
  });

  it("stop does not throw when daemon not running", async () => {
    const mgr = new DaemonManager("/tmp/project");
    await mgr.stop(); // should not throw
  });

  it("start cleans stale state before spawning", async () => {
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    const deadPid = 2_147_483_647;
    writeFileSync(join(testHome, ".alix", "daemon.json"), JSON.stringify({
      pid: deadPid, startedAt: "2026-01-01T00:00:00Z",
      socketPath: "/tmp/nonexistent.sock", status: "running",
    }));
    writeFileSync(join(testHome, ".alix", "daemon.pid"), String(deadPid));

    const mgr = new DaemonManager(testHome);
    const result = await mgr.start();

    assert.ok(result.pid > 0, "started with a real PID");
    assert.notEqual(result.pid, deadPid, "PID differs from stale one");
    assert.equal(result.status, "running");

    await mgr.stop().catch(() => {});
  });
});
