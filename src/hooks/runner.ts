import { spawn } from "node:child_process";
import type { Hook } from "./discover.js";
import { buildChildEnv } from "../runtime/child-env.js";

/**
 * Run one hook command via /bin/sh.
 *
 * @param extraEnv — caller run context (e.g. ALIX_RUN_ID/ALIX_SESSION_ID/
 *   ALIX_RUN_STATUS). Merged UNDER hook.env so explicit hook config wins.
 *   The shell expands `$VAR` natively — no interpolation step needed.
 *   Absent by default: existing callers behave exactly as before.
 */
export async function runHook(hook: Hook, cwd: string, extraEnv: Record<string, string> = {}): Promise<{ passed: boolean; output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("/bin/sh", ["-c", hook.command], {
      cwd,
      env: buildChildEnv(undefined, { ...extraEnv, ...hook.env }),
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
