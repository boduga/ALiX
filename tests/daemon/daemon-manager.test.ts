import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { DaemonManager } from "../../src/operations/daemon/daemon-manager.js";

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

  it("a second manager start cannot unlink the live daemon socket", async () => {
    const mgr = new DaemonManager(testHome);
    // Remove the synthetic stale state from earlier tests.
    rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
    const first = await mgr.start();
    const socket = mgr.socketPath();
    const inode = statSync(socket).ino;
    try {
      await assert.rejects(() => mgr.start(), /already running/);
      assert.equal(statSync(socket).ino, inode);
      const reply = await new Promise<string>((resolve, reject) => {
        const conn = createConnection(socket);
        conn.setTimeout(3000);
        conn.once("connect", () => conn.write(JSON.stringify({ command: "ping" }) + "\n"));
        conn.once("data", (data) => { resolve(String(data)); conn.destroy(); });
        conn.once("error", reject);
        conn.once("timeout", () => { conn.destroy(); reject(new Error("ping timed out")); });
      });
      assert.match(reply, /pong/);
    } finally {
      await mgr.stop();
    }
    assert.ok(first.pid > 0);
  });

  it("verifies legacy daemon identity against its live command line", async () => {
    const mgr = new DaemonManager(testHome);
    rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
    const running = await mgr.start();
    try {
      assert.equal(await mgr["legacyOwnerMatches"](running.pid, mgr.socketPath()), true);
      assert.equal(await mgr["legacyOwnerMatches"](running.pid, "/tmp/other.sock"), false);
      assert.equal(await mgr["legacyOwnerMatches"](process.pid, mgr.socketPath()), false);
    } finally { await mgr.stop(); }
  });

  it("never falls back when the socket explicitly reports another PID", async () => {
    const mgr = new DaemonManager(testHome);
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    writeFileSync(join(testHome, ".alix", "daemon.json"), JSON.stringify({ pid: process.pid, status: "running" }));
    const originalPong = mgr["socketPong"];
    const originalLegacy = mgr["legacyOwnerMatches"];
    let legacyCalled = false;
    mgr["socketPong"] = async () => ({ received: true, pid: process.pid + 1 });
    mgr["legacyOwnerMatches"] = async () => { legacyCalled = true; return true; };
    try {
      await assert.rejects(() => mgr.stop(), /ownership could not be verified/);
      assert.equal(legacyCalled, false);
    } finally {
      mgr["socketPong"] = originalPong;
      mgr["legacyOwnerMatches"] = originalLegacy;
      rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
    }
  });

  it("uses legacy verification only for a PID-less pong", async () => {
    const mgr = new DaemonManager(testHome);
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    writeFileSync(join(testHome, ".alix", "daemon.json"), JSON.stringify({ pid: process.pid, status: "running" }));
    const originalPong = mgr["socketPong"];
    const originalLegacy = mgr["legacyOwnerMatches"];
    let legacyCalled = false;
    mgr["socketPong"] = async () => ({ received: true });
    mgr["legacyOwnerMatches"] = async () => { legacyCalled = true; return false; };
    try {
      await assert.rejects(() => mgr.stop(), /ownership could not be verified/);
      assert.equal(legacyCalled, true);
    } finally {
      mgr["socketPong"] = originalPong;
      mgr["legacyOwnerMatches"] = originalLegacy;
      rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
    }
  });

  it("client disconnect during ping does not terminate daemon", async () => {
    const mgr = new DaemonManager(testHome);
    rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
    const first = await mgr.start();
    try {
      // Destroy a connection immediately after writing a ping. The daemon
      // must tolerate a peer disappearing before its response is delivered.
      for (let i = 0; i < 30; i++) {
        await new Promise<void>((resolve) => {
          const conn = createConnection(mgr.socketPath());
          conn.once("connect", () => {
            conn.write('{"command":"ping"}\n');
            conn.destroy();
            resolve();
          });
          conn.once("error", () => resolve());
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(await mgr.isRunning(), true, "daemon must survive disconnected peers");
      await assert.rejects(() => mgr.start(), /already running/);
      assert.equal((await mgr.status())?.pid, first.pid);
    } finally {
      await mgr.stop();
    }
  });

  it("client disconnect during ping does not crash the daemon", async () => {
    const mgr = new DaemonManager(testHome);
    rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
    const first = await mgr.start();
    try {
      // Send a valid command then immediately tear down the transport.
      // This must not propagate EPIPE/ECONNRESET into process termination.
      for (let i = 0; i < 25; i++) {
        await new Promise<void>((resolve) => {
          const client = createConnection(mgr.socketPath());
          client.once("connect", () => {
            client.write('{"command":"ping"}\n');
            client.destroy();
            resolve();
          });
          client.once("error", () => resolve());
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(await mgr.isRunning(), true, "daemon remains alive after disconnected clients");
      await assert.rejects(() => mgr.start(), /already running/, "socket remains owned by daemon");
      assert.equal((await mgr.status())?.pid, first.pid);
    } finally {
      await mgr.stop();
    }
  });

  it("independent probe: competing start preserves the live owner's metadata", async () => {
    const mgr = new DaemonManager(testHome);
    rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
    const first = await mgr.start();
    try {
      // Simulate missing metadata while the original daemon still owns its socket.
      rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
      await assert.rejects(() => mgr.start(), /failed to acquire ownership|already running/);
      const current = await mgr.status();
      assert.equal(current?.pid, first.pid, "the rejected contender must not erase the owner's status");
      assert.equal(current?.status, "running");
    } finally {
      // Restore the original owner's metadata to permit orderly cleanup.
      writeFileSync(join(testHome, ".alix", "daemon.json"), JSON.stringify(first));
      await mgr.stop();
    }
  });

  it("stop waits for daemon exit before allowing immediate restart", async () => {
    const mgr = new DaemonManager(testHome);
    rmSync(join(testHome, ".alix", "daemon.json"), { force: true });
    const first = await mgr.start();
    await mgr.stop();
    assert.equal((await mgr.status())?.status, "stopped");
    assert.equal((await mgr.status())?.pid, first.pid);
    assert.equal(existsSync(join(testHome, ".alix", "daemon.pid")), false);
    assert.equal(await mgr.isRunning(), false);
    const restarted = await mgr.start();
    assert.notEqual(restarted.pid, first.pid);
    assert.equal(readFileSync(join(testHome, ".alix", "daemon.pid"), "utf8"), String(restarted.pid));
    assert.equal((await mgr.status())?.status, "running");
    try {
      assert.ok(statSync(mgr.socketPath()).isSocket());
    } finally {
      await mgr.stop();
    }
  });

  it("portable lock denies competing daemon without flock executable", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "daemon-portable-"));
    const socket = join(cwd, "portable.sock");
    const entry = join(process.cwd(), "dist/src/operations/daemon/daemon-server.js");
    const launch = () => spawn(process.execPath, [entry, "--socket", socket, "--cwd", cwd], {
      env: { ...process.env, HOME: cwd, PATH: "" }, stdio: "ignore",
    });
    const first = launch();
    try {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        try { if (statSync(socket).isSocket()) break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      const inode = statSync(socket).ino;
      assert.equal(first.exitCode, null, "first daemon must remain alive before contention");
      const second = launch();
      const exit = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => { second.kill("SIGKILL"); reject(new Error("contender hung")); }, 5000);
        second.once("exit", code => { clearTimeout(timeout); resolve(code); });
        second.once("error", reject);
      });
      assert.notEqual(exit, 0);
      assert.equal(first.exitCode, null, "first daemon must remain alive after contention");
      assert.equal(statSync(socket).ino, inode);
    } finally {
      first.kill("SIGTERM");
      await new Promise(resolve => { if (first.exitCode !== null) resolve(null); else first.once("exit", resolve); });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("flock backend refuses an existing portable lock directory", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "daemon-backend-switch-"));
    const socket = join(cwd, "portable.sock");
    const lock = `${socket}.lock`;
    mkdirSync(lock);
    writeFileSync(join(lock, "meta.json"), JSON.stringify({ pid: process.pid, token: "live", acquiredAt: new Date().toISOString() }));
    const entry = join(process.cwd(), "dist/src/operations/daemon/daemon-server.js");
    try {
      const child = spawn(process.execPath, [entry, "--socket", socket, "--cwd", cwd], {
        env: { ...process.env, HOME: cwd }, stdio: "ignore",
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("backend switch hung")); }, 5000);
        child.once("exit", value => { clearTimeout(timer); resolve(value); });
        child.once("error", reject);
      });
      assert.notEqual(code, 0);
      assert.ok(statSync(lock).isDirectory());
    } finally { rmSync(cwd, { recursive: true, force: true }); }
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
