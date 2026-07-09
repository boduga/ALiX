/**
 * P26.2 — Candidate Closure Outcome Recorder.
 *
 * File-based append-only outcome ledger for P25 policy review candidates.
 * Records what humans decided about a candidate without mutating the
 * candidate or transitioning its lifecycle state.
 *
 * P25 remains the lifecycle authority. P26 records outcome evidence after
 * explicit human lifecycle transitions.
 *
 * Store MUST NOT read or write P25 candidate files directly.
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  PolicyReviewOutcome,
  PolicyReviewOutcomeType,
  PolicyReviewOutcomeLedger as LedgerInterface,
  OutcomeFilter,
} from "./policy-review-outcome-types.js";
import { DEFAULT_OUTCOME_ROOT, OUTCOME_TYPES } from "./policy-review-outcome-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function buildOutcomeId(candidateId: string, outcomeType: string, recordedBy: string, rationale: string): string {
  return createHash("sha256")
    .update(["p26", candidateId, outcomeType, recordedBy, rationale.substring(0, 40)].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function outcomePath(rootDir: string, outcomeId: string): string {
  return join(rootDir, `${outcomeId}.json`);
}

// ---------------------------------------------------------------------------
// createPolicyReviewOutcomeLedger
// ---------------------------------------------------------------------------

export function createPolicyReviewOutcomeLedger(opts: {
  rootDir?: string;
}): LedgerInterface {
  const rootDir = opts.rootDir ?? DEFAULT_OUTCOME_ROOT;

  async function ensureDir(): Promise<void> {
    await mkdir(rootDir, { recursive: true });
  }

  async function outcomeExists(outcomeId: string): Promise<boolean> {
    const path = outcomePath(rootDir, outcomeId);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  function validateInputs(opts: {
    recordedBy: string;
    rationale: string;
    outcomeType: string;
  }): void {
    if (!opts.recordedBy || opts.recordedBy.trim().length === 0) {
      throw new Error("recordedBy must be non-empty");
    }
    if (!opts.rationale || opts.rationale.trim().length === 0) {
      throw new Error("rationale must be non-empty");
    }
    if (!OUTCOME_TYPES.includes(opts.outcomeType as PolicyReviewOutcomeType)) {
      throw new Error(`Invalid outcome type: ${opts.outcomeType}`);
    }
  }

  // ---------------------------------------------------------------------------
  // recordOutcome
  // ---------------------------------------------------------------------------

  async function recordOutcome(opts: {
    candidateId: string;
    candidateTitle?: string;
    candidateStateAtRecording?: string;
    linkedEventIds?: string[];
    outcomeType: PolicyReviewOutcomeType;
    recordedBy: string;
    rationale: string;
    evidenceRefs?: string[];
    notes?: string;
  }): Promise<PolicyReviewOutcome> {
    validateInputs(opts);

    const timestamp = now();
    const outcomeId = buildOutcomeId(
      opts.candidateId,
      opts.outcomeType,
      opts.recordedBy,
      opts.rationale,
    );

    // Reject duplicates
    if (await outcomeExists(outcomeId)) {
      throw new Error(`duplicate outcomeId: ${outcomeId} already exists`);
    }

    const outcome: PolicyReviewOutcome = {
      outcomeId,
      candidateId: opts.candidateId,
      candidateTitle: opts.candidateTitle ?? "",
      outcomeType: opts.outcomeType,
      recordedAt: timestamp,
      recordedBy: opts.recordedBy,
      rationale: opts.rationale,
      evidenceRefs: opts.evidenceRefs ?? [],
      candidateStateAtRecording: opts.candidateStateAtRecording ?? "",
      linkedEventIds: opts.linkedEventIds ?? [],
      notes: opts.notes ?? "",
      createdAt: timestamp,
    };

    await ensureDir();
    const path = outcomePath(rootDir, outcome.outcomeId);
    await writeFile(path, JSON.stringify(outcome, null, 2), "utf-8");

    return outcome;
  }

  // ---------------------------------------------------------------------------
  // listOutcomes
  // ---------------------------------------------------------------------------

  async function listOutcomes(opts?: OutcomeFilter): Promise<PolicyReviewOutcome[]> {
    await ensureDir();
    const files: string[] = [];
    try {
      const entries = await readdir(rootDir);
      for (const entry of entries) {
        if (entry.endsWith(".json")) {
          files.push(entry);
        }
      }
    } catch {
      return [];
    }

    const outcomes: PolicyReviewOutcome[] = [];
    for (const file of files) {
      const raw = await readFile(join(rootDir, file), "utf-8");
      try {
        const outcome = JSON.parse(raw) as PolicyReviewOutcome;
        if (opts) {
          if (opts.candidateId && outcome.candidateId !== opts.candidateId) continue;
          if (opts.outcomeType && outcome.outcomeType !== opts.outcomeType) continue;
        }
        outcomes.push(outcome);
      } catch {
        continue;
      }
    }

    // Deterministic sort: createdAt ascending, outcomeId as tie-break
    outcomes.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.outcomeId.localeCompare(b.outcomeId),
    );

    return outcomes;
  }

  // ---------------------------------------------------------------------------
  // getOutcome
  // ---------------------------------------------------------------------------

  async function getOutcome(outcomeId: string): Promise<PolicyReviewOutcome | null> {
    const path = outcomePath(rootDir, outcomeId);
    try {
      await access(path);
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as PolicyReviewOutcome;
    } catch {
      return null;
    }
  }

  return {
    recordOutcome,
    listOutcomes,
    getOutcome,
  };
}
