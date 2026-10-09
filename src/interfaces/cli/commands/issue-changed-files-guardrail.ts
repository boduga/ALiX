/**
 * issue-changed-files-guardrail.ts — P11.9 changed-files guardrail.
 *
 * Evaluates proposed file paths against configured limits and patterns.
 * No file modifications, branches, commits, or PRs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangedFilesConfig {
  /** Maximum number of files that can be changed (default: 10). */
  maxFilesChanged: number;
  /** Allowed path prefixes (e.g. ["src/", "tests/"]). Empty = all allowed. */
  allowedPaths: string[];
  /** Blocked path prefixes (e.g. [".env", ".git/", "node_modules/"]). */
  blockedPaths: string[];
  /** When true, violations produce warnings instead of failures. */
  warnOnly: boolean;
}

export type GuardrailStatus = "pass" | "warn" | "fail";

export interface GuardrailResult {
  status: GuardrailStatus;
  proposedFileCount: number;
  allowedFiles: string[];
  blockedFiles: string[];
  reasons: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ChangedFilesConfig = {
  maxFilesChanged: 10,
  allowedPaths: [],
  blockedPaths: [".env", ".git/", "node_modules/", "dist/", ".alix/"],
  warnOnly: false,
};

// ---------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------

/**
 * Evaluate proposed file paths against the changed-files guardrail.
 *
 * @param proposedFiles — list of file paths from the proposal
 * @param config — optional override; defaults are used for missing fields
 */
export function evaluateChangedFilesGuardrail(
  proposedFiles: string[],
  config?: Partial<ChangedFilesConfig>,
): GuardrailResult {
  const cfg: ChangedFilesConfig = { ...DEFAULT_CONFIG, ...config };
  const reasons: string[] = [];
  const allowedFiles: string[] = [];
  const blockedFiles: string[] = [];

  // Check max files
  if (proposedFiles.length > cfg.maxFilesChanged) {
    reasons.push(`Proposed ${proposedFiles.length} files, exceeds limit of ${cfg.maxFilesChanged}`);
  }

  // Evaluate each file path
  for (const file of proposedFiles) {
    const isBlocked = cfg.blockedPaths.some((p) => file.startsWith(p) || file.includes(p));
    if (isBlocked) {
      blockedFiles.push(file);
      reasons.push(`Blocked path: ${file}`);
      continue;
    }

    if (cfg.allowedPaths.length > 0) {
      const isAllowed = cfg.allowedPaths.some((p) => file.startsWith(p));
      if (!isAllowed) {
        blockedFiles.push(file);
        reasons.push(`Path not in allowed list: ${file}`);
        continue;
      }
    }

    allowedFiles.push(file);
  }

  const hasViolations = reasons.length > 0;
  const status: GuardrailStatus = hasViolations
    ? cfg.warnOnly
      ? "warn"
      : "fail"
    : "pass";

  return {
    status,
    proposedFileCount: proposedFiles.length,
    allowedFiles,
    blockedFiles,
    reasons,
    recommendedAction: buildRecommendation(status, cfg.warnOnly),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRecommendation(status: GuardrailStatus, warnOnly: boolean): string {
  if (status === "pass") return "Proceed with proposal.";
  if (warnOnly) return "Review warnings and proceed with caution.";
  return "Fix violations and re-run proposal.";
}
