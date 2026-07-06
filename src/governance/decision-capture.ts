/**
 * P14.3 — Decision Capture.
 *
 * Records explicit operator decisions (accept, dismiss, defer, escalate,
 * convert_to_issue) on P14.1 signals. Append-only, rationale required,
 * actionProposalId always null in P14.3 — decisions record intent only.
 *
 * P14.3 depends on P14.1 (GovernanceSignal, FileSignalStore) and P14.2
 * (OperatorReview, FileReviewStore for optional backlink validation).
 *
 * Core invariant: decisions are append-only, never executed, and never
 * mutate signals, policies, gates, or thresholds.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type DecisionKind =
  | "accept"
  | "dismiss"
  | "defer"
  | "escalate"
  | "convert_to_issue";

export const VALID_DECISION_KINDS: DecisionKind[] = [
  "accept", "dismiss", "defer", "escalate", "convert_to_issue",
];

export interface OperatorDecision {
  decisionId: string;
  /** Must reference an existing signal in the signal store. */
  signalId: string;
  /** Exactly one decision kind. */
  decision: DecisionKind;
  /** Required — rationale for the decision. Must be non-empty. */
  rationale: string;
  /** Decision-maker identity (resolved via --as → git → env → "operator"). */
  decider: string;
  /** Optional backlink to a P14.2 review. Must be for the same signalId. */
  reviewId: string | null;
  /**
   * Placeholder for P14.4. Always null in P14.3 — no action proposals
   * are created by this phase.
   */
  actionProposalId: null;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DECISION_FILE = "governance-decisions.jsonl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an OperatorDecision structure.
 *
 * Rules from the P14.3 spec:
 * - decisionId, signalId, rationale, decider, createdAt must be non-empty.
 * - decision must be a valid DecisionKind.
 * - actionProposalId must be null (enforced at type level in P14.3).
 * - reviewId must be null or non-empty string.
 */
export function validateOperatorDecision(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["Decision must be an object"] };
  }

  const d = entry as Record<string, unknown>;

  if (!isNonEmptyString(d.decisionId)) errors.push("decisionId is required");
  if (!isNonEmptyString(d.signalId)) errors.push("signalId is required");
  if (!(VALID_DECISION_KINDS as readonly string[]).includes(d.decision as string)) {
    errors.push(`decision must be one of: ${VALID_DECISION_KINDS.join(", ")}`);
  }
  if (!isNonEmptyString(d.rationale)) errors.push("rationale is required and must be non-empty");
  if (!isNonEmptyString(d.decider)) errors.push("decider is required");
  if (d.reviewId !== null && !isNonEmptyString(d.reviewId as string | undefined)) {
    errors.push("reviewId must be null or a non-empty string");
  }
  if (d.actionProposalId !== null) {
    errors.push("actionProposalId must be null in P14.3");
  }
  if (!isNonEmptyString(d.createdAt)) errors.push("createdAt is required");

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface DecisionStore {
  append(decision: OperatorDecision): Promise<void>;
  list(limit?: number): Promise<OperatorDecision[]>;
  getById(decisionId: string): Promise<OperatorDecision | null>;
  getBySignalId(signalId: string): Promise<OperatorDecision[]>;
  getByKind(kind: DecisionKind): Promise<OperatorDecision[]>;
}

// ---------------------------------------------------------------------------
// Filesystem store (JSONL, append-only)
// ---------------------------------------------------------------------------

