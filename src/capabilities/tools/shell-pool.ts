import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildChildEnv } from "../../runtime-state/runtime/child-env.js";
import { ExecutionCancelledError, signalReason } from "../../runtime-state/runtime/cancellation-token.js";

const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";

/** Persistent transport. Routed effects use fixedCwd: each command gets an
 * isolated subshell so cd, functions and shell state cannot change the next
 * command's execution directory. Legacy direct users can retain shell state. */
export class ShellPool {
  private readonly proc: ReturnType<typeof spawn>;
  readonly cwd: string;
  private busy = false;
  private closed = false;
  private readonly fixedCwd: boolean;

  constructor(options: { cwd: string; timeoutMs?: number; envAllowlist?: string[]; fixedCwd?: boolean }) {
    this.cwd = realpathSync(options.cwd);
    this.fixedCwd = options.fixedCwd ?? false;
    this.proc = spawn("/bin/bash", [], {
      cwd: this.cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: buildChildEnv(options.envAllowlist),
    });
    // Spawn failure may precede the first run's listener attachment.
    this.proc.on("error", () => { this.closed = true; });
    this.proc.on("close", () => { this.closed = true; });
    this.proc.stdin?.on("error", () => { this.close(); });
  }

  async run(command: string, timeoutMs = 120000, signal?: AbortSignal): Promise<{ output: string; exitCode: number }> {
    if (signal?.aborted) throw new ExecutionCancelledError(signalReason(signal) ?? "tool cancelled");
    if (this.closed) throw new Error("Persistent shell is closed after an uncertain outcome or process exit");
    if (this.busy) throw new Error("Persistent shell is busy");
    this.busy = true;
    const marker = `__SHELLPOOL_${randomUUID()}__`;
    const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;
    return new Promise((resolve, reject) => {
      let output = "";
      let stderr = "";
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        this.proc.stdout?.off("data", onData);
        this.proc.stderr?.off("data", onStderr);
        this.proc.off("close", onClose);
        this.proc.off("error", onError);
        signal?.removeEventListener("abort", onAbort);
        this.busy = false;
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        // Never reuse a transport whose completion boundary is unknown.
        this.close();
        cleanup();
        reject(error);
      };
      const onData = (data: Buffer): void => {
        output += data.toString();
        const match = output.match(new RegExp(`\\n${marker}:(\\d+)\\r?\\n`));
        if (!match || settled) return;
        settled = true;
        cleanup();
        resolve({ output: output.slice(0, match.index) + (stderr ? `\n--- stderr ---\n${stderr}` : ""), exitCode: Number(match[1]) });
      };
      const onStderr = (data: Buffer): void => { stderr += data.toString(); };
      const onClose = (): void => fail(new Error("Persistent shell exited before command completion"));
      const onError = (error: Error): void => fail(error);
      const onAbort = (): void => fail(new ExecutionCancelledError(signalReason(signal) ?? "tool cancelled"));
      const timer = setTimeout(() => fail(new Error(`Command timed out after ${duration}ms: ${command}`)), duration);
      this.proc.stdout?.on("data", onData);
      this.proc.stderr?.on("data", onStderr);
      this.proc.once("close", onClose);
      this.proc.once("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      // A subshell contains command-driven cd/exit/traps/environment changes.
      // cd is checked before eval; failure cannot run at an unintended cwd.
      const script = this.fixedCwd
        ? `(builtin cd -- ${quote(this.cwd)} && builtin eval -- ${quote(command)})`
        : command;
      this.proc.stdin?.write(`${script}\nbuiltin printf '\\n${marker}:%s\\n' "$?"\n`, (error) => { if (error) fail(error); });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (process.platform !== "win32" && this.proc.pid) {
      try { process.kill(-this.proc.pid, "SIGKILL"); } catch { this.proc.kill("SIGKILL"); }
    } else {
      this.proc.kill("SIGKILL");
    }
    this.proc.stdin?.destroy();
  }
}
