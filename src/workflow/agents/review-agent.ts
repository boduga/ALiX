/**
 * P4.5e — ReviewAgent: independent review of ExecutionPlans.
 *
 * Governance-only — no code is written or inspected. The agent validates
 * plan completeness, governance invariants, and risk.
 *
 * This implements the core ALiX invariant from P4.3-S:
 *   Author ≠ Reviewer
 *
 * Flow:
 *   1. review(executionPlan) — read-only analysis, returns ReviewReport
 *   2. execute(executionPlan, coordinator, writer) — review + transition
 *      + record review_completed evidence
 *
 * @module
 */

import type { WorkflowCoordinator } from "../coordinator.js";
import type { EvidenceEventWriter } from "../evidence-writer.js";
import type {
  ExecutionPlan,
  ReviewReport,
  ReviewFinding,
  ReviewSeverity,
} from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewRejectionCode =
  | "missing_plan"
  | "invalid_plan";

export type ReviewResult =
  | { success: true; report: ReviewReport }
  | { success: false; error: string; code: ReviewRejectionCode };

export type ReviewExecuteResult =
  | { success: true; report: ReviewReport; evidenceFingerprint?: string }
  | { success: false; error: string; code: ReviewRejectionCode };

// ---------------------------------------------------------------------------
// Protected paths — ALiX must never modify these autonomously
// ---------------------------------------------------------------------------

const PROTECTED_PATHS = [
  ".alix/",
  "src/config/",
  "src/security/",
  "CLAUDE.md",
  "AGENTS.md",
  "CONTEXT.md",
];

// ---------------------------------------------------------------------------
// ReviewAgent
// ---------------------------------------------------------------------------

