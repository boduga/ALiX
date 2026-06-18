/**
 * P4.5b — PlanningAgent: converts a WorkPackage into an ExecutionPlan.
 *
 * Governance-only — no code is written, only read-only file inspection.
 *
 * Flow:
 *   1. plan(workPackage) — read-only analysis, returns ExecutionPlan
 *   2. execute(workPackage, coordinator, writer) — plan + transition
 *      to PLANNED + record plan_generated evidence
 *
 * @module
 */

import { existsSync } from "node:fs";
import type { WorkflowCoordinator } from "../coordinator.js";
import type { EvidenceEventWriter } from "../evidence-writer.js";
import type { WorkPackage, ExecutionPlan, Subtask } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanRejectionCode =
  | "empty_work_package"
  | "no_acceptance_criteria"
  | "invalid_work_package";

export type PlanResult =
  | { success: true; plan: ExecutionPlan }
  | { success: false; error: string; code: PlanRejectionCode };

export type ExecuteResult =
  | { success: true; plan: ExecutionPlan; evidenceFingerprint?: string }
  | { success: false; error: string; code: PlanRejectionCode };

// ---------------------------------------------------------------------------
// PlanningAgent
// ---------------------------------------------------------------------------

export class PlanningAgent {
  private readonly branchNameFn: (issueNumber: number, title: string) => string;
  private readonly fileExistsFn: (path: string) => boolean;

  constructor(opts?: {
    branchNameFn?: (issueNumber: number, title: string) => string;
    fileExistsFn?: (path: string) => boolean;
  }) {
    this.branchNameFn = opts?.branchNameFn ?? defaultBranchName;
    this.fileExistsFn = opts?.fileExistsFn ?? existsSync;
  }

  // -----------------------------------------------------------------------
  // Plan
  // -----------------------------------------------------------------------

