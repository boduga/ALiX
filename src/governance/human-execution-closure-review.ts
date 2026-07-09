/**
 * P21.2 — Closure Review Model.
 *
 * Pure state/transition validator + append-only JSONL store for
 * closure reviews. The validator is pure (no filesystem, audit, CLI,
 * or execution imports). The store layer handles persistence only.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  HumanExecutionEvidenceRef,
  HumanExecutionClosureDecision,
  HumanExecutionClosureReview,
} from "./human-execution-closure-types.js";

export class ClosureReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosureReviewError";
  }
}

export const HUMAN_EXECUTION_CLOSURE_DECISIONS: HumanExecutionClosureDecision[] = [
  "accepted",
  "rejected",
  "incomplete",
  "needs_follow_up",
];

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const TERMINAL_DECISIONS: HumanExecutionClosureDecision[] = ["accepted", "rejected"];

export function validateTransition(
  previousDecision: HumanExecutionClosureDecision | null,
  newDecision: HumanExecutionClosureDecision,
): void {
  // Terminal states cannot be reopened
  if (previousDecision !== null && TERMINAL_DECISIONS.includes(previousDecision)) {
    throw new ClosureReviewError(
      `cannot reopen terminal closure state "${previousDecision}"`,
    );
  }
}

export function validateReview(
  review: HumanExecutionClosureReview,
  evidenceRefs: HumanExecutionEvidenceRef[],
  previousDecision: HumanExecutionClosureDecision | null,
): void {
  // Basic field validation
  if (!review.handoffId) throw new ClosureReviewError("handoffId is required");
  if (!review.decision) throw new ClosureReviewError("decision is required");
  if (!HUMAN_EXECUTION_CLOSURE_DECISIONS.includes(review.decision)) {
    throw new ClosureReviewError(`unknown closure decision "${review.decision}"`);
  }
  if (!review.rationale) throw new ClosureReviewError("rationale must be non-empty");
  if (!review.reviewedBy) throw new ClosureReviewError("reviewedBy must be non-empty");
  if (!review.reviewedAt) {
    throw new ClosureReviewError("reviewedAt is required");
  }
  if (
    !ISO_TIMESTAMP_PATTERN.test(review.reviewedAt) ||
    Number.isNaN(Date.parse(review.reviewedAt))
  ) {
    throw new ClosureReviewError(`reviewedAt must be valid ISO 8601, got "${review.reviewedAt}"`);
  }

  // No closure without evidence
  if (review.evidenceIds.length === 0) {
    throw new ClosureReviewError("closure requires at least one evidence ID");
  }

  // accepted/rejected require at least one evidence ID
  if (
    (review.decision === "accepted" || review.decision === "rejected") &&
    review.evidenceIds.length === 0
  ) {
    throw new ClosureReviewError(
      `"${review.decision}" requires at least one evidence ID`,
    );
  }

  // incomplete/needs_follow_up require followUpSummary
  if (
    (review.decision === "incomplete" || review.decision === "needs_follow_up") &&
    !review.followUpSummary
  ) {
    throw new ClosureReviewError(
      `"${review.decision}" requires followUpSummary`,
    );
  }

  // Evidence IDs must exist for the same handoff
  const handoffEvidenceIds = evidenceRefs
    .filter((e) => e.handoffId === review.handoffId)
    .map((e) => e.evidenceId);
  const evidenceSet = new Set(handoffEvidenceIds);

  for (const eid of review.evidenceIds) {
    if (!evidenceSet.has(eid)) {
      throw new ClosureReviewError(
        `evidenceId "${eid}" not found for handoff "${review.handoffId}"`,
      );
    }
  }

  // Transition validation
  validateTransition(previousDecision, review.decision);
}

export function deriveLatestState(
  evidenceRefs: HumanExecutionEvidenceRef[],
  reviews: HumanExecutionClosureReview[],
): "prepared" | "evidence_submitted" | "accepted" | "rejected" | "incomplete" | "follow_up_required" {
  if (reviews.length === 0) {
    return evidenceRefs.length > 0 ? "evidence_submitted" : "prepared";
  }

  // Sort by reviewedAt then closureReviewId to find latest
  const sorted = [...reviews].sort(
    (a, b) =>
      a.reviewedAt.localeCompare(b.reviewedAt) ||
      a.closureReviewId.localeCompare(b.closureReviewId),
  );
  const latest = sorted[sorted.length - 1]!;

  switch (latest.decision) {
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "incomplete":
      return "incomplete";
    case "needs_follow_up":
      return "follow_up_required";
    default:
      return "evidence_submitted";
  }
}

export interface HumanExecutionClosureReviewStore {
  appendReview(review: HumanExecutionClosureReview): Promise<HumanExecutionClosureReview>;
  listReviews(): Promise<HumanExecutionClosureReview[]>;
  listReviewsForHandoff(handoffId: string): Promise<HumanExecutionClosureReview[]>;
}

export class FileClosureReviewStore implements HumanExecutionClosureReviewStore {
  private storePath: string;
  private evidenceRefs: () => Promise<HumanExecutionEvidenceRef[]>;

  constructor(
    storePath: string,
    evidenceLoader: () => Promise<HumanExecutionEvidenceRef[]>,
  ) {
    this.storePath = storePath;
    this.evidenceRefs = evidenceLoader;
    const dir = dirname(storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private loadAll(): HumanExecutionClosureReview[] {
    if (!existsSync(this.storePath)) return [];
    const raw = readFileSync(this.storePath, "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => JSON.parse(line) as HumanExecutionClosureReview);
  }

  async appendReview(review: HumanExecutionClosureReview): Promise<HumanExecutionClosureReview> {
    // Load previous reviews for this handoff
    const all = this.loadAll();
    const handoffReviews = all.filter((r) => r.handoffId === review.handoffId);
    const previousDecision =
      handoffReviews.length > 0
        ? this.latest(handoffReviews).decision
        : null;

    const evidenceRefs = await this.evidenceRefs();

    // Validate using the pure validator
    validateReview(review, evidenceRefs, previousDecision);

    const line = JSON.stringify(review) + "\n";
    appendFileSync(this.storePath, line, "utf-8");
    return review;
  }

  private latest(reviews: HumanExecutionClosureReview[]): HumanExecutionClosureReview {
    return [...reviews].sort(
      (a, b) =>
        a.reviewedAt.localeCompare(b.reviewedAt) ||
        a.closureReviewId.localeCompare(b.closureReviewId),
    )[reviews.length - 1]!;
  }

  async listReviews(): Promise<HumanExecutionClosureReview[]> {
    return this.loadAll();
  }

  async listReviewsForHandoff(handoffId: string): Promise<HumanExecutionClosureReview[]> {
    const all = this.loadAll();
    return all
      .filter((r) => r.handoffId === handoffId)
      .sort(
        (a, b) =>
          a.reviewedAt.localeCompare(b.reviewedAt) ||
          a.closureReviewId.localeCompare(b.closureReviewId),
      );
  }
}
