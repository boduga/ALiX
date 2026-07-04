/**
 * issue-verification-runner.ts — P11.9 verification command runner.
 *
 * Defines recommended verification commands and optionally executes them
 * when --verify is passed, with allowlist/blocklist safety checks.
 */

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationStatus = "skipped" | "pass" | "fail" | "blocked" | "timeout";

export interface VerificationCommand {
  label: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface VerificationConfig {
  /** Whether verification is enabled at all. */
  enabled: boolean;
  /** When true, show recommended commands without executing. */
  dryRun: boolean;
  /** Commands to run (default if empty). */
  commands: VerificationCommand[];
  /** Command prefixes that are always allowed. */
  allowedPrefixes: string[];
  /** Command prefixes that are always blocked. */
  blockedPrefixes: string[];
  /** Default timeout per command in ms. */
  timeoutMs: number;
}

export interface VerificationResult {
  status: VerificationStatus;
  command: string;
  label: string;
  exitCode?: number;
  durationMs?: number;
  summary?: string;
  failureReason?: string;
}

export interface VerificationSuiteResult {
  status: VerificationStatus;
  results: VerificationResult[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_VERIFICATION_COMMANDS: VerificationCommand[] = [
  { label: "Build", command: "pnpm build", timeoutMs: 120_000 },
  { label: "TypeScript typecheck", command: "pnpm typecheck", timeoutMs: 60_000 },
  { label: "Tests", command: "pnpm test:vitest", timeoutMs: 300_000 },
];

const DEFAULT_ALLOWED_PREFIXES = [
  "pnpm build",
  "pnpm typecheck",
  "pnpm test",
  "pnpm lint",
  "npm run build",
  "npm run typecheck",
  "npm test",
  "make build",
  "make test",
  "cargo build",
  "cargo test",
  "go build",
  "go test",
];

const DEFAULT_BLOCKED_PREFIXES = [
  "rm -rf",
  "rm -r",
  "sudo",
  "chmod",
  "chown",
  "git push",
  "git commit",
  "gh pr",
  "npm publish",
  "pnpm publish",
];

const DEFAULT_CONFIG: VerificationConfig = {
  enabled: true,
  dryRun: true,
  commands: DEFAULT_VERIFICATION_COMMANDS,
  allowedPrefixes: DEFAULT_ALLOWED_PREFIXES,
  blockedPrefixes: DEFAULT_BLOCKED_PREFIXES,
  timeoutMs: 300_000,
};

// ---------------------------------------------------------------------------
// Command validation
// ---------------------------------------------------------------------------

/**
 * Check whether a command is safe to execute based on allowlist/blocklist.
 */
export function isCommandAllowed(command: string, config: VerificationConfig): { allowed: boolean; reason?: string } {
  for (const blocked of config.blockedPrefixes) {
    if (command.startsWith(blocked)) {
      return { allowed: false, reason: `Command blocked: matches '${blocked}' prefix` };
    }
  }

  if (config.allowedPrefixes.length > 0) {
    const allowed = config.allowedPrefixes.some((p) => command.startsWith(p));
    if (!allowed) {
      return { allowed: false, reason: "Command not in allowed prefix list" };
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a single verification command with timeout.
 * Returns a structured VerificationResult (never throws).
 */
export function runVerificationCommand(
  cmd: VerificationCommand,
  config: VerificationConfig,
): VerificationResult {
  const start = Date.now();
  const fullCommand = cmd.command;

  // Check allowlist/blocklist
  const check = isCommandAllowed(fullCommand, config);
  if (!check.allowed) {
    return {
      status: "blocked",
      command: fullCommand,
      label: cmd.label,
      failureReason: check.reason,
    };
  }

  const timeoutMs = cmd.timeoutMs ?? config.timeoutMs;

  try {
    const output = execSync(fullCommand, {
      encoding: "utf-8",
      timeout: timeoutMs,
      cwd: cmd.cwd ?? process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const durationMs = Date.now() - start;
    return {
      status: "pass",
      command: fullCommand,
      label: cmd.label,
      exitCode: 0,
      durationMs,
      summary: output.trim().split("\n").pop()?.slice(0, 200) ?? "OK",
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    if (err instanceof Error && err.message.includes("timed out")) {
      return {
        status: "timeout",
        command: fullCommand,
        label: cmd.label,
        durationMs,
        failureReason: `Timed out after ${timeoutMs}ms`,
      };
    }
    // Extract exit code from execSync error
    const exitCode = (err as any)?.status ?? 1;
    const stderr = (err as any)?.stderr ?? "";
    return {
      status: "fail",
      command: fullCommand,
      label: cmd.label,
      exitCode,
      durationMs,
      summary: String(stderr).trim().slice(0, 200) || "Command failed",
      failureReason: `Exit code ${exitCode}`,
    };
  }
}

/**
 * Run all verification commands and return a suite result.
 * Runs commands sequentially, stopping on first failure.
 */
export function runVerificationSuite(
  commands: VerificationCommand[],
  config: VerificationConfig,
): VerificationSuiteResult {
  const results: VerificationResult[] = [];

  for (const cmd of commands) {
    const result = runVerificationCommand(cmd, config);
    results.push(result);
    if (result.status === "fail" || result.status === "blocked") {
      return {
        status: result.status,
        results,
        summary: `Verification halted at "${cmd.label}": ${result.failureReason ?? result.status}`,
      };
    }
    if (result.status === "timeout") {
      return {
        status: "timeout",
        results,
        summary: `Verification halted at "${cmd.label}": timed out`,
      };
    }
  }

  const allPassed = results.every((r) => r.status === "pass");
  return {
    status: allPassed ? "pass" : "fail",
    results,
    summary: allPassed
      ? `All ${results.length} verification command(s) passed`
      : `${results.filter((r) => r.status !== "pass").length} verification command(s) failed`,
  };
}
