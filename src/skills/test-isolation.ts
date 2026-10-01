// src/skills/test-isolation.ts
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";

/**
 * Why isolation is refused for a given root.
 *
 * The isolation contract is "protect uncommitted work from the command". It
 * only holds when the command is not supposed to be looking AT that work.
 * Verifying an agent's edits is exactly that case: stashing the edits and
 * running the suite verifies the tree from BEFORE the change.
 */
export type IsolationRefusal =
  | "not-a-repository"
  | "not-owned-by-verification"
  | "isolation-not-requested";

/**
 * True only when this root is a scratch/verification sandbox that isolation may
 * freely stash in.
 *
 * Deliberately NOT "any git repository". The blast radius of getting this wrong
 * is a developer's or an agent's uncommitted work sitting in a stash that
 * nothing reports, so the safe answer is to refuse and run the command
 * in-place. Isolation is an optimisation for a verification run in a scratch
 * directory; it is never a reason to touch a real working tree.
 */
export function isVerificationSandbox(root: string): boolean {
  const resolved = resolve(root);
  // Explicit opt-in: a caller that knows what it owns may name it. This is the
  // only general escape hatch, and it is checked against the RESOLVED path so
  // it cannot be satisfied by naming a parent.
  if (process.env.ALIX_VERIFY_ISOLATION_ROOT === resolved) return true;
  const parts = resolved.split(sep);
  const leaf = parts[parts.length - 1] ?? "";
  // Deliberately NOT "anything under /tmp". A temp directory is not evidence
  // of anything: this repo runs real agent work and real git repos in temp
  // dirs, and the workspace itself may live there. The only structural signal
  // trusted is a directory NAMED as a verification sandbox.
  return leaf === "verify-sandbox"
    || resolved.includes(`${sep}node_modules${sep}`)
    || resolved.includes(`${sep}.alix${sep}verify`);
}

function gitStashList(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("git", ["stash", "list"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d.toString()));
    proc.stderr?.on("data", (d) => (output += d.toString()));
    proc.on("close", () => resolve(output));
    proc.on("error", () => resolve(""));
  });
}

function gitStashCount(cwd: string): Promise<number> {
  return gitStashList(cwd).then((list) => list.trim().split("\n").filter(Boolean).length);
}

/**
 * Stash working tree changes before running verification.
 * Returns stashId for later restore. Returns null if nothing to stash.
 *
 * REFUSES for any root that is not an explicit verification sandbox. This is
 * the guard that stops a test run or a verification pass from stashing a real
 * working tree: `git stash push` there moves uncommitted work — an agent's
 * edits, a developer's WIP — out of the tree for the duration of a command,
 * and nothing surfaces it if the restore fails.
 */
export async function stashChanges(cwd: string): Promise<string | null> {
  if (!isVerificationSandbox(cwd)) return null;
  const beforeCount = await gitStashCount(cwd);
  return new Promise((resolve) => {
    const proc = spawn("git", ["stash", "push", "-m", "skill-factory-isolation"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d.toString()));
    proc.stderr?.on("data", (d) => (output += d.toString()));
    proc.on("close", () => {
      if (output.includes("No local changes to save") || output.includes("fatal:")) {
        resolve(null);
      } else {
        resolve(`stash@{${beforeCount}}`);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

/**
 * Restore stashed changes after verification completes.
 */
export async function restoreChanges(cwd: string, stashId: string | null): Promise<boolean> {
  if (!stashId) return true;
  return new Promise((resolve) => {
    const proc = spawn("git", ["stash", "pop", "--index"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d.toString()));
    proc.stderr?.on("data", (d) => (output += d.toString()));
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Run a verification command with git stash/restore isolation.
 * Stashes changes, runs command, restores changes.
 */
export async function runWithIsolation(
  cwd: string,
  command: string,
  timeoutMs = 120000
): Promise<{ passed: boolean; output: string; stashId: string | null; isolated: boolean }> {
  const stashId = await stashChanges(cwd);
  const isolated = stashId !== null;
  let passed = false;
  let output = "";

  try {
    output = await runCommand(command, cwd, timeoutMs);
    passed = true;
  } catch (err) {
    output = String(err);
  } finally {
    await restoreChanges(cwd, stashId);
  }

  return { passed, output, stashId, isolated };
}

function runCommand(cmd: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("/bin/sh", ["-c", cmd], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d.toString()));
    proc.stderr?.on("data", (d) => (output += d.toString()));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`Command failed with code ${code}: ${output}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}