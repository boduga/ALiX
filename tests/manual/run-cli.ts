/**
 * Shared helper for running ALiX CLI in automated tests.
 * Uses the dist/src/cli.js entry point directly (bypasses heap wrapper).
 */
import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Resolve paths relative to project root (CWD for all tests)
export const PROJECT_ROOT = process.cwd();
export const CLI_PATH = join(PROJECT_ROOT, "dist", "src", "cli.js");

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run an ALiX CLI command and return the result.
 * Sets up project root as CWD so .alix/ config is found.
 */
export function runCli(
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
): CliResult {
  const cwd = opts?.cwd ?? PROJECT_ROOT;
  const cmd = [process.execPath, CLI_PATH, ...args].join(" ");
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf8",
      timeout: opts?.timeoutMs ?? 30_000,
      env: { ...process.env, ...opts?.env, ALIX_MAX_HEAP: "1024" },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: stdout.trim(), stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: (err.stdout ?? "").toString().trim(),
      stderr: (err.stderr ?? "").toString().trim(),
    };
  }
}

/**
 * Create a temp directory for tests that need isolation.
 * Returns path and a cleanup function.
 */
export function tempDir(prefix = "alix-test-"): { path: string; cleanup: () => void } {
  const path = join(tmpdir(), `${prefix}${randomUUID().slice(0, 8)}`);
  mkdirSync(path, { recursive: true });
  return {
    path,
    cleanup: () => { try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
}

/**
 * Run `alix init` in a directory and return the result.
 */
export function initProject(dir: string): CliResult {
  return runCli(["init"], { cwd: dir, timeoutMs: 15_000 });
}

/**
 * Check if a path exists within a test directory.
 */
export function pathExists(dir: string, ...paths: string[]): boolean {
  return existsSync(join(dir, ...paths));
}

/** Skip integration tests that need a real model */
export const needsModel = { skip: "requires model API credentials" } as const;

/** Skip tests that need interactive terminal */
export const needsTty = { skip: "requires interactive TTY" } as const;

/** Skip tests that need BRAVE_API_KEY */
export const needsBrave = process.env.BRAVE_API_KEY
  ? undefined
  : { skip: "requires BRAVE_API_KEY env var" } as const;

/** Assert stdout contains a substring */
export function assertOutputContains(result: CliResult, expected: string, label = "output"): void {
  if (!result.stdout.includes(expected) && !result.stderr.includes(expected)) {
    throw new Error(`Expected ${label} to contain "${expected}"\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`);
  }
}

/** Assert stdout does NOT contain a substring */
export function assertOutputNotContains(result: CliResult, unexpected: string, label = "output"): void {
  if (result.stdout.includes(unexpected) || result.stderr.includes(unexpected)) {
    throw new Error(`Expected ${label} NOT to contain "${unexpected}"\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`);
  }
}

/** Assert exit code is 0 (success) */
export function assertSuccess(result: CliResult): void {
  if (result.exitCode !== 0) {
    throw new Error(`Expected exit code 0, got ${result.exitCode}\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`);
  }
}
