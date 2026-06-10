/**
 * daemon-manager.ts — PID management and daemon lifecycle.
 *
 * Manages .alix/daemon.pid and .alix/daemon.json.
 * No actual server logic — just lifecycle.
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const daemonManagerDir = dirname(fileURLToPath(import.meta.url));

export interface DaemonStatus {
  pid: number;
  startedAt: string;
  port?: number;
  socketPath?: string;
  currentSessionId?: string;
  lastHeartbeat?: string;
  status: "running" | "stopped";
}

export class DaemonManager {
  constructor(private cwd: string) {}

  private globalDir(): string {
    return join(homedir(), ".alix");
  }

  private pidPath(): string {
    return join(this.globalDir(), "daemon.pid");
  }

  private statusPath(): string {
    return join(this.globalDir(), "daemon.json");
  }

  socketPath(): string {
    return join(this.globalDir(), "alixd.sock");
  }

  private ensureDir(): Promise<void> {
    return mkdir(this.globalDir(), { recursive: true }) as any;
  }

  /** Start the daemon process. */
  async start(): Promise<DaemonStatus> {
    const existing = await this.status();
    if (existing && existing.status === "running") {
      // Verify the recorded PID is actually alive — the status file may be stale
      // if the daemon crashed or was killed externally.
      if (await this.isRunning()) {
        throw new Error(`Daemon already running (pid ${existing.pid})`);
      }
      // Stale state: recorded as running but PID is dead.
      // Clean up and proceed with a fresh start.
      await rm(this.pidPath(), { force: true }).catch(() => {});
      await rm(this.socketPath(), { force: true }).catch(() => {});
      await writeFile(
        this.statusPath(),
        JSON.stringify({ ...existing, status: "stopped" }, null, 2),
        "utf-8",
      ).catch(() => {});
    }

    await this.ensureDir();
    const socketPath = this.socketPath();

    // Remove stale socket before spawn — leftover from kill -9 or crash
    await rm(socketPath, { force: true }).catch(() => {});

    const child = spawn(process.execPath, [
      join(daemonManagerDir, "daemon-server.js"),
      "--socket", socketPath,
      "--cwd", this.cwd,
    ], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    if (child.pid === undefined) {
      throw new Error("Failed to spawn daemon process");
    }

    const now = new Date().toISOString();
    await writeFile(this.pidPath(), String(child.pid), "utf-8");

    const status: DaemonStatus = {
      pid: child.pid,
      startedAt: now,
      socketPath,
      status: "running",
    };
    await writeFile(this.statusPath(), JSON.stringify(status, null, 2), "utf-8");

    // Short post-spawn liveness check — the spawned process may crash
    // immediately (stale socket, missing deps, etc.) and stdio: "ignore"
    // hides the crash. Wait briefly, then verify.
    await new Promise((r) => setTimeout(r, 300));
    if (!(await this.isRunning())) {
      // Clean up stale state so a subsequent start() is clean.
      await rm(this.pidPath(), { force: true }).catch(() => {});
      await rm(this.statusPath(), { force: true }).catch(() => {});
      await rm(socketPath, { force: true }).catch(() => {});
      throw new Error("Daemon failed to stay running after start. Run daemon-server directly for logs.");
    }

    return status;
  }

  /** Stop the daemon. */
  async stop(): Promise<void> {
    const status = await this.status();
    if (!status || status.status !== "running") {
      console.log("Daemon is not running.");
      return;
    }
    try {
      process.kill(status.pid, "SIGTERM");
    } catch (err: any) {
      if (err.code !== "ESRCH") throw err;
    }
    const stopped: DaemonStatus = { ...status, status: "stopped" };
    await writeFile(this.statusPath(), JSON.stringify(stopped, null, 2), "utf-8");
    try {
      await rm(this.pidPath(), { force: true });
    } catch {}
  }

  /** Read current status. */
  async status(): Promise<DaemonStatus | null> {
    const statusPath = this.statusPath();
    if (!existsSync(statusPath)) return null;
    try {
      const raw = await readFile(statusPath, "utf-8");
      return JSON.parse(raw) as DaemonStatus;
    } catch {
      return null;
    }
  }

  /** Quick liveness check: is the PID alive? */
  async isRunning(): Promise<boolean> {
    const status = await this.status();
    if (!status || !status.pid) return false;
    try {
      process.kill(status.pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
