/**
 * P4.5f — PRAgent: creates draft PRs from ExecutionPlans and ReviewReports.
 *
 * Narrow scope — no decision authority. Formatter and GitHub adapter only.
 *
 * Flow:
 *   1. prepare(executionPlan, reviewReport) — read-only, returns PR body
 *   2. create(executionPlan, coordinator, writer, reviewReport) — prepare
 *      + create draft PR + transition + evidence
 *
 * Key rule:
 *   PRAgent creates PRs.
 *   Human merges PRs.
 *
 * @module
 */

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import type { WorkflowCoordinator } from "../coordinator.js";
import type { EvidenceEventWriter } from "../evidence-writer.js";
import type {
  ExecutionPlan,
  PullRequestArtifact,
  ReviewReport,
} from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PRRejectionCode =
  | "missing_plan"
  | "missing_branch"
  | "gh_failed"
  | "invalid_state";

export type PrepareResult =
  | { success: true; artifact: PullRequestArtifact }
  | { success: false; error: string; code: PRRejectionCode };

export type CreateResult =
  | { success: true; artifact: PullRequestArtifact; evidenceFingerprint?: string; prUrl: string }
  | { success: false; error: string; code: PRRejectionCode };

// ---------------------------------------------------------------------------
// PRAgent
// ---------------------------------------------------------------------------

export class PRAgent {
  private readonly execCommand: (cmd: string) => string;

  constructor(opts?: { execCommand?: (cmd: string) => string }) {
    this.execCommand = opts?.execCommand ?? defaultExec;
  }

  // -----------------------------------------------------------------------
  // Prepare (read-only)
  // -----------------------------------------------------------------------

  /**
   * Prepare a PullRequestArtifact from an ExecutionPlan and optional ReviewReport.
   *
   * Generates PR title, body with issue links, subtask summary, evidence
   * fingerprints, and review findings — without creating the PR on GitHub.
   */
  async prepare(
    executionPlan: ExecutionPlan,
    reviewReport?: ReviewReport,
    evidenceFingerprints?: string[],
  ): Promise<PrepareResult> {
    if (!executionPlan) {
      return { success: false, error: "ExecutionPlan is null", code: "missing_plan" };
    }
    if (!executionPlan.branchName) {
      return { success: false, error: "ExecutionPlan has no branchName", code: "missing_branch" };
    }

    const wp = executionPlan.workPackage;
    const issueNumber = wp.issueNumber;
    const fps = evidenceFingerprints ?? [];

    const title = this.buildTitle(wp.issueTitle);
    const body = this.buildBody(executionPlan, reviewReport, fps);

    const artifact: PullRequestArtifact = {
      issueNumber,
      branchName: executionPlan.branchName,
      title,
      body,
      draft: true,
      evidenceFingerprints: fps,
    };

    return { success: true, artifact };
  }

  /**
   * Full flow: prepare the PR artifact, create the draft PR on GitHub,
   * transition PR_READY → AWAITING_HUMAN, record pr_created evidence.
   */
  async create(
    executionPlan: ExecutionPlan,
    coordinator: WorkflowCoordinator,
    writer: EvidenceEventWriter,
    reviewReport?: ReviewReport,
    evidenceFingerprints?: string[],
  ): Promise<CreateResult> {
    const prepareResult = await this.prepare(
      executionPlan,
      reviewReport,
      evidenceFingerprints,
    );
    if (!prepareResult.success) return prepareResult;

    const artifact = prepareResult.artifact;
    const issueNumber = executionPlan.workPackage.issueNumber;

    try {
      // Create draft PR on GitHub
      let prUrl: string;
      try {
        prUrl = this.createDraftPR(artifact);
      } catch {
        return {
          success: false,
          error: "Failed to create draft PR via gh CLI. Is `gh` authenticated?",
          code: "gh_failed",
        };
      }

      // Record pr_created evidence
      const evidence = await writer.recordPrCreated(issueNumber, {
        prUrl,
        prNumber: this.parsePRNumber(prUrl),
        branchName: artifact.branchName,
      });

      // Transition PR_READY → AWAITING_HUMAN
      await coordinator.transition(issueNumber, "AWAITING_HUMAN", {
        actor: "PRAgent",
        reason: `PR created: ${prUrl}`,
      });

      return {
        success: true,
        artifact,
        evidenceFingerprint: evidence?.fingerprint,
        prUrl,
      };
    } catch (err) {
      return {
        success: false,
        error: `PR creation failed: ${err instanceof Error ? err.message : String(err)}`,
        code: "invalid_state",
      };
    }
  }

  // -----------------------------------------------------------------------
  // Private: body builders
  // -----------------------------------------------------------------------

  private buildTitle(issueTitle: string): string {
    // Strip leading emoji or tags like "P4.5a — "
    const cleaned = issueTitle.replace(/^[^a-zA-Z0-9]+/, "").trim();
    return cleaned.length > 72 ? cleaned.slice(0, 69) + "..." : cleaned;
  }

  private buildBody(
    plan: ExecutionPlan,
    reviewReport?: ReviewReport,
    fingerprints?: string[],
  ): string {
    const wp = plan.workPackage;
    const parts: string[] = [];

    // Issue link
    parts.push(`Closes #${wp.issueNumber}`);
    parts.push("");

    // Change summary
    parts.push("## Summary");
    parts.push("");
    parts.push(wp.issueTitle);
    parts.push("");

    // Subtask breakdown
    parts.push("## Changes");
    parts.push("");
    for (const subtask of plan.subtasks) {
      const files = subtask.files.length > 0
        ? ` (${subtask.files.join(", ")})`
        : "";
      parts.push(`- ${subtask.description}${files}`);
    }
    parts.push("");

    // Review report
    if (reviewReport) {
      parts.push("## Review");
      parts.push("");
      parts.push(`**Verdict:** ${reviewReport.verdict}`);
      parts.push(`**Findings:** ${reviewReport.findings.length}`);
      if (reviewReport.findings.length > 0) {
        parts.push("");
        parts.push("### Findings");
        for (const f of reviewReport.findings) {
          parts.push(`- [${f.severity}] ${f.file}: ${f.summary}`);
        }
      }
      parts.push("");
    }

    // Evidence fingerprints
    if (fingerprints && fingerprints.length > 0) {
      parts.push("## Evidence");
      parts.push("");

      for (const fp of fingerprints) {
        parts.push(`- \`${fp}\``);
      }
      parts.push("");
      parts.push(
        "Query: `alix evidence show <fingerprint>` for full record.",
      );
      parts.push("");
    }

    // Branch name
    parts.push(`**Branch:** \`${plan.branchName}\``);

    return parts.join("\n");
  }

  // -----------------------------------------------------------------------
  // Private: GitHub adapter
  // -----------------------------------------------------------------------

  private createDraftPR(artifact: PullRequestArtifact): string {
    const tmpFile = `/tmp/alix-pr-body-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.md`;
    try {
      writeFileSync(tmpFile, artifact.body, "utf-8");
      const escapedTitle = artifact.title.replace(/'/g, "'\\''");
      const cmd = `gh pr create --draft --title '${escapedTitle}' --body-file ${tmpFile} --base main`;
      return this.execCommand(cmd).trim();
    } finally {
      try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
    }
  }

  private parsePRNumber(prUrl: string): number {
    const match = prUrl.match(/\/pull\/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }
}

// ---------------------------------------------------------------------------
// Default exec
// ---------------------------------------------------------------------------

function defaultExec(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();
}
