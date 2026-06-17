/**
 * daemon-resource-soak.test.ts — Daemon resource consumption under sustained load.
 *
 * Tier 2 (gated by ALIX_SOAK_TESTS=1). Starts the daemon, sends sustained
 * workload, and measures RSS, handle count, timer count at intervals.
 * Fails if resource growth exceeds thresholds.
 *
 * Run: ALIX_SOAK_TESTS=1 npx node --test --test-concurrency=1 dist/tests/soak/daemon-resource-soak.test.js
 * Profiles: --soak-quick (30s), --soak-med (5m), --soak-long (30m+)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";

const ENABLED = process.env.ALIX_SOAK_TESTS === "1";
const describeSoak = ENABLED ? describe : describe.skip;

// ── Profile selection ────────────────────────────────────────────────────────

const PROFILE = process.env.SOAK_PROFILE ?? "quick";
const PROFILES: Record<string, { durationMs: number; ops: number; pauseMs: number }> = {
  quick: { durationMs: 30_000, ops: 20, pauseMs: 500 },
  medium: { durationMs: 300_000, ops: 100, pauseMs: 200 },
  long: { durationMs: 1_800_000, ops: 500, pauseMs: 100 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function cliPath(): string {
  return join(process.cwd(), "dist", "src", "cli.js");
}

function rssMb(childPid?: number): number {
  try {
    if (childPid) {
      const stat = readFileSync(`/proc/${childPid}/status`, "utf-8");
      const match = stat.match(/VmRSS:\s+(\d+)/);
      if (match) return Math.round(parseInt(match[10], 10) / 1024 * 10) / 10;
    }
  } catch {
    // fallback to self
  }
  return Math.round(process.memoryUsage().rss / 1024 / 1024 * 10) / 10;
}

function daemonSocketPath(homeDir: string): string {
  return join(homeDir, ".alix", "alixd.sock");
}

async function waitForSocket(socketPath: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(socketPath)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Socket not ready after ${timeoutMs}ms: ${socketPath}`);
}

async function sendDaemonCommand(socketPath: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath, () => {
      sock.write(JSON.stringify({ command }) + "\n");
    });

    let data = "";
    sock.on("data", (chunk) => { data += chunk.toString(); });
    sock.on("end", () => resolve(data));
    sock.on("error", reject);

    setTimeout(() => {
      sock.destroy();
      reject(new Error("Daemon command timed out"));
    }, 10_000);
  });
}

function countFds(childPid: number): number {
  try {
    const fds = readFileSync(`/proc/${childPid}/fd`, "utf-8");
    return fds.length > 0 ? readFileSync(`/proc/${childPid}/fd`, "utf-8").split("\n").length - 1 : -1;
  } catch {
    return -1;
  }
}

// ── Soak suite ───────────────────────────────────────────────────────────────

describeSoak("Daemon Resource Soak", () => {
  let homeDir: string;
  let daemon: ChildProcess;

  before(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "daemon-soak-"));
    mkdirSync(join(homeDir, ".alix"), { recursive: true });

    // Set up a minimal config so the daemon doesn't fail immediately
    const config = {
      provider: "cli",
      model: "test-model",
    };
    writeFileSync(join(homeDir, ".alix", "config.json"), JSON.stringify(config));

    // Start the daemon
    daemon = spawn(process.execPath, [cliPath(), "daemon", "start"], {
      env: { ...process.env, HOME: homeDir },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const socketPath = daemonSocketPath(homeDir);
    await waitForSocket(socketPath);
  });

  after(() => {
    // Stop the daemon
    if (daemon && !daemon.killed) {
      try {
        spawn(process.execPath, [cliPath(), "daemon", "stop"], {
          env: { ...process.env, HOME: homeDir },
          stdio: "ignore",
        });
      } catch { /* ignore */ }
    }
    rmSync(homeDir, { recursive: true, force: true });
  });

  // ── Resource growth measurement ───────────────────────────────────────

  it("measures RSS growth across sustained commands", { timeout: 120_000 }, async () => {
    const cfg = PROFILES[PROFILE] ?? PROFILES.quick;
    const socketPath = daemonSocketPath(homeDir);
    const measurements: Array<{ iteration: number; rssMb: number; fdCount: number; elapsedMs: number }> = [];
    const start = Date.now();
    const daemonPid = daemon.pid;

    for (let i = 0; i < cfg.ops; i++) {
      try {
        await sendDaemonCommand(socketPath, "status");
      } catch {
        // Some commands may fail — that's expected
      }

      if (i > 0 && i % 5 === 0) {
        const rss = daemonPid ? rssMb(daemonPid) : rssMb();
        const fds = daemonPid ? countFds(daemonPid) : -1;
        measurements.push({ iteration: i, rssMb: rss, fdCount: fds, elapsedMs: Date.now() - start });
      }

      await new Promise(r => setTimeout(r, cfg.pauseMs));
    }

    const elapsed = Date.now() - start;

    // Report measurements
    for (const m of measurements) {
      console.log(`  [i=${m.iteration}] RSS: ${m.rssMb} MB  FDs: ${m.fdCount}  elapsed: ${m.elapsedMs}ms`);
    }

    // Verify no unbounded growth over the test duration
    if (measurements.length >= 2) {
      const first = measurements[0];
      const last = measurements[measurements.length - 1];
      const rssDelta = last.rssMb - first.rssMb;
      const rssGrowthPerMinute = elapsed > 0 ? (rssDelta / elapsed) * 60_000 : 0;

      console.log(`  RSS delta: ${rssDelta} MB over ${Math.round(elapsed / 1000)}s (${rssGrowthPerMinute.toFixed(1)} MB/min)`);

      // Fail if RSS grows faster than 50 MB/minute (sustained leak detection)
      assert.ok(
        rssGrowthPerMinute < 50,
        `RSS growth ${rssGrowthPerMinute.toFixed(1)} MB/min exceeds 50 MB/min threshold`,
      );

      // Report FD count if available
      if (first.fdCount >= 0 && last.fdCount >= 0) {
        const fdDelta = last.fdCount - first.fdCount;
        const fdGrowthPerMinute = elapsed > 0 ? (fdDelta / elapsed) * 60_000 : 0;
        console.log(`  FD delta: ${fdDelta} FDs over ${Math.round(elapsed / 1000)}s (${fdGrowthPerMinute.toFixed(1)} FD/min)`);
        assert.ok(
          fdGrowthPerMinute < 10,
          `FD growth ${fdGrowthPerMinute.toFixed(1)}/min exceeds 10 FD/min threshold`,
        );
      }
    }

    console.log(`  Soak complete: ${cfg.ops} ops in ${Math.round(elapsed / 1000)}s`);
  });

  // ── Timer leak detection ──────────────────────────────────────────────

  it("detects timer leaks by measuring open handles before/after load", { timeout: 60_000 }, async () => {
    // This test runs in the main process and measures Node.js handle counts
    const beforeHandles = (process as any)._getActiveRequests?.()?.length ?? -1;
    const beforeHandles2 = (process as any)._getActiveHandles?.()?.length ?? -1;

    // Send a burst of commands
    const socketPath = daemonSocketPath(homeDir);
    for (let i = 0; i < 10; i++) {
      try {
        await sendDaemonCommand(socketPath, "status");
      } catch { /* ignore */ }
    }

    // Give timers time to settle
    await new Promise(r => setTimeout(r, 1000));

    const afterHandles = (process as any)._getActiveRequests?.()?.length ?? -1;
    const afterHandles2 = (process as any)._getActiveHandles?.()?.length ?? -1;

    console.log(`  Active requests: ${beforeHandles} → ${afterHandles}`);
    console.log(`  Active handles: ${beforeHandles2} → ${afterHandles2}`);

    // Skip assertion if the runtime doesn't support these probes
    if (beforeHandles >= 0 && afterHandles >= 0) {
      assert.ok(
        afterHandles <= beforeHandles + 5,
        `Active requests grew by ${afterHandles - beforeHandles} (limit +5)`,
      );
    }
  });
});
