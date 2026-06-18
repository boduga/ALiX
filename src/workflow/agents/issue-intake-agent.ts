/**
 * P4.5a — IssueIntakeAgent: reads GitHub Issues, validates, estimates,
 * and produces a typed WorkPackage.
 *
 * Two-stage flow:
 *   1. intake(issueNumber) — read-only analysis, returns WorkPackage
 *   2. select(issueNumber, coordinator, writer) — intake + transition
 *      to SELECTED + record issue_selected evidence
 *
 * @module
 */

import { execSync } from "node:child_process";
import type { WorkflowCoordinator } from "../coordinator.js";
import type { EvidenceEventWriter } from "../evidence-writer.js";
import type { WorkPackage, AgentName } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw GitHub issue data from `gh issue view --json`. */
export interface GhIssueData {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string; color?: string; description?: string }>;
  milestone?: { title: string } | null;
  assignees?: Array<{ login: string }>;
  closed?: boolean;
}

export type RejectionCode =
  | "missing_ready_label"
  | "blocked"
  | "needs_human"
  | "invalid_issue"
  | "not_found"
  | "parse_error";

export type IntakeResult =
  | { success: true; workPackage: WorkPackage }
  | { success: false; error: string; code: RejectionCode };

export type SelectResult =
  | { success: true; workPackage: WorkPackage; evidenceFingerprint?: string }
  | { success: false; error: string; code: RejectionCode };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GH_FIELDS = [
  "number", "title", "body", "state", "labels",
  "milestone", "assignees", "closed",
].join(",");

// Rejection labels — an issue with any of these is rejected
const REJECTION_LABELS = new Set(["blocked", "needs-human", "invalid", "wontfix"]);

// ---------------------------------------------------------------------------
// IssueIntakeAgent
// ---------------------------------------------------------------------------

export class IssueIntakeAgent {
  /**
   * Read-only intake: analyze a GitHub issue and produce a WorkPackage.
   *
   * @param issueNumber - GitHub issue number
   * @param issueData  - Optional pre-fetched issue data (for testing).
   *                      When omitted, reads from `gh issue view`.
   */
  async intake(
    issueNumber: number,
    issueData?: GhIssueData,
  ): Promise<IntakeResult> {
    let data: GhIssueData;
    try {
      data = issueData ?? this.readIssue(issueNumber);
    } catch {
      return {
        success: false,
        error: `Failed to read issue #${issueNumber}. Is \`gh\` authenticated?`,
        code: "not_found",
      };
    }

    // Validate state
    if (data.state !== "OPEN" || data.closed) {
      return {
        success: false,
        error: `Issue #${issueNumber} is not open (state=${data.state})`,
        code: "invalid_issue",
      };
    }

    // Extract label names
    const labelNames = data.labels.map((l) => l.name);
    const lowerLabels = labelNames.map((l) => l.toLowerCase());

    // Check for rejection labels
    for (const label of lowerLabels) {
      if (REJECTION_LABELS.has(label)) {
        const code = label === "blocked" ? "blocked"
          : label === "needs-human" ? "needs_human"
          : "invalid_issue";
        return {
          success: false,
          error: `Issue #${issueNumber} has label "${label}" — rejecting`,
          code: code as RejectionCode,
        };
      }
    }

    // Must have ready-for-agent label
    if (!lowerLabels.includes("ready-for-agent")) {
      return {
        success: false,
        error: `Issue #${issueNumber} does not have "ready-for-agent" label`,
        code: "missing_ready_label",
      };
    }

    // Extract acceptance criteria from body
    const acceptanceCriteria = this.extractAcceptanceCriteria(data.body);

    // Detect dependency references
    const dependencies = this.detectDependencies(data.body);

    // Estimate priority
    const priority = this.estimatePriority(labelNames, data.body);

    // Estimate complexity
    const complexity = this.estimateComplexity(
      labelNames,
      data.body,
      acceptanceCriteria,
    );

    // Detect risk flags
    const riskFlags = this.detectRiskFlags(
      labelNames,
      data.body,
      dependencies,
      acceptanceCriteria,
    );

    // Estimate affected files
    const estimatedFiles = this.estimateFiles(data.body);

    const workPackage: WorkPackage = {
      issueNumber: data.number,
      issueTitle: data.title,
      labels: labelNames,
      priority,
      complexity,
      estimatedFiles,
      dependencies,
      acceptanceCriteria,
      riskFlags,
    };

    return { success: true, workPackage };
  }

