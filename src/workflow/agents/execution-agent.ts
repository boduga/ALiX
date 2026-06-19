/**
 * P4.5g — ExecutionAgent: one-subtask-at-a-time execution with test gating.
 *
 * The LAST P4.5 component — crosses the trust boundary into repo modification.
 * Governed by three concentric safety rings:
 *
 *   Ring 1: Governance (Intake/Planning/Review/PR)
 *   Ring 2: Workflow control (Coordinator/Evidence/Human gates)
 *   Ring 3: Execution safety (permit, protected paths, test gate, stop-on-fail)
 *
 * Flow per subtask:
 *   record started → validate files → write files → run tests
 *     → tests pass? → commit → record completed → next subtask
 *     → tests fail? → STOP → ReviewAgent reports
 *
 * Key rule: No auto-repair. No retry loop. Stop on first failure.
 *
 * @module
 */

import type { WorkflowCoordinator } from "../coordinator.js";
import type { EvidenceEventWriter } from "../evidence-writer.js";
import type {
  ExecutionPlan,
  Subtask,
  ExecutionPermit,
} from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionErrorCode =
  | "no_permit"
  | "permit_mismatch"
  | "protected_path"
  | "file_not_allowed"
  | "tests_failed"
  | "commit_failed"
  | "invalid_plan";

