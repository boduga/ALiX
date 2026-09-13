import { join } from "node:path";
import { existsSync } from "node:fs";
import { runSandboxed } from "../../../skills/sandbox.js";
import { loadSafetyConfig } from "../../../skills/safety-config.js";

/**
 * `alix skills run <name> <script> [args...]` — run one of a skill's scripts
 * in the Layer-4 sandbox (temp HOME, filtered env, timeout, best-effort no
 * network). Skill scripts are otherwise executed by the agent's shell tool
 * with the user's full environment; this is the sanctioned isolated runner.
 */

/**
 * Resolve a user-supplied script name to the skill's scripts/ dir, refusing
 * path traversal. Only a bare file name is accepted — any path separator,
 * absolute path, `..`/`.` and empty names are rejected outright, so `../evil`
 * can never resolve outside `scripts/`.
 */
export function resolveSkillScriptPath(skillDir: string, script: string): string {
  const invalid =
    !script ||
    script === "." ||
    script === ".." ||
    script.includes("/") ||
    script.includes("\\") ||
    script.startsWith("~");
  if (invalid) {
    throw new Error(`Invalid script name '${script}' — expected a bare file name inside scripts/.`);
  }
  return join(skillDir, "scripts", script);
}

export interface RunSkillOptions {
  /** Pin resolution to <cwd>/.alix/skills. */
  project?: boolean;
  /** Pin resolution to ~/.alix/skills (part of the default union). */
  global?: boolean;
  /** Project root for --project (defaults to process.cwd()). Test seam. */
  cwd?: string;
}

export async function runSkillCommand(
  name: string,
  script: string,
  args: string[],
  opts?: RunSkillOptions,
): Promise<void> {
  if (!name || !script) {
    console.error("Usage: alix skills run <skill> <script> [args...]");
    process.exitCode = 1;
    return;
  }
  if (opts?.project && opts?.global) {
    throw new Error("Usage: pass either --project or --global, not both");
  }
  const safety = await loadSafetyConfig();
  const homeDir = process.env.HOME ?? "";
  const cwd = opts?.cwd ?? process.cwd();
  const { resolveDiscoveredSkillDir, getProjectSkillsDir } = await import("../../../skills/discovery.js");
  // --project pins the project-local store; otherwise resolve across the
  // user-global store + shared agents dir (the pre-scope default union).
  let skillDir: string | null;
  if (opts?.project) {
    const dir = join(getProjectSkillsDir(cwd), name);
    skillDir = existsSync(join(dir, "SKILL.md")) ? dir : null;
  } else {
    skillDir = resolveDiscoveredSkillDir(name, homeDir);
  }
  if (!skillDir) {
    throw new Error(`Skill '${name}' is not installed.`);
  }
  const scriptPath = resolveSkillScriptPath(skillDir, script);
  if (!existsSync(scriptPath)) {
    throw new Error(`Skill '${name}' has no script '${script}' in scripts/.`);
  }
  const result = await runSandboxed(scriptPath, {
    args,
    noNetwork: safety.denyNetwork,
    failClosedOnNetworkFailure: safety.requireNetworkIsolation,
    timeoutMs: safety.sandboxTimeoutMs,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.networkIsolationFailed) {
    // The network boundary was requested (denyNetwork) but not delivered. Make
    // this impossible to miss: distinct message, and when requireNetworkIsolation
    // is set the sandbox already refused to run and stderr carries the reason.
    console.error(
      "[skills] SECURITY WARNING: network isolation was requested but could not be established " +
        "(unshare unavailable or user namespaces blocked); the script ran with env-only isolation. " +
        "Set skills.safety.requireNetworkIsolation=true to fail closed instead.",
    );
  }
  process.exitCode = result.ok ? 0 : (result.exitCode ?? 1);
}
