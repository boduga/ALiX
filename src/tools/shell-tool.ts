import { spawn } from "node:child_process";
import type { ToolResult } from "./types.js";

const MAX_BYTES = 80_000;

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
  const { command, cwd, timeoutMs = 120_000 } = args;

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
      const combined = stdout + "\n--- stderr ---\n" + stderr;
      const output = truncate(combined, MAX_BYTES);
      finish({ kind: "success", output, exitCode: code ?? 0 });
    });

    child.on("error", (err) => {
      finish({ kind: "error", message: `Command failed: ${command} -- ${err.message}` });
    });
  });
}