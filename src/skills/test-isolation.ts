// src/skills/test-isolation.ts
import { spawn } from "node:child_process";

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
 */
export async function stashChanges(cwd: string): Promise<string | null> {
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
): Promise<{ passed: boolean; output: string; stashId: string | null }> {
  const stashId = await stashChanges(cwd);
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

  return { passed, output, stashId };
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