  /**
   * Read-only analysis: convert a WorkPackage into an ExecutionPlan.
   *
   * Validates the work package, decomposes acceptance criteria into subtasks,
   * distributes estimated files across subtasks, and generates branch names.
   */
  async plan(workPackage: WorkPackage): Promise<PlanResult> {
    // Validate work package
    const validation = this.validate(workPackage);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        code: validation.code,
      };
    }

    // Generate branch name
    const branchName = this.branchNameFn(
      workPackage.issueNumber,
      workPackage.issueTitle,
    );

    // Decompose acceptance criteria into subtasks
    const subtasks = this.buildSubtasks(workPackage);

    // Estimate commits: 1 per subtask + 1 for setup
    const estimatedCommits = subtasks.length + 1;

    const plan: ExecutionPlan = {
      workPackage,
      subtasks,
      branchName,
      estimatedCommits,
      approvalRequired: true,
    };

    return { success: true, plan };
  }

  /**
   * Full plan + execution: produces a plan, transitions to PLANNED,
   * and records plan_generated evidence.
   *
   * @param workPackage - The WorkPackage from IssueIntakeAgent
   * @param coordinator - WorkflowCoordinator for state transitions
   * @param writer      - EvidenceEventWriter for recording evidence
   */
  async execute(
    workPackage: WorkPackage,
    coordinator: WorkflowCoordinator,
    writer: EvidenceEventWriter,
  ): Promise<ExecuteResult> {
    const planResult = await this.plan(workPackage);
    if (!planResult.success) return planResult;

    try {
      // Record plan_generated evidence first
      const evidence = await writer.recordPlanGenerated(
        workPackage.issueNumber,
        {
          subtaskCount: planResult.plan.subtasks.length,
          estimatedFiles: planResult.plan.subtasks.flatMap((s) => [
            ...s.files,
            ...s.testFiles,
          ]),
        },
        {
          actor: "PlanningAgent",
          from: "SELECTED",
          to: "PLANNED",
        },
      );

      // Transition from SELECTED to PLANNED
      await coordinator.transition(workPackage.issueNumber, "PLANNED", {
        actor: "PlanningAgent",
        reason: `Plan: ${planResult.plan.subtasks.length} subtask(s), ${planResult.plan.estimatedCommits} commit(s)`,
      });

      return {
        success: true,
        plan: planResult.plan,
        evidenceFingerprint: evidence?.fingerprint,
      };
    } catch (err) {
      return {
        success: false,
        error: `Planning failed: ${err instanceof Error ? err.message : String(err)}`,
        code: "invalid_work_package",
      };
    }
  }

  // -----------------------------------------------------------------------
  // Private: Validation
  // -----------------------------------------------------------------------

  private validate(workPackage: WorkPackage): {
    valid: boolean;
    error?: string;
    code?: PlanRejectionCode;
  } {
    if (!workPackage) {
      return { valid: false, error: "WorkPackage is null or undefined", code: "empty_work_package" };
    }
    if (!workPackage.issueNumber || workPackage.issueNumber < 1) {
      return { valid: false, error: "WorkPackage has no valid issueNumber", code: "invalid_work_package" };
    }
    if (!workPackage.issueTitle || workPackage.issueTitle.trim().length === 0) {
      return { valid: false, error: "WorkPackage has no issueTitle", code: "invalid_work_package" };
    }
    if (!workPackage.acceptanceCriteria || workPackage.acceptanceCriteria.length === 0) {
      return { valid: false, error: "WorkPackage has no acceptance criteria", code: "no_acceptance_criteria" };
    }
    return { valid: true };
  }

  // -----------------------------------------------------------------------
  // Private: Subtask decomposition
  // -----------------------------------------------------------------------

  /**
   * Build a list of subtasks from the work package.
   *
   * Strategy:
   *   - One subtask per acceptance criterion
   *   - Files distributed round-robin from estimated files
   *   - Each subtask depends on the previous one (sequential)
   *   - Test files derived from source files
   *   - Acceptance check derived from the AC description
   */
  private buildSubtasks(workPackage: WorkPackage): Subtask[] {
    const subtasks: Subtask[] = [];
    const criteria = workPackage.acceptanceCriteria;
    const files = workPackage.estimatedFiles;
    const totalACs = criteria.length;

    // Add a setup subtask if there are any files to prepare
    if (files.length > 0) {
      subtasks.push({
        id: "step-0",
        description: `Set up project structure for ${workPackage.issueTitle.slice(0, 60)}`,
        files: files.slice(0, 1), // first file for setup
        testFiles: [],
        acceptanceCheck: "Project structure is ready for implementation",
        dependsOn: [],
      });
    }

    for (let i = 0; i < totalACs; i++) {
      const stepNum = subtasks.length + 1;
      const ac = criteria[i];

      // Distribute files round-robin across AC subtasks
      const acFiles = files.filter((_, fi) => (fi % totalACs) === i);

      // Derive test files from source files
      const testFiles = acFiles
        .map((f) => this.deriveTestFile(f))
        .filter((f): f is string => f !== null);

      subtasks.push({
        id: `step-${stepNum}`,
        description: ac,
        files: acFiles,
        testFiles,
        acceptanceCheck: this.buildAcceptanceCheck(ac, acFiles),
        dependsOn: subtasks.length > 0
          ? [subtasks[subtasks.length - 1].id]
          : [],
      });
    }

    return subtasks;
  }

  // -----------------------------------------------------------------------
  // Private: Helpers
  // -----------------------------------------------------------------------

  /**
   * Derive a test file path from a source file path.
   *   src/foo.ts          → tests/foo.test.ts
   *   src/bar/baz.tsx     → tests/bar/baz.test.tsx
   *   tests/foo.test.ts   → null (already a test file)
   */
  private deriveTestFile(filePath: string): string | null {
    if (filePath.includes(".test.") || filePath.includes("tests/") || filePath.includes("__tests__")) {
      return null;
    }

    const srcPrefixes = ["src/", "lib/", "app/"];
    for (const prefix of srcPrefixes) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        const ext = relative.match(/\.(\w+)$/)?.[1] ?? "";
        const base = relative.slice(0, -(ext.length + 1));
        return `tests/${base}.test.${ext}`;
      }
    }

    // Fallback: prepend tests/ and insert .test before extension
    const ext = filePath.match(/\.(\w+)$/)?.[1] ?? "";
    const base = ext ? filePath.slice(0, -(ext.length + 1)) : filePath;
    return `tests/${base}.test.${ext}`;
  }

  /**
   * Build an acceptance check string for a subtask.
   * Describes how to verify the subtask is complete.
   */
  private buildAcceptanceCheck(
    _ac: string,
    files: string[],
  ): string {
    const fileList = files.length > 0
      ? `Files: ${files.join(", ")}. `
      : "";
    return `${fileList}Run tests to verify implementation meets acceptance criteria.`;
  }
}

// ---------------------------------------------------------------------------
// Default branch name generator
// ---------------------------------------------------------------------------

function defaultBranchName(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `feature/issue-${issueNumber}-${slug}`;
}
