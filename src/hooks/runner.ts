import { spawn } from "node:child_process";
import type { Hook } from "./discover.js";

export async function runHook(hook: Hook, cwd: string): Promise<{ passed: boolean; output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("/bin/sh", ["-c", hook.command], {
      cwd,
      env: { ...process.env, ...hook.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "";
    proc.stdout?.on("data", d => out += d.toString());
    proc.stderr?.on("data", d => out += d.toString());
    proc.on("close", (code) => {
      resolve({ passed: code === 0, output: out, exitCode: code ?? -1 });
    });
    proc.on("error", () => resolve({ passed: false, output: "", exitCode: -1 }));
  });
}