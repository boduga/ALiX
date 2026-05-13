import { spawn } from "node:child_process";
import type { ToolResult } from "./types.js";

export async function runCommand(args: { command: string; cwd: string; timeoutMs?: number }): Promise<ToolResult> {
  const { command, cwd, timeoutMs = 120_000 } = args;

  return new Promise((resolve) => {
    const child = spawn(command, [], { cwd, shell: true });
    let output = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ kind: "error", message: `Command timed out after ${timeoutMs}ms: ${command}` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ kind: "success", output, exitCode: code ?? 0 });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ kind: "error", message: err.message });
    });
  });
}