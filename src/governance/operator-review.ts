/**
 * P14.2 — Operator Review Session.
 *
 * Lets an operator open a signal from the inbox, add notes and a
 * classification, and preserve the review as an append-only record.
 *
 * P14.2 depends only on P14.1 (GovernanceSignal, FileSignalStore). It does
 * NOT introduce decisions, action proposals, audit events, or lifecycle
 * transitions on the signal record itself — the reviewing status is derived
 * from the presence of review records for a given signalId.
 *
 * Core invariant: review records are append-only and never mutated.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface OperatorReview {
  reviewId: string;
  /** Must reference an existing signal in the signal store. */
  signalId: string;
  /** Operator identity (git config user.name, env USER, or explicit --as flag). */
  reviewer: string;
  /** Free-text observations. May be null if classification is provided. */
  notes: string | null;
  /** Optional re-classification of the signal. May be null if notes is provided. */
  classification: string | null;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REVIEW_FILE = "governance-reviews.jsonl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an OperatorReview structure.
 *
 * Rules:
 * - reviewId, signalId, reviewer, createdAt must be non-empty strings.
 * - At least one of notes or classification must be present (non-null
 *   and non-empty when trimmed).
 */
export function validateOperatorReview(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["Review must be an object"] };
  }

  const r = entry as Record<string, unknown>;

  if (!isNonEmptyString(r.reviewId)) errors.push("reviewId is required");
  if (!isNonEmptyString(r.signalId)) errors.push("signalId is required");
  if (!isNonEmptyString(r.reviewer)) errors.push("reviewer is required");
  if (!isNonEmptyString(r.createdAt)) errors.push("createdAt is required");

  const hasNotes = r.notes !== null && isNonEmptyString(r.notes as string | undefined);
  const hasClassification =
    r.classification !== null && isNonEmptyString(r.classification as string | undefined);

  if (!hasNotes && !hasClassification) {
    errors.push("At least one of notes or classification must be provided");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface ReviewStore {
  append(review: OperatorReview): Promise<void>;
  list(limit?: number): Promise<OperatorReview[]>;
  getById(reviewId: string): Promise<OperatorReview | null>;
  getBySignalId(signalId: string): Promise<OperatorReview[]>;
}

// ---------------------------------------------------------------------------
// Filesystem store (JSONL, append-only)
// ---------------------------------------------------------------------------

export class FileReviewStore implements ReviewStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = baseDir;
  }

  private get filePath(): string {
    return join(this.dir, REVIEW_FILE);
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

  private async readAll(): Promise<OperatorReview[]> {
    if (!(await this.fileExists())) {
      return [];
    }
    const content = await readFile(this.filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const reviews: OperatorReview[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const validation = validateOperatorReview(parsed);
      if (!validation.valid) {
        continue;
      }
      reviews.push(parsed as OperatorReview);
    }
    reviews.reverse();
    return reviews;
  }

  async append(review: OperatorReview): Promise<void> {
    const validation = validateOperatorReview(review);
    if (!validation.valid) {
      throw new Error(`Invalid review: ${validation.errors.join("; ")}`);
    }
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(review) + "\n", "utf8");
  }

  async list(limit?: number): Promise<OperatorReview[]> {
    const reviews = await this.readAll();
    return limit !== undefined && limit > 0 ? reviews.slice(0, limit) : reviews;
  }

  async getById(reviewId: string): Promise<OperatorReview | null> {
    const reviews = await this.readAll();
    return reviews.find((r) => r.reviewId === reviewId) ?? null;
  }

  async getBySignalId(signalId: string): Promise<OperatorReview[]> {
    const reviews = await this.readAll();
    return reviews.filter((r) => r.signalId === signalId);
  }
}

// ---------------------------------------------------------------------------
// Reviewer resolution
// ---------------------------------------------------------------------------

/**
 * Resolve operator identity.
 *
 * Precedence:
 * 1. Explicit `--as` override (passed in).
 * 2. `git config user.name` from the current working directory.
 * 3. `USER` environment variable.
 * 4. Fallback literal "operator".
 */
export function resolveReviewer(explicitAs?: string): string {
  if (explicitAs && explicitAs.trim().length > 0) {
    return explicitAs.trim();
  }

  try {
    const gitUser = execSync("git config user.name", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    if (gitUser.length > 0) return gitUser;
  } catch {
    // git not available or not a repo — fall through
  }

  return process.env.USER?.trim() ?? "operator";
}

// ---------------------------------------------------------------------------
// Review creation
// ---------------------------------------------------------------------------

/**
 * Create an OperatorReview for a given signal.
 *
 * Does NOT mutate the signal record — reviewing status is derived
 * from the presence of review records for the signalId.
 *
 * @param reviewId - Unique review ID.
 * @param signalId - ID of the signal being reviewed.
 * @param signal - The fetched signal object (must be truthy — caller should have verified existence).
 * @param reviewerResolved - Resolved reviewer identity.
 * @param notes - Free-text observations (optional if classification provided).
 * @param classification - Re-classification (optional if notes provided).
 * @param now - ISO timestamp for review creation.
 * @returns The created OperatorReview.
 */
export async function createOperatorReview(
  reviewId: string,
  signalId: string,
  signal: unknown,
  reviewerResolved: string,
  notes: string | null,
  classification: string | null,
  now: string,
): Promise<OperatorReview> {
  // Verify signal exists — invariant: review cannot be created for missing signal
  if (!signal) {
    throw new Error(`Signal not found: ${signalId}. Cannot create review for missing signal.`);
  }

  const review: OperatorReview = {
    reviewId,
    signalId,
    reviewer: reviewerResolved,
    notes: notes ?? null,
    classification: classification ?? null,
    createdAt: now,
  };

  const validation = validateOperatorReview(review);
  if (!validation.valid) {
    throw new Error(`Invalid review: ${validation.errors.join("; ")}`);
  }

  return review;
}