export class ReviewAgent {
  /**
   * Read-only review: analyze an ExecutionPlan and produce a ReviewReport.
   *
   * Performs:
   *   - Plan completeness: subtasks cover all ACs, files assigned
   *   - Governance checks: approvalRequired, protected paths
   *   - Risk assessment: scope, dependencies, test coverage gaps
   */
  async review(executionPlan: ExecutionPlan): Promise<ReviewResult> {
    // Validate plan
    if (!executionPlan) {
      return {
        success: false,
        error: "ExecutionPlan is null or undefined",
        code: "missing_plan",
      };
    }
    if (!executionPlan.workPackage) {
      return {
        success: false,
        error: "ExecutionPlan has no WorkPackage",
        code: "invalid_plan",
      };
    }

    const findings: ReviewFinding[] = [];
    const wp = executionPlan.workPackage;

    // ── Governance checks ───────────────────────────────────────────

    // approvalRequired must be true
    if (!executionPlan.approvalRequired) {
      findings.push({
        severity: "critical",
        file: "plan",
        summary: "Plan does not require human approval",
        recommendation:
          "Set approvalRequired: true before submitting for execution",
      });
    }

    // Check for protected path violations
    for (const subtask of executionPlan.subtasks) {
      for (const file of subtask.files) {
        for (const protectedPath of PROTECTED_PATHS) {
          if (file.startsWith(protectedPath)) {
            findings.push({
              severity: "critical",
              file,
              summary: `File is in protected path: ${protectedPath}`,
              recommendation:
                "Remove this file from the plan. ALiX may not modify protected paths autonomously.",
            });
          }
        }
      }
    }

    // Verify branch name is set
    if (!executionPlan.branchName || executionPlan.branchName.trim() === "") {
      findings.push({
        severity: "major",
        file: "plan",
        summary: "No branch name specified",
        recommendation: "Generate a branch name before execution",
      });
    }

    // ── Completeness checks ─────────────────────────────────────────

    // Check that subtasks cover all acceptance criteria
    const acSubtasks = executionPlan.subtasks.filter(
      (s) => s.id !== "step-0",
    );
    if (acSubtasks.length < wp.acceptanceCriteria.length) {
      findings.push({
        severity: "major",
        file: "plan",
        summary: `Not all acceptance criteria have subtasks (${acSubtasks.length} subtasks for ${wp.acceptanceCriteria.length} criteria)`,
        recommendation: "Add missing subtasks for uncovered acceptance criteria",
      });
    }

    if (acSubtasks.length > wp.acceptanceCriteria.length) {
      findings.push({
        severity: "minor",
        file: "plan",
        summary: `More subtasks than acceptance criteria (${acSubtasks.length} subtasks for ${wp.acceptanceCriteria.length} criteria)`,
        recommendation:
          "Consider consolidating or documenting the extra subtasks",
      });
    }

    // Check each subtask has files assigned
    for (const subtask of executionPlan.subtasks) {
      if (subtask.files.length === 0) {
        findings.push({
          severity: "major",
          file: subtask.id,
          summary: `Subtask ${subtask.id} has no files assigned: "${subtask.description.slice(0, 60)}"`,
          recommendation: "Assign at least one file to this subtask",
        });
      }

      // Check subtask has an acceptance check
      if (!subtask.acceptanceCheck || subtask.acceptanceCheck.trim() === "") {
        findings.push({
          severity: "major",
          file: subtask.id,
          summary: `Subtask ${subtask.id} is missing acceptance check`,
          recommendation:
            "Add an acceptanceCheck describing how to verify this subtask",
        });
      }
    }

    // Check AC descriptions are not empty
    for (let i = 0; i < wp.acceptanceCriteria.length; i++) {
      if (!wp.acceptanceCriteria[i] || wp.acceptanceCriteria[i].trim() === "") {
        findings.push({
          severity: "minor",
          file: "work-package",
          summary: `Acceptance criterion ${i + 1} is empty`,
          recommendation: "Remove or provide a description for each criterion",
        });
      }
    }

    // ── Test coverage checks ────────────────────────────────────────

    for (const subtask of executionPlan.subtasks) {
      if (subtask.files.length > 0 && subtask.testFiles.length === 0) {
        // Only flag if the subtask has source files that aren't themselves test files
        const hasNonTestFile = subtask.files.some(
          (f) =>
            !f.includes(".test.") &&
            !f.includes("tests/") &&
            !f.includes("__tests__"),
        );
        if (hasNonTestFile && subtask.id !== "step-0") {
          findings.push({
            severity: "nit",
            file: subtask.id,
            summary: `Subtask ${subtask.id} has source files but no test files: "${subtask.description.slice(0, 60)}"`,
            recommendation:
              "Consider adding test files for the modified source files",
          });
        }
      }
    }

    // ── Risk assessment ─────────────────────────────────────────────

    // Large plan
    if (executionPlan.subtasks.length > 8) {
      findings.push({
        severity: "minor",
        file: "plan",
        summary: `Large plan with ${executionPlan.subtasks.length} subtasks`,
        recommendation:
          "Consider splitting into multiple smaller issues for easier review",
      });
    }

    // High estimated commits
    if (executionPlan.estimatedCommits > 15) {
      findings.push({
        severity: "minor",
        file: "plan",
        summary: `High commit count: ${executionPlan.estimatedCommits} estimated`,
        recommendation:
          "Consider squashing related changes into fewer commits",
      });
    }

    // ── Determine verdict ───────────────────────────────────────────

    const criticalCount = findings.filter(
      (f) => f.severity === "critical",
    ).length;
    const majorCount = findings.filter((f) => f.severity === "major").length;
    const minorCount = findings.filter((f) => f.severity === "minor").length;
    const nitCount = findings.filter((f) => f.severity === "nit").length;

    let verdict: "approve" | "changes_requested" | "reject";
    let summary: string;

    if (criticalCount > 0) {
      verdict = "reject";
      summary = `Plan rejected: ${criticalCount} critical, ${majorCount} major, ${minorCount} minor, ${nitCount} nit finding(s).`;
    } else if (majorCount > 0) {
      verdict = "changes_requested";
      summary = `Changes requested: ${majorCount} major, ${minorCount} minor, ${nitCount} nit finding(s). Resolve major findings before proceeding.`;
    } else {
      verdict = "approve";
      summary = `Plan approved with ${minorCount} minor and ${nitCount} nit finding(s).`;
    }

    const report: ReviewReport = {
      issueNumber: wp.issueNumber,
      commitSha: "plan", // plan-level review, not yet code
      verdict,
      findings,
      summary,
    };

    return { success: true, report };
  }

  /**
   * Full review + execution: reviews the plan, transitions, and records
   * review_started and review_completed evidence.
   */
  async execute(
    executionPlan: ExecutionPlan,
    coordinator: WorkflowCoordinator,
    writer: EvidenceEventWriter,
  ): Promise<ReviewExecuteResult> {
    const reviewResult = await this.review(executionPlan);
    if (!reviewResult.success) return reviewResult;

    const issueNumber = executionPlan.workPackage.issueNumber;

    try {
      // Record review_started
      await writer.recordReviewStarted(
        issueNumber,
        { commitSha: "plan" },
        {
          actor: "ReviewAgent",
          from: "PLANNED",
          to: "UNDER_REVIEW",
        },
      );

      // Transition PLANNED → UNDER_REVIEW
      await coordinator.transition(issueNumber, "UNDER_REVIEW", {
        actor: "ReviewAgent",
        reason: `Review: ${reviewResult.report.findings.length} finding(s)`,
      });

      // Record review_completed
      const evidence = await writer.recordReviewCompleted(issueNumber, {
        verdict: reviewResult.report.verdict,
        findingCount: reviewResult.report.findings.length,
      });

      return {
        success: true,
        report: reviewResult.report,
        evidenceFingerprint: evidence?.fingerprint,
      };
    } catch (err) {
      return {
        success: false,
        error: `Review execution failed: ${err instanceof Error ? err.message : String(err)}`,
        code: "invalid_plan",
      };
    }
  }
}
