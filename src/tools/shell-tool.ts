import { spawn } from "node:child_process";
import type { ToolResult } from "./types.js";

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

export async function runCommand(args: { command: string; cwd: string; timeoutMs?: number }): Promise<ToolResult> {
  const command = normalizeCommand(args.command);
  const { cwd } = args;
  const timeoutMs = normalizeTimeoutMs(args.timeoutMs);

  if (!command || typeof command !== "string" || !command.trim()) {
    return { kind: "error", message: "shell.run requires a non-empty command string" };
  }

  return new Promise((resolve) => {
    const child = spawn(command, [], { cwd: cwd || undefined, shell: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ kind: "error", message: `Command timed out after ${timeoutMs}ms: ${command}` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("close", (code) => {
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
}
