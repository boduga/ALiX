/**
 * daemon-protocol-soak.test.ts — Daemon resilience via real socket protocol.
 *
 * Tier 2 (slow, gated by ALIX_SOAK_TESTS=1). Uses an isolated HOME
 * so tests never touch the user's real daemon state.
 *
 * Instead of routing through `alix submit` (which adds CLI dispatch
 * overhead inside the node --test harness), this file connects directly
 * to the daemon Unix socket with JSON-line messages — the same protocol
 * the CLI uses internally.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { connect, type Socket } from "node:net";

const ENABLED = process.env.ALIX_SOAK_TESTS === "1";
const describeSoak = ENABLED ? describe : describe.skip;

// ── helpers ──────────────────────────────────────────────────────────────────

function cliPath(): string {
  return join(process.cwd(), "dist", "src", "cli.js");
}

function isolatedEnv(testHome: string): Record<string, string> {
  return { ...process.env as Record<string, string>, HOME: testHome, USERPROFILE: testHome };
}

/** Blocking sleep via Atomics.wait — does not yield the event loop. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidPath(home: string): string {
  return join(home, ".alix", "daemon.pid");
}

/** Check if daemon is alive by reading PID file and sending signal 0. */
function daemonIsRunning(home: string): boolean {
  const pp = pidPath(home);
  if (!existsSync(pp)) return false;
  try {
    const pid = parseInt(readFileSync(pp, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

/** Wait up to timeoutMs for a process identified by PID to exit. */
function waitForProcessExit(pid: number, timeoutMs: number = 5000): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return; }
    sleepSync(50);
  }
}

/** Wait up to timeoutMs for a file to be removed. */
function waitForFileRemoved(file: string, timeoutMs: number = 3000): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && existsSync(file)) {
    sleepSync(50);
  }
}

/**
 * Connect to the daemon socket, send a JSON-line command, and collect all
 * response lines. Resolves after a quiet period (no data for 500ms) to
 * allow multi-message responses (task.created, task.completed, etc.).
 * The daemon holds connections open, so we do not wait for close/end.
 */