  /**
   * Full intake + selection: analyzes the issue, transitions to SELECTED,
   * and records issue_selected evidence.
   *
   * @param issueNumber - GitHub issue number
   * @param coordinator - WorkflowCoordinator for state transitions
   * @param writer      - EvidenceEventWriter for recording evidence
   * @param issueData   - Optional pre-fetched issue data (for testing)
   */
  async select(
    issueNumber: number,
    coordinator: WorkflowCoordinator,
    writer: EvidenceEventWriter,
    issueData?: GhIssueData,
  ): Promise<SelectResult> {
    const intake = await this.intake(issueNumber, issueData);
    if (!intake.success) return intake;

    // Initialize workflow entry (NEW → SELECTED)
    try {
      // First transition to NEW (creates the entry)
      await coordinator.transition(issueNumber, "NEW", {
        actor: "IssueIntakeAgent",
        reason: "Issue selected by IssueIntakeAgent",
      });

      // Record issue_selected evidence
      const evidence = await writer.recordIssueSelected(
        issueNumber,
        {
          priority: intake.workPackage.priority,
          complexity: intake.workPackage.complexity,
          labels: intake.workPackage.labels,
        },
        { actor: "IssueIntakeAgent", from: "NEW", to: "SELECTED" },
      );

      // Transition to SELECTED
      await coordinator.transition(issueNumber, "SELECTED", {
        actor: "IssueIntakeAgent",
        reason: `Priority: ${intake.workPackage.priority}, Complexity: ${intake.workPackage.complexity}`,
      });

      return {
        success: true,
        workPackage: intake.workPackage,
        evidenceFingerprint: evidence?.fingerprint,
      };
    } catch (err) {
      return {
        success: false,
        error: `Selection failed: ${err instanceof Error ? err.message : String(err)}`,
        code: "parse_error",
      };
    }
  }

  // -----------------------------------------------------------------------
  // Private: GitHub API
  // -----------------------------------------------------------------------

  private readIssue(issueNumber: number): GhIssueData {
    const cmd = `gh issue view ${issueNumber} --json ${GH_FIELDS}`;
    const raw = execSync(cmd, { encoding: "utf-8", timeout: 15000 }).trim();
    return JSON.parse(raw) as GhIssueData;
  }

  // -----------------------------------------------------------------------
  // Private: Body parsing
  // -----------------------------------------------------------------------

  /**
   * Extract acceptance criteria from the issue body.
   * Looks for sections titled "Acceptance Criteria", "Acceptance", or "AC"
   * and collects checklist items and bullet points under them.
   */
  private extractAcceptanceCriteria(body: string): string[] {
    const criteria: string[] = [];
    const lines = body.split("\n");
    let inSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect section start
      if (
        /^#{1,4}\s*(acceptance\s*criteria|acceptance|ac|acceptance\s+tests)/i.test(
          trimmed,
        )
      ) {
        inSection = true;
        continue;
      }

      // Detect next heading — exit section
      if (inSection && /^#{1,4}\s/.test(trimmed) && trimmed.length < 80) {
        inSection = false;
        continue;
      }

      if (!inSection) continue;

