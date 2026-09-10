import { execFile, spawn } from "node:child_process";
import { buildChildEnv } from "../runtime/child-env.js";
import type { ToolResult } from "./types.js";
import { withTimeout, SideEffectTimeoutError } from "../runtime/side-effect-timeout.js";
import { ExecutionCancelledError, signalReason } from "../runtime/cancellation-token.js";
import { consoleSink, createMultiplexDiagnosticSink } from "../runtime/runtime-diagnostics.js";
import { createDiagnosticStoreSink, DiagnosticEventStore } from "../observability/diagnostic-event-store.js";

const diagSink = createMultiplexDiagnosticSink(
  consoleSink,
  createDiagnosticStoreSink(new DiagnosticEventStore(process.cwd() + "/.alix/diagnostics")),
);

const MAX_BYTES = 80_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function normalizeTimeoutMs(timeoutMs: unknown): number {
  const value = typeof timeoutMs === "string" ? Number(timeoutMs) : timeoutMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TIMEOUT_MS;
}

function normalizeCommand(command: unknown): string {
  return Array.isArray(command) && command.every((part) => typeof part === "string")
    ? command.join(" ")
    : String(command ?? "");
}

function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let result = "";
  let byteCount = 0;
  const bytes = Buffer.from(text, "utf8");
  let cutIndex = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const charBytes = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    if (byteCount + charBytes > maxBytes) break;
    byteCount += charBytes;
    cutIndex = i + 1;
  }
  const truncated = text.slice(0, cutIndex);
  const lines = (truncated.match(/\n/g) || []).length;
  const hiddenBytes = Buffer.byteLength(text, "utf8") - byteCount;
  return truncated + `[... ${lines} lines truncated, ${hiddenBytes} bytes hidden]`;
}

/**
 * Spawn a shell command and return a promise + cancel function.
 * The promise resolves/rejects when the child process completes or errors.
 *
 * Separated from the timeout logic so withTimeout can manage the
 * timing boundary and cancel() can kill the child on timeout.
 *
 * When an optional operator-cancel `signal` is supplied it is mapped onto the
 * SAME child-kill: an abort kills the child AND rejects the promise with an
 * ExecutionCancelledError (never a tool-error ToolResult), so the operator
 * cancel unwinds as a cancellation — not as a tool failure. The signal is
 * strictly an ADDITIONAL kill path: the tool's own timeoutMs bound is
 * untouched. Exactly one abort listener is attached and removed on settle.
 */
function spawnCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  envAllowlist?: string[],
): { promise: Promise<ToolResult>; cancel: () => void } {
  const child = spawn(command, [], {
    cwd: cwd || undefined,
    shell: true,
    detached: process.platform !== "win32",
    env: buildChildEnv(envAllowlist),
  });
  let stdout = "";
  let stderr = "";
  let settled = false;

  const promise = new Promise<ToolResult>((resolve, reject) => {
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      // Kill the child (the operator-abort kill path) and route the outcome
      // to cancellation, never to a "command exited with code" failure.
      killProcessTree(child.pid);
      reject(new ExecutionCancelledError(signalReason(signal) ?? "cancelled by operator"));
    };
    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    if (signal) {
      // Already-aborted at spawn time: kill the just-spawned child and reject
      // immediately. Otherwise listen — the loop may cancel mid-flight.
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("close", (code) => {
      if (settled) return;
      const combined = stderr ? `${stdout}\n--- stderr ---\n${stderr}` : stdout;
      const output = truncate(combined, MAX_BYTES);
      if ((code ?? 0) !== 0) {
        finish({ kind: "error", message: `Command exited with code ${code}: ${command}\n${output}` });
        return;
      }
      finish({ kind: "success", output, exitCode: code ?? 0 });
    });

    child.on("error", (err) => {
      finish({ kind: "error", message: `Command failed: ${command} -- ${err.message}` });
    });
  });

  return {
    promise,
    cancel: () => {
      if (!settled) killProcessTree(child.pid);
    },
  };
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
  }
}

export async function runCommand(args: { command: string; cwd: string; timeoutMs?: number; signal?: AbortSignal; envAllowlist?: string[] }): Promise<ToolResult> {
  const command = normalizeCommand(args.command);
  const { cwd } = args;
  const timeoutMs = normalizeTimeoutMs(args.timeoutMs);

  if (!command || typeof command !== "string" || !command.trim()) {
    return { kind: "error", message: "shell.run requires a non-empty command string" };
  }

  const { promise, cancel } = spawnCommand(command, cwd, args.signal, args.envAllowlist);

  try {
    return await withTimeout(
      `shell.run: ${command.slice(0, 80)}`,
      timeoutMs,
      () => promise,
      (d) => diagSink.emit(d),
    );
  } catch (err: unknown) {
    if (err instanceof SideEffectTimeoutError) {
      cancel(); // Kill the child process on timeout
      return {
        kind: "error",
        message: `Command timed out after ${timeoutMs}ms: ${command}`,
      };
    }
    throw err; // Re-throw unexpected errors
  }
}
