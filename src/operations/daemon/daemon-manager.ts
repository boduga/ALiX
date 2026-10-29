/**
 * daemon-manager.ts — PID management and daemon lifecycle.
 *
 * Manages .alix/daemon.pid and .alix/daemon.json.
 * No actual server logic — just lifecycle.
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join, dirname } from "node:path";
import { resolveDaemonSocketAddress } from "./daemon-paths.js";
import { ApprovalStoreLock } from "../../governance/approvals/approval-store-lock.js";
import { homedir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
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
    return resolveDaemonSocketAddress(this.globalDir());
  }

  private ensureDir(): Promise<void> {
    return mkdir(this.globalDir(), { recursive: true }) as any;
  }

  /** Start the daemon process. */
  async start(): Promise<DaemonStatus> {
    // Status/PID metadata is advisory. A recycled PID must not prevent
    // admission, and only the socket owner can establish daemon identity.
    await this.ensureDir();
    const socketPath = this.socketPath();
    // A live owner may have lost its status file. Ask it to self-heal before
    // attempting admission; never manufacture another process's identity.
    if (await this.socketResponds(socketPath)) {
      throw new Error("Daemon already running (live socket owner)");
    }

    // The daemon server alone cleans stale sockets after acquiring admission.

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

    // A spawned PID is NOT proof of daemon admission. The child may be a
    // rejected contender; never publish or delete another owner's metadata.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const current = await this.status();
      if (current?.pid === child.pid && current.status === "running" &&
          await this.socketResponds(socketPath, child.pid)) return current;
      try { process.kill(child.pid, 0); } catch { break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Daemon failed to acquire ownership or become ready. Run daemon-server directly for logs.");
  }

  private async socketResponds(socketPath: string, expectedPid?: number): Promise<boolean> {
    const pong = await this.socketPong(socketPath);
    return pong.received && (expectedPid === undefined || pong.pid === expectedPid);
  }

  private socketPong(socketPath: string): Promise<{ received: boolean; pid?: number }> {
    return new Promise((resolve) => {
      const socket = createConnection(socketPath);
      let settled = false;
      const finish = (pong: { received: boolean; pid?: number }) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(pong);
      };
      socket.setTimeout(300);
      socket.once("connect", () => socket.write('{"command":"ping"}\n'));
      // Daemon may stream status/event frames before the ping response.
      // Read complete newline-delimited frames, not the first TCP chunk.
      let buffer = "";
      socket.on("data", (data) => {
        buffer += String(data);
        let end: number;
        while ((end = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const response = JSON.parse(line) as { type?: string; pid?: number };
            if (response.type === "pong") {
              finish({ received: true, pid: response.pid });
              return;
            }
          } catch { /* ignore malformed non-pong frames */ }
        }
        if (buffer.length > 65536) finish({ received: false });
      });
      socket.once("error", () => finish({ received: false }));
      socket.once("timeout", () => finish({ received: false }));
      socket.once("close", () => finish({ received: false }));
    });
  }

  /** Legacy pong has no PID. Verify its live process command line before
   * allowing a stop; never trust the persisted PID alone. Fail closed if the
   * OS cannot establish the expected executable and socket arguments. */
  private async legacyOwnerMatches(pid: number, socketPath: string): Promise<boolean> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      let args: string[];
      if (process.platform === "linux") {
        const cmdline = await readFile(`/proc/${pid}/cmdline`);
        args = cmdline.toString("utf8").split("\0").filter(Boolean);
      } else if (process.platform === "darwin") {
        const { stdout } = await promisify(execFile)("ps", ["-p", String(pid), "-o", "command="], { timeout: 1000 });
        // The legacy daemon command is spawned without shell quoting of the
        // socket path. Reject ambiguous paths rather than guessing identity.
        if (/\s/.test(socketPath)) return false;
        args = stdout.trim().split(/\s+/);
      } else return false;
      const serverIndex = args.findIndex((arg) => arg.endsWith("/daemon-server.js"));
      return serverIndex > 0 && args[serverIndex + 1] === "--socket" &&
        args[serverIndex + 2] === socketPath &&
        args[0] === process.execPath;
    } catch { return false; }
  }

  /** Stop the daemon. */
  async stop(): Promise<void> {
    const status = await this.status();
    if (!status || status.status !== "running") {
      console.log("Daemon is not running.");
      return;
    }
    if (!Number.isSafeInteger(status.pid) || status.pid <= 0) {
      throw new Error("Invalid daemon PID; refusing to signal recorded PID");
    }
    // Never signal a PID based solely on persisted metadata: the original
    // daemon may have exited and the OS may have reassigned its PID.
    // A live daemon must answer on its own socket before we may stop it.
    const socketPath = this.socketPath();
    const pong = await this.socketPong(socketPath);
    // A reported PID is authoritative. Never downgrade an explicit mismatch
    // into legacy verification by issuing a second identity-free ping.
    const verified = pong.received && (pong.pid !== undefined
      ? pong.pid === status.pid
      : await this.legacyOwnerMatches(status.pid, socketPath));
    if (!verified) {
      // A stale record must not authorize signaling an unrelated process.
      // If its PID no longer exists, stopping is already complete.
      try { process.kill(status.pid, 0); }
      catch (err: any) {
        if (err.code === "ESRCH") return;
        throw err;
      }
      throw new Error("Daemon ownership could not be verified; refusing to signal recorded PID");
    }
    try {
      process.kill(status.pid, "SIGTERM");
    } catch (err: any) {
      if (err.code !== "ESRCH") throw err;
    }
    // A SIGTERM request is not an exit acknowledgement. Do not advertise
    // stopped (or discard PID state) while the daemon can still own its socket.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        process.kill(status.pid, 0);
      } catch (err: any) {
        if (err.code === "ESRCH") break;
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    try {
      process.kill(status.pid, 0);
      throw new Error(`Daemon ${status.pid} did not exit after SIGTERM`);
    } catch (err: any) {
      if (err.code !== "ESRCH") throw err;
    }
    // Servers hold this global metadata lock for their entire lifetime. A
    // successor that won admission must never lose its identity to this stop.
    // Contention or unprovable lock ownership leaves metadata untouched.
    const lifecycle = new ApprovalStoreLock(this.cwd, {
      backend: "mkdir", lockPath: join(this.globalDir(), "daemon-lifecycle.lock"),
    });
    if (!(await lifecycle.acquire(300))) return;
    try {
      const current = await this.status();
      if (!current || current.pid !== status.pid || current.startedAt !== status.startedAt ||
          current.socketPath !== status.socketPath) return;
      const stopped: DaemonStatus = { ...current, status: "stopped" };
      await writeFile(this.statusPath(), JSON.stringify(stopped, null, 2), "utf-8");
      // A mismatched PID projection is also not ours to remove.
      const pid = await readFile(this.pidPath(), "utf-8").catch(() => undefined);
      if (pid?.trim() === String(status.pid)) await rm(this.pidPath(), { force: true });
    } finally { lifecycle.release(); }
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