export class FileDecisionStore implements DecisionStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = baseDir;
  }

  private get filePath(): string {
    return join(this.dir, DECISION_FILE);
  }

  private async dirExists(): Promise<boolean> {
    try { await stat(this.dir); return true; }
    catch { return false; }
  }

  private async ensureDir(): Promise<void> {
    if (!(await this.dirExists())) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  private async fileExists(): Promise<boolean> {
    try { await stat(this.filePath); return true; }
    catch { return false; }
  }

  private async readAll(): Promise<OperatorDecision[]> {
    if (!(await this.fileExists())) {
      return [];
    }
    const content = await readFile(this.filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const decisions: OperatorDecision[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const validation = validateOperatorDecision(parsed);
      if (!validation.valid) {
        continue;
      }
      decisions.push(parsed as OperatorDecision);
    }
    decisions.reverse();
    return decisions;
  }

  async append(decision: OperatorDecision): Promise<void> {
    const validation = validateOperatorDecision(decision);
    if (!validation.valid) {
      throw new Error(`Invalid decision: ${validation.errors.join("; ")}`);
    }
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(decision) + "\n", "utf8");
  }

  async list(limit?: number): Promise<OperatorDecision[]> {
    const decisions = await this.readAll();
    return limit !== undefined && limit > 0 ? decisions.slice(0, limit) : decisions;
  }

  async getById(decisionId: string): Promise<OperatorDecision | null> {
    const decisions = await this.readAll();
    return decisions.find((d) => d.decisionId === decisionId) ?? null;
  }

  async getBySignalId(signalId: string): Promise<OperatorDecision[]> {
    const decisions = await this.readAll();
    return decisions.filter((d) => d.signalId === signalId);
  }

  async getByKind(kind: DecisionKind): Promise<OperatorDecision[]> {
    const decisions = await this.readAll();
    return decisions.filter((d) => d.decision === kind);
  }
}

// ---------------------------------------------------------------------------
// Reviewer / decider resolution
// ---------------------------------------------------------------------------

import { resolveReviewer } from "./operator-review.js";

// Re-export for CLI convenience
export { resolveReviewer };

// ---------------------------------------------------------------------------
// Decision creation
// ---------------------------------------------------------------------------

/**
 * Create an OperatorDecision for a given signal.
 *
 * Does NOT mutate the signal record — decision state is derived from
 * decision records for the signalId. Does NOT execute or enforce —
 * decisions record intent only.
 *
 * @param decisionId - Unique decision ID.
 * @param signalId - ID of the signal being decided (must exist in signalStore).
 * @param signal - The fetched signal object (must be truthy).
 * @param decisionKind - One of the five DecisionKind values.
 * @param rationale - Required non-empty rationale string.
 * @param decider - Resolved decision-maker identity.
 * @param reviewId - Optional backlink to a P14.2 review. When provided,
 *   the review must exist and be for the same signalId.
 * @param reviewStore - Review store for optional backlink validation.
 * @param now - ISO timestamp for decision creation.
 * @returns The created OperatorDecision.
 * @throws If the signal does not exist, rationale is empty, or reviewId
 *   does not reference a valid review for the same signal.
 */
export async function createOperatorDecision(
  decisionId: string,
  signalId: string,
  signal: unknown,
  decisionKind: DecisionKind,
  rationale: string,
  decider: string,
  reviewId: string | null,
  reviewStore: { getById(id: string): Promise<unknown> } | null,
  now: string,
): Promise<OperatorDecision> {
  // Signal-existence gate
  if (!signal) {
    throw new Error(`Signal not found: ${signalId}. Cannot create decision for missing signal.`);
  }

  // Rationale required
  if (!isNonEmptyString(rationale)) {
    throw new Error("Rationale is required and must be non-empty.");
  }

  // Optional review backlink validation
  if (reviewId !== null) {
    if (!reviewStore) {
      throw new Error("Review store is required when reviewId is provided.");
    }
    const review = await reviewStore.getById(reviewId);
    if (!review) {
      throw new Error(`Review not found: ${reviewId}. Cannot backlink decision to missing review.`);
    }
    const reviewRecord = review as { signalId?: string };
    if (reviewRecord.signalId !== signalId) {
      throw new Error(
        `Review ${reviewId} is for signal ${reviewRecord.signalId}, not ${signalId}. ` +
        "Review backlink must reference a review for the same signal.",
      );
    }
  }

  const decision: OperatorDecision = {
    decisionId,
    signalId,
    decision: decisionKind,
    rationale,
    decider,
    reviewId,
    actionProposalId: null,
    createdAt: now,
  };

  const validation = validateOperatorDecision(decision);
  if (!validation.valid) {
    throw new Error(`Invalid decision: ${validation.errors.join("; ")}`);
  }

  return decision;
}
