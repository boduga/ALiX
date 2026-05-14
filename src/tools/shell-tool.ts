import { spawn } from "node:child_process";
import type { ToolResult } from "./types.js";

export async function runCommand(args: { command: string; cwd: string; timeoutMs?: number }): Promise<ToolResult> {
  const { command, cwd, timeoutMs = 120_000 } = args;

  if (!command || typeof command !== "string" || !command.trim()) {
    return { kind: "error", message: "shell.run requires a non-empty command string" };
  }

  return new Promise((resolve) => {
    const child = spawn(command, [], { cwd: cwd || undefined, shell: true });
    let output = "";
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

    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    child.on("close", (code) => {
      finish({ kind: "success", output, exitCode: code ?? 0 });
    });

    child.on("error", (err) => {
      finish({ kind: "error", message: `Command failed: ${command} -- ${err.message}` });
    });
  });
}