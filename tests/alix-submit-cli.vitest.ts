/**
 * Tests for the `alix submit` CLI dispatch path (issue #294).
 *
 * Strategy: spawn a fake daemon as a SUBPROCESS (not in-process within
 * vitest). The fake daemon writes a real daemon.json with a real PID
 * and listens on the canonical ~/.alix/alixd.sock. The CLI's
 * `DaemonManager` finds the daemon via HOME-aware homedir() and uses
 * the socket path it advertises.
 *
 * The earlier version spawned the daemon in-process (a `node:net.Server`
 * created inside `beforeAll`). That worked manually but hung under
 * vitest, possibly because the in-process server and the spawned CLI
 * process were sharing sockets in a way vitest's transform pipeline
 * doesn't handle. A separate-process daemon avoids the issue.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run the ALiX CLI binary with a custom HOME.
 */
function runAlix(args: string[], home: string): SpawnSyncReturns<string> {
  const cliPath = join(import.meta.dirname, "..", "dist", "src", "cli.js");
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    timeout: 40_000,
  });
}

/**
 * Build a fake daemon that:
 * - Writes daemon.json with a real PID
 * - Listens on ~/.alix/alixd.sock
 * - Reads one JSON line per client
 * - Writes back the configured frames in order
 * - Half-closes the write side to signal EOF
 *
 * Frames are passed via the FAKE_DAEMON_FRAMES env var as a
 * newline-separated JSON list.
 */
const FAKE_DAEMON_SOURCE = `
import { createServer } from "node:net";
import { writeFileSync, mkdirSync } from "node:fs";
const SOCK = process.env.HOME + "/.alix/alixd.sock";
mkdirSync(process.env.HOME + "/.alix", { recursive: true });
writeFileSync(process.env.HOME + "/.alix/daemon.json", JSON.stringify({
  pid: process.pid,
  startedAt: new Date().toISOString(),
  socketPath: SOCK,
  status: "running",
  lastHeartbeat: new Date().toISOString(),
}));
const frames = (process.env.FAKE_DAEMON_FRAMES || "").split("\\n").filter(Boolean).map((l) => JSON.parse(l));
const srv = createServer((c) => {
  let buf = "";
  c.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    if (buf.includes("\\n")) {
      for (const frame of frames) c.write(JSON.stringify(frame) + "\\n");
      c.end();
    }
  });
});
srv.listen(SOCK, () => process.stderr.write("fake-daemon: listening on " + SOCK + "\\n"));
`;

/**
 * Set up a fake daemon subprocess for a test. Returns the home
 * directory and a cleanup function.
 */
function startFakeDaemon(frames: object[]): { home: string; stop: () => void } {
  const home = mkdtempSync(join(tmpdir(), "alix-submit-test-"));
  const daemonPath = join(home, "fake-daemon.mjs");
  writeFileSync(daemonPath, FAKE_DAEMON_SOURCE);

  const proc: ChildProcess = spawn(process.execPath, [daemonPath], {
    env: {
      ...process.env,
      HOME: home,
      FAKE_DAEMON_FRAMES: frames.map((f) => JSON.stringify(f)).join("\n"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stderr?.on("data", () => {
    /* drain stderr */
  });

  // Wait for daemon to be ready by reading stderr until it announces.
  const ready = new Promise<void>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (buf.includes("listening on")) {
        proc.stderr?.off("data", onData);
        resolve();
      }
    };
    proc.stderr?.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`daemon exited early with code ${code}; buf=${buf}`)));
    setTimeout(() => reject(new Error(`daemon did not start in 5s; buf=${buf}`)), 5_000);
  });

  return {
    home,
    stop: () => {
      proc.kill("SIGKILL");
      rmSync(home, { recursive: true, force: true });
    },
  };
}

describe("alix submit CLI dispatch (issue #294)", () => {
  it("success path: receives task.created, task.completed; exits 0", async () => {
    const { home, stop } = startFakeDaemon([
      { type: "task.created", taskId: "task_test_1", task: "what is 2+2" },
      { type: "task.completed", status: "completed" },
    ]);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const r = runAlix(["submit", "what is 2+2"], home);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Task created: task_test_1");
      expect(r.stdout).toContain("Task completed: completed");
      expect(r.stderr).not.toContain("Unknown command: submit");
    } finally {
      stop();
    }
  });

  it("failure path: receives task.failed, exits 1 with 'Task failed' in stderr", async () => {
    const { home, stop } = startFakeDaemon([
      { type: "task.created", taskId: "task_test_2" },
      { type: "task.failed", error: "model not configured" },
    ]);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const r = runAlix(["submit", "bad"], home);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("Task created: task_test_2");
      expect(r.stderr).toContain("Task failed: model not configured");
    } finally {
      stop();
    }
  });

  it("prints tool.* progress messages during execution", async () => {
    const { home, stop } = startFakeDaemon([
      { type: "task.created", taskId: "task_test_3" },
      { type: "tool.started", toolName: "bash" },
      { type: "tool.completed", toolName: "bash", durationMs: 42 },
      { type: "task.completed", status: "completed" },
    ]);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const r = runAlix(["submit", "long-task"], home);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("→ bash started");
      expect(r.stdout).toContain("✓ bash completed");
      expect(r.stdout).toContain("(42ms)");
    } finally {
      stop();
    }
  });

  it("no daemon running: prints 'Daemon is not running' and exits 1", () => {
    const emptyHome = mkdtempSync(join(tmpdir(), "alix-submit-empty-"));
    try {
      const r = runAlix(["submit", "what is 2+2"], emptyHome);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Daemon is not running");
    } finally {
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it("unrecognized commands still produce 'Unknown command' (regression check)", async () => {
    const { home, stop } = startFakeDaemon([]);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const r = runAlix(["nonexistent-command"], home);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Unknown command: nonexistent-command");
    } finally {
      stop();
    }
  });
});
