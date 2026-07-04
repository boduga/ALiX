/**
 * issue-draft-pr.ts — P11.9 draft PR creation.
 *
 * Creates a draft PR from issue execution results.
 * Only runs after proposal, changed-files guardrail, and verification.
 * No autonomous merge — draft PR only.
 */

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftPrResult {
  success: boolean;
  branchName?: string;
  prUrl?: string;
  error?: string;
}

export interface DraftPrConfig {
  /** Base branch to branch from (default: current branch or "main"). */
  baseBranch?: string;
  /** Branch prefix (default: "alix/"). */
  branchPrefix?: string;
  /** Whether to force push if branch exists. */
  forcePush?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DraftPrConfig = {
  baseBranch: process.env.GITHUB_BASE_REF ?? "main",
  branchPrefix: "alix/",
  forcePush: false,
};

// ---------------------------------------------------------------------------
// Draft PR creation
// ---------------------------------------------------------------------------

/**
 * Create a draft PR from the current working tree state.
 *
 * Steps:
 * 1. Stash any unstaged changes
 * 2. Create branch from base
 * 3. Commit changes
 * 4. Push branch
 * 5. Create draft PR
 * 6. Restore working tree
 *
 * Returns a DraftPrResult — never throws.
 */
export function createDraftPr(
  repo: string,
  issueNumber: number,
  issueTitle: string,
  config?: Partial<DraftPrConfig>,
): DraftPrResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const branchName = `${cfg.branchPrefix}issue-${issueNumber}-${slugify(issueTitle).slice(0, 40)}`;

  try {
    // Ensure we're on the base branch and up to date
    execSync(`git fetch origin ${cfg.baseBranch} 2>/dev/null || true`, { encoding: "utf-8" });

    // Create and switch to new branch
    execSync(`git checkout -b "${branchName}" origin/${cfg.baseBranch}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Stage all changes and commit
    execSync("git add -A", { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });

    const commitMessage = `feat: address issue #${issueNumber}\n\nAutomated by ALiX for issue #${issueNumber}: ${issueTitle}\n\nCo-Authored-By: ALiX <alix@example.com>`;
    execSync(`git commit -m "${commitMessage}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Push branch
    const pushFlags = cfg.forcePush ? "--force" : "";
    execSync(`git push ${pushFlags} origin "${branchName}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Create draft PR
    const prBody = `## Summary\n\nAutomated changes for issue #${issueNumber}: ${issueTitle}\n\n---\n\n> 🤖 Generated with ALiX`;
    const prUrl = execSync(
      `gh pr create --draft --repo "${repo}" --base "${cfg.baseBranch}" --head "${branchName}" --title "feat: address issue #${issueNumber}" --body "${prBody}"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();

    // Switch back to base branch
    execSync(`git checkout ${cfg.baseBranch} 2>/dev/null || true`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return { success: true, branchName, prUrl };
  } catch (err: unknown) {
    // Try to restore base branch
    try {
      execSync(`git checkout ${cfg.baseBranch} 2>/dev/null || true`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // Ignore restore failure
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