export interface TestResult {
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface SubtaskResult {
  subtaskId: string;
  success: boolean;
  commitSha?: string;
  error?: string;
  errorCode?: ExecutionErrorCode;
}

export type ExecuteResult =
  | { success: true; results: SubtaskResult[] }
  | { success: false; error: string; code: ExecutionErrorCode; results: SubtaskResult[] };

export interface ExecutionAgentOptions {
  /** Write content to a file. Default: fs.writeFile */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** Run tests for given test files. Default: calls npx vitest */
  runTests?: (testFiles: string[], cwd: string) => Promise<TestResult>;
  /** Git commit and return SHA. Default: git add + git commit */
  gitCommit?: (files: string[], message: string, cwd: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Protected paths — enforced BEFORE any write
// ---------------------------------------------------------------------------

const PROTECTED_PATHS = [
  "src/security/",
  "src/config/",
  "src/agents/",
  "src/workflow/",
  ".alix/",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
];

// ---------------------------------------------------------------------------
// ExecutionAgent
// ---------------------------------------------------------------------------

export class ExecutionAgent {
  private readonly writeFile: (path: string, content: string) => Promise<void>;
  private readonly runTests: (testFiles: string[], cwd: string) => Promise<TestResult>;
  private readonly gitCommit: (files: string[], message: string, cwd: string) => Promise<string>;

  constructor(private readonly opts?: ExecutionAgentOptions) {
    this.writeFile = opts?.writeFile ?? defaultWriteFile;
    this.runTests = opts?.runTests ?? defaultRunTests;
    this.gitCommit = opts?.gitCommit ?? defaultGitCommit;
  }

  // -----------------------------------------------------------------------
  // Execute full plan
  // -----------------------------------------------------------------------

  /**
   * Execute every subtask in the plan, one at a time.
   *
   * Requires an ExecutionPermit matching the plan. Each subtask goes
   * through: validate → write → test → commit → evidence.
   *
   * Stops on first failure. No auto-repair.
   */
  async execute(
    plan: ExecutionPlan,
    coordinator: WorkflowCoordinator,
    writer: EvidenceEventWriter,
    permit: ExecutionPermit,
  ): Promise<ExecuteResult> {
    const results: SubtaskResult[] = [];
    const issueNumber = plan.workPackage.issueNumber;
    const cwd = process.cwd();

    // ── Validate permit ────────────────────────────────────────────
    if (!permit) {
      return { success: false, error: "No ExecutionPermit provided", code: "no_permit", results };
    }
    if (permit.issueNumber !== issueNumber) {
      return {
        success: false,
        error: `Permit issue #${permit.issueNumber} does not match plan #${issueNumber}`,
        code: "permit_mismatch",
        results,
      };
    }

    try {
      // Transition APPROVED_FOR_EXECUTION → EXECUTING
      await coordinator.transition(issueNumber, "EXECUTING", {
        actor: "ExecutionAgent",
        reason: `Executing plan with ${plan.subtasks.length} subtask(s)`,
      });
    } catch {
      // If the issue isn't in APPROVED_FOR_EXECUTION, this fails
      return {
        success: false,
        error: "Cannot start execution: issue must be in APPROVED_FOR_EXECUTION state",
        code: "invalid_plan",
        results,
      };
    }

    // ── Execute each subtask ───────────────────────────────────────
    for (const subtask of plan.subtasks) {
      const stepResult = await this.executeSubtask(
        subtask,
        permit,
        coordinator,
        writer,
        issueNumber,
        cwd,
      );
      results.push(stepResult);

      if (!stepResult.success) {
        // Stop on first failure — no auto-repair
        return {
          success: false,
          error: stepResult.error ?? `Subtask ${subtask.id} failed`,
          code: stepResult.errorCode ?? "tests_failed",
          results,
        };
      }
    }

    // ── All subtasks complete — transition to UNDER_REVIEW ─────────
    await coordinator.transition(issueNumber, "UNDER_REVIEW", {
      actor: "ExecutionAgent",
      reason: "All subtasks completed successfully",
    });

    await writer.recordExecutionCompleted(issueNumber, {
      commitSha: results[results.length - 1]?.commitSha ?? "",
      filesChanged: plan.subtasks.reduce((sum, s) => sum + s.files.length, 0),
    });

    return { success: true, results };
  }

  // -----------------------------------------------------------------------
  // Execute single subtask
  // -----------------------------------------------------------------------

  private async executeSubtask(
    subtask: Subtask,
    permit: ExecutionPermit,
    coordinator: WorkflowCoordinator,
    writer: EvidenceEventWriter,
    issueNumber: number,
    cwd: string,
  ): Promise<SubtaskResult> {
    // ── Record started ─────────────────────────────────────────
    await writer.recordSubtaskStarted(issueNumber, {
      subtaskId: subtask.id,
      files: subtask.files,
    });

    // ── Validate: all files are in permit.allowedFiles ─────────
    for (const file of subtask.files) {
      if (!permit.allowedFiles.includes(file)) {
        return {
          subtaskId: subtask.id,
          success: false,
          error: `File "${file}" is not in the ExecutionPermit's allowed list`,
          errorCode: "file_not_allowed",
        };
      }
    }

    // ── Validate: no protected paths ───────────────────────────
    for (const file of subtask.files) {
      for (const pp of PROTECTED_PATHS) {
        if (file.startsWith(pp)) {
          return {
            subtaskId: subtask.id,
            success: false,
            error: `File "${file}" is in protected path "${pp}"`,
            errorCode: "protected_path",
          };
        }
      }
    }

    // ── Write files ────────────────────────────────────────────
    for (const file of subtask.files) {
      await this.writeFile(file, "");
    }

    // ── Run tests ──────────────────────────────────────────────
    if (subtask.testFiles.length > 0) {
      const testResult = await this.runTests(subtask.testFiles, cwd);
      if (!testResult.passed) {
        await writer.recordTestFailed(issueNumber, {
          subtaskId: subtask.id,
          testFiles: subtask.testFiles,
          error: testResult.error ?? "unknown",
        });
        return {
          subtaskId: subtask.id,
          success: false,
          error: `Tests failed for subtask ${subtask.id}: ${testResult.error ?? "unknown"}`,
          errorCode: "tests_failed",
        };
      }
      await writer.recordTestPassed(issueNumber, {
        subtaskId: subtask.id,
        testFiles: subtask.testFiles,
        durationMs: testResult.durationMs,
      });
    }

    // ── Git commit ─────────────────────────────────────────────
    let commitSha: string | undefined;
    try {
      commitSha = await this.gitCommit(
        subtask.files,
        `${subtask.id}: ${subtask.description.slice(0, 60)}`,
        cwd,
      );
    } catch {
      return {
        subtaskId: subtask.id,
        success: false,
        error: `Git commit failed for subtask ${subtask.id}`,
        errorCode: "commit_failed",
      };
    }

    await writer.recordCommitCreated(issueNumber, {
      subtaskId: subtask.id,
      commitSha,
      files: subtask.files,
    });

    // ── Record completed ───────────────────────────────────────
    await writer.recordSubtaskCompleted(issueNumber, {
      subtaskId: subtask.id,
      commitSha,
      filesChanged: subtask.files.length,
    });

    return {
      subtaskId: subtask.id,
      success: true,
      commitSha,
    };
  }
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

async function defaultWriteFile(path: string, content: string): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

async function defaultRunTests(
  testFiles: string[],
  cwd: string,
): Promise<TestResult> {
  const { execSync } = await import("node:child_process");
  const start = Date.now();
  try {
    const files = testFiles.join(" ");
    execSync(`npx vitest run ${files} --config vitest.config.mts`, {
      cwd,
      encoding: "utf-8",
      timeout: 60000,
      stdio: "pipe",
    });
    return { passed: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      passed: false,
      durationMs: Date.now() - start,
      error: String(err),
    };
  }
}

async function defaultGitCommit(
  files: string[],
  message: string,
  cwd: string,
): Promise<string> {
  const { execSync } = await import("node:child_process");
  execSync(`git add ${files.join(" ")}`, { cwd, encoding: "utf-8" });
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
    cwd,
    encoding: "utf-8",
  });
  const sha = execSync("git rev-parse HEAD", {
    cwd,
    encoding: "utf-8",
  }).trim();
  return sha;
}
