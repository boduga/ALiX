/**
 * daemon-manager.ts — PID management and daemon lifecycle.
 *
 * Manages .alix/daemon.pid and .alix/daemon.json.
 * No actual server logic — just lifecycle.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

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

  private pidPath(): string {
    return join(this.cwd, ".alix", "daemon.pid");
  }

  private statusPath(): string {
    return join(this.cwd, ".alix", "daemon.json");
  }

  private ensureDir(): Promise<void> {
    return mkdir(join(this.cwd, ".alix"), { recursive: true }) as any;
  }

  /** Start the daemon process. */
  async start(): Promise<DaemonStatus> {
    const existing = await this.status();
    if (existing && existing.status === "running") {
      throw new Error(`Daemon already running (pid ${existing.pid})`);
    }

    await this.ensureDir();
    const socketPath = join(this.cwd, ".alix", "alixd.sock");

    const child = spawn(process.execPath, [
      join(__dirname, "daemon-server.js"),
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
    if (existsSync(this.pidPath())) {
      await writeFile(this.pidPath(), "", "utf-8");
    }
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