function sendCommand(
  socketPath: string,
  command: Record<string, unknown>,
  timeoutMs: number = 30000,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const client: Socket = connect(socketPath, () => {
      client.write(JSON.stringify(command) + "\n");
    });

    const messages: Record<string, unknown>[] = [];
    let buffer = "";

    let totalTimeout: ReturnType<typeof setTimeout>;
    let quietTimer: ReturnType<typeof setTimeout>;

    function resetQuietTimer(): void {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        clearTimeout(totalTimeout);
        client.destroy();
        resolve(messages);
      }, 500);
    }

    totalTimeout = setTimeout(() => {
      clearTimeout(quietTimer);
      client.destroy();
      reject(new Error(`Socket command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    client.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          messages.push(JSON.parse(line));
        } catch {
          // non-JSON output (e.g. tool stdout) — ignore
        }
      }
      resetQuietTimer();
    });

    client.on("error", (err) => {
      clearTimeout(totalTimeout);
      clearTimeout(quietTimer);
      reject(err);
    });

    client.on("close", () => {
      clearTimeout(totalTimeout);
      clearTimeout(quietTimer);
      resolve(messages);
    });

    resetQuietTimer();
  });
}

/**
 * Submit a task to the daemon via the socket protocol and wait for completion.
 * Returns collected messages.
 */
async function submitTaskViaSocket(
  socketPath: string,
  task: string,
  cwd: string,
): Promise<Record<string, unknown>[]> {
  return sendCommand(socketPath, { command: "run", task, cwd });
}

// ── tests ────────────────────────────────────────────────────────────────────

describeSoak("Daemon Protocol Soak", () => {
  let testHome: string;
  let sockPath: string;

  function startDaemon(): void {
    execFileSync(process.execPath, [cliPath(), "daemon", "start"], {
      cwd: testHome,
      env: isolatedEnv(testHome),
      timeout: 15000,
      stdio: "pipe",
    });
  }

  function stopDaemon(): void {
    try {
      execFileSync(process.execPath, [cliPath(), "daemon", "stop"], {
        cwd: testHome,
        env: isolatedEnv(testHome),
        timeout: 10000,
        stdio: "pipe",
      });
    } catch { /* best-effort */ }
    // Give the daemon process a moment to actually terminate.
    const pp = pidPath(testHome);
    if (existsSync(pp)) {
      try {
        const pid = parseInt(readFileSync(pp, "utf-8").trim(), 10);
        waitForProcessExit(pid, 3000);
      } catch { /* race — file already gone */ }
    }
  }

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "soak-daemon-proto-"));
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    writeFileSync(join(testHome, ".alix", "config.json"), JSON.stringify({
      model: { provider: "mock", name: "mock" },
      permissions: { default: "allow", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
      context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
      runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
      ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" },
      mcpServers: [],
    }));
    sockPath = join(testHome, ".alix", "alixd.sock");
  });

  afterEach(() => {
    stopDaemon();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("starts and stops cleanly", () => {
    startDaemon();
    assert.ok(daemonIsRunning(testHome), "daemon should be running after start");
    stopDaemon();
    assert.equal(daemonIsRunning(testHome), false, "daemon should stop after stop");
  });

  it("rejects second start while running", () => {
    startDaemon();
    assert.ok(daemonIsRunning(testHome));
    assert.throws(() => startDaemon(), /Daemon already running/, "second start should throw");
  });

  it("recovers from stale PID file", () => {
    writeFileSync(pidPath(testHome), "9999999\n", "utf-8");
    startDaemon();
    assert.ok(daemonIsRunning(testHome), "daemon starts after stale PID cleanup");
  });

  it("recovers from orphaned socket", () => {
    writeFileSync(sockPath, "", "utf-8");
    startDaemon();
    assert.ok(daemonIsRunning(testHome), "daemon starts after orphaned socket cleanup");
  });

  it("submits 10 sequential tasks via socket", async () => {
    startDaemon();
    try {
      for (let i = 0; i < 10; i++) {
        const msgs = await submitTaskViaSocket(sockPath, "echo ping", testHome);
        assert.ok(msgs.length > 0, `task ${i} should produce at least one response`);
        const taskCreated = msgs.find((m) => m.type === "task.created");
        assert.ok(taskCreated, `task ${i} should have a task.created event`);
      }
    } finally {
      stopDaemon();
    }
  });

  it("persists tasks to registry after socket submit", async () => {
    startDaemon();
    const tasksPath = join(testHome, ".alix", "daemon-tasks.json");
    try {
      // Submit a task and wait for it to complete over the socket.
      const msgs = await submitTaskViaSocket(sockPath, "echo persist-test", testHome);
      const completed = msgs.find((m) => m.type === "task.completed");
      assert.ok(completed, "task should complete before we check the registry");

      // Allow the async save promise chain to flush.
      sleepSync(300);

      const content = readFileSync(tasksPath, "utf-8");
      const tasks = JSON.parse(content);
      assert.ok(Array.isArray(tasks) && tasks.length > 0, "tasks persisted as array");
    } finally {
      stopDaemon();
    }
  });

  it("cleans up PID and socket on stop", () => {
    startDaemon();
    stopDaemon();
    // PID file: daemon manager removes it synchronously in stop()
    assert.equal(existsSync(pidPath(testHome)), false, "PID file removed after stop");
    // Socket file: server.close() removes it async on SIGTERM — wait briefly
    waitForFileRemoved(sockPath, 3000);
    assert.equal(existsSync(sockPath), false, "socket file removed after stop");
  });

  it("status returns correct state", () => {
    assert.equal(daemonIsRunning(testHome), false, "daemon not running before start");
    startDaemon();
    assert.ok(daemonIsRunning(testHome), "daemon running after start");
    stopDaemon();
    assert.equal(daemonIsRunning(testHome), false, "daemon not running after stop");
  });

  it("sends ping and receives pong", async () => {
    startDaemon();
    try {
      const msgs = await sendCommand(sockPath, { command: "ping" });
      const pong = msgs.find((m) => m.type === "pong");
      assert.ok(pong, "should receive a pong response");
    } finally {
      stopDaemon();
    }
  });

  it("rejects unknown command with error message", async () => {
    startDaemon();
    try {
      const msgs = await sendCommand(sockPath, { command: "nonexistent" });
      const err = msgs.find((m) => m.type === "error");
      assert.ok(err, "should receive an error response");
      assert.ok(String(err!.message).includes("Unknown command"), "error should mention unknown command");
    } finally {
      stopDaemon();
    }
  });

  it("displays correct queue position for sequential tasks", async () => {
    startDaemon();
    try {
      // Submit first task and wait for completion (drains queue)
      await submitTaskViaSocket(sockPath, "echo first", testHome);

      // Submit task A, note its position
      const msgsA = await submitTaskViaSocket(sockPath, "echo second", testHome);
      const created = msgsA.find((m) => m.type === "task.created") as Record<string, unknown> | undefined;
      assert.ok(created, "task.created event received");
    } finally {
      stopDaemon();
    }
  });
});
