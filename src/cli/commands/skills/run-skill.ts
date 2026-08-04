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
export async function runSkillCommand(name: string, script: string, args: string[]): Promise<void> {
  if (!name || !script) {
    console.error("Usage: alix skills run <skill> <script> [args...]");
    process.exitCode = 1;
    return;
  }
  const safety = await loadSafetyConfig();
  const homeDir = process.env.HOME ?? "";
  const skillDir = join(homeDir, ".alix", "skills", name);
  if (!existsSync(join(skillDir, "SKILL.md"))) {
    throw new Error(`Skill '${name}' is not installed.`);
  }
  const scriptPath = join(skillDir, "scripts", script);
  if (!existsSync(scriptPath)) {
    throw new Error(`Skill '${name}' has no script '${script}' in scripts/.`);
  }
  const result = await runSandboxed(scriptPath, { args, noNetwork: safety.denyNetwork, timeoutMs: safety.sandboxTimeoutMs });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.networkIsolated) {
    console.error("[skills] warning: network isolation unavailable (unshare failed); used env-only isolation.");
  }
  process.exitCode = result.ok ? 0 : (result.exitCode ?? 1);
}
