/**
 * subagent-failed-result-stdout.vitest.ts — the delegate failure contract.
 *
 * SubagentManager.spawn() parses the child's final result from STDOUT ONLY. The
 * child's catch path used to write its structured failed result to stderr, so
 * the parent never saw it: it fell back to the raw exit code and rejected with
 * a bare error string, discarding the `status`, `findings` and `error` the
 * child had actually produced.
 *
 * This test runs the real child process through the real CLI entry point and
 * asserts the contract end to end: a structured failure must be parseable from
 * stdout. It does not touch the network — the provider is the scripted mock,
 * which raises deterministically.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installEvalConfig } from "../../src/operations/evals/evals-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const cliEntry = join(repoRoot, "dist", "src", "agents", "subagent-cli.js");

/** Parse the last JSON line of stdout, exactly as SubagentManager.spawn does. */
function lastJsonLine(stdout: string): unknown | null {
  const lines = stdout.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* skip non-JSON lines */
    }
  }
  return null;
}

/**
 * Run the child the way the real parent does: stdin is a PIPE that stays OPEN
 * for the child's lifetime. The child installs a parent-liveness watchdog that
 * terminates when stdin reaches EOF, so closing stdin early would abort the run
 * before the result is emitted — that would be testing the watchdog, not the
 * result contract.
 */
function runChildWithOpenStdin(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", d => { stdout += d.toString(); });
    child.stderr?.on("data", d => { stderr += d.toString(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    // Deliberately do NOT end stdin.
  });
}

describe("subagent CLI — failed result reaches the parent on stdout", () => {
  it("build output exists (skip if the suite was not built)", () => {
    // A missing build is an environment problem, not a contract failure, but we
    // do not silently pass: the assertion is explicit about which it is.
    if (!existsSync(cliEntry)) {
      throw new Error(`dist build missing at ${cliEntry} — run tsc before this suite`);
    }
    expect(existsSync(cliEntry)).toBe(true);
  });

  it("emits a parseable structured failed result on stdout in json mode", async () => {
    // The scripted provider raises on the first step, forcing the catch path.
    const scenario = JSON.stringify({
      steps: [{ kind: "error", error: "malformed tool call: missing required argument 'path'" }],
    });

    // The child resolves its provider from `.alix/config.json` in its cwd, so
    // run it in an isolated eval cwd with the scripted-mock config installed —
    // exactly how the runner sets up a delegate case.
    const cwd = mkdtempSync(join(tmpdir(), "eval-stdout-"));
    installEvalConfig(cwd);

    try {
      const proc = await runChildWithOpenStdin(
        [cliEntry, "--subagent", "worker", "--task-id", "regression-stdout", "--session-id", "regression-session", "--prompt", "do the thing", "--output", "json"],
        { ...process.env, ALIX_EVAL_SCENARIO: scenario },
        cwd,
      );

      const parsed = lastJsonLine(proc.stdout) as
        | { status?: string; error?: string }
        | null;

      // The contract under test: the parent can parse the child's failure.
      expect(parsed, `stdout was:\n${proc.stdout}\n\nstderr was:\n${proc.stderr}`).not.toBeNull();
      expect(parsed?.status).toBe("failed");
      expect(typeof parsed?.error).toBe("string");
      expect(parsed?.error).toContain("malformed tool call");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 180_000);
});