      // Collect checklist items and bullet points
      const match = trimmed.match(
        /^(?:-\s+\[\s*[x ]?\s*\]\s+|\*\s+|\d+\.\s+)(.+)/i,
      );
      if (match) {
        criteria.push(match[1].trim());
      }
    }

    return criteria;
  }

  /**
   * Detect dependency references in the issue body.
   * Looks for "depends on #N", "blocked by #N", "requires #N", etc.
   */
  private detectDependencies(body: string): number[] {
    const deps = new Set<number>();
    const patterns = [
      /depends\s+on\s+#(\d+)/gi,
      /blocked\s+by\s+#(\d+)/gi,
      /requires?\s+#(\d+)/gi,
      /dependency\s*[:\s]+#(\d+)/gi,
      /dep:\s*#(\d+)/gi,
      /blocks?\s+#(\d+)/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(body)) !== null) {
        const num = parseInt(match[1], 10);
        if (Number.isFinite(num)) deps.add(num);
      }
    }

    // Also detect markdown links [#N](...)
    const linkPattern = /\[#(\d+)\]\([^)]+\)/g;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkPattern.exec(body)) !== null) {
      const num = parseInt(linkMatch[1], 10);
      if (Number.isFinite(num)) deps.add(num);
    }

    return Array.from(deps).sort((a, b) => a - b);
  }

  // -----------------------------------------------------------------------
  // Private: Estimation
  // -----------------------------------------------------------------------

  /**
   * Estimate priority based on labels and body content.
   *
   * Priority labels (checked first):
   *   priority:critical → critical
   *   priority:high    → high
   *   priority:medium  → medium
   *   priority:low     → low
   *
   * Fallback by type:
   *   type:bug    → high
   *   type:feature → medium
   *   type:chore  → low
   *   otherwise   → medium
   */
  private estimatePriority(
    labels: string[],
    _body: string,
  ): "low" | "medium" | "high" | "critical" {
    const lower = labels.map((l) => l.toLowerCase());

    // Explicit priority labels win
    if (lower.includes("priority:critical")) return "critical";
    if (lower.includes("priority:high")) return "high";
    if (lower.includes("priority:medium")) return "medium";
    if (lower.includes("priority:low")) return "low";

    // Fallback by type
    if (lower.includes("type:bug")) return "high";
    if (lower.includes("type:chore")) return "low";
    return "medium";
  }

  /**
   * Estimate complexity from labels, body, and acceptance criteria count.
   *
   * Complexity labels (checked first):
   *   complexity:large  → large
   *   complexity:medium → medium
   *   complexity:small  → small
   *
   * Heuristics:
   *   6+ AC items  → large
   *   3-5 AC items → medium
   *   1-2 AC items → small
   *   otherwise    → unknown
   */
  private estimateComplexity(
    labels: string[],
    _body: string,
    criteria: string[],
  ): "small" | "medium" | "large" | "unknown" {
    const lower = labels.map((l) => l.toLowerCase());

    // Explicit complexity labels win
    if (lower.includes("complexity:large")) return "large";
    if (lower.includes("complexity:medium")) return "medium";
    if (lower.includes("complexity:small")) return "small";

    // Heuristics from AC count
    if (criteria.length >= 6) return "large";
    if (criteria.length >= 3) return "medium";
    if (criteria.length >= 1) return "small";

    return "unknown";
  }

  /**
   * Estimate affected files from the issue body.
   * Looks for file paths, file references, and "## Files" sections.
   */
  private estimateFiles(body: string): string[] {
    const files: string[] = [];
    const seen = new Set<string>();

    // Look for ## Files sections with file paths
    const lines = body.split("\n");
    let inFiles = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^#{1,4}\s*files?\b/i.test(trimmed)) {
        inFiles = true;
        continue;
      }

      if (inFiles && /^#{1,4}\s/.test(trimmed) && trimmed.length < 80) {
        inFiles = false;
      }

      if (inFiles) {
        const fm = trimmed.match(/`([^`]+\.(?:ts|js|tsx|jsx|json|md|yaml|yml))`/);
        if (fm && !seen.has(fm[1])) {
          seen.add(fm[1]);
          files.push(fm[1]);
        }
      }
    }

    return files;
  }

  /**
   * Detect risk flags from labels, body, and analysis.
   */
  private detectRiskFlags(
    labels: string[],
    body: string,
    dependencies: number[],
    criteria: string[],
  ): string[] {
    const flags: string[] = [];
    const lower = labels.map((l) => l.toLowerCase());

    if (lower.includes("security")) flags.push("security relevant");
    if (lower.includes("breaking")) flags.push("breaking change");
    if (body.toLowerCase().includes("migration")) flags.push("migration required");
    if (body.toLowerCase().includes("api change")) flags.push("API change");
    if (dependencies.length > 2) flags.push("multiple dependencies");
    if (criteria.length > 8) flags.push("large scope");

    return flags;
  }
}
