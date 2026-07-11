/**
 * P9.0c — GovernanceIntegrityBuilder.
 *
 * Pure read-only builder that consumes ProposalExplanation (Explain output).
 * Reads GovernanceReviewStore for review count, then calls the Explain
 * assembler for each review's proposal. All integrity metrics derive from
 * the explanation's explanationIntegrity field:
 *
 *   - reviewsWithProvenance: proposals where evidenceChainUsed === true
 *   - reviewsWithExplanations: proposals where layersAvailable > 0
 *   - reviewsLinkedToOutcomes: proposals where outcomeFound === true
 *   - untraceableFindings: proposals where none of the above
 *
 * P9 does not rebuild Explain logic. The Explain assembler is canonical.
 *
 * CORE INVARIANT: This module NEVER writes to any store. It returns a
 * GovernanceIntegrityReport. The report is later written to GovernanceStore
 * by the CLI (Task 6).
 *
 * @module
 */

import { join } from "node:path";
import { GovernanceReviewStore } from "../adaptation/governance-review-store.js";
import { assembleProposalExplanation } from "../explain/proposal-explanation-assembler.js";
import type { GovernanceIntegrityReport } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOVERNANCE_REVIEWS_DIR = join(".alix", "governance-reviews");

const DEFAULT_WINDOW_DAYS = 90;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Round a fraction to 1 decimal place. Returns 0 when denominator is 0
 * (avoids divide-by-zero and NaN).
 */
function rate1dp(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// buildGovernanceIntegrity
// ---------------------------------------------------------------------------

/**
 * Build a GovernanceIntegrityReport by consuming Explanation outputs for
 * every governance review in the configured window.
 *
 * Uses the canonical `assembleProposalExplanation` from the Explain module.
 * All metrics derive from `ProposalExplanation.explanationIntegrity` —
 * this builder does NOT query any other P8 store directly beyond
 * GovernanceReviewStore for the review list.
 */
export async function buildGovernanceIntegrity(opts: {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}): Promise<GovernanceIntegrityReport> {
  const { cwd, windowDays = DEFAULT_WINDOW_DAYS } = opts;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();

  // ---- 1. Read governance reviews within the window ----------------------
  const reviewStore = new GovernanceReviewStore(join(cwd, GOVERNANCE_REVIEWS_DIR));
  const reviews = await reviewStore.queryByWindow(windowDays);

  // ---- 2. Assemble an explanation for each reviewed proposal -------------
  const explanations = await Promise.all(
    reviews.map((review) =>
      assembleProposalExplanation({
        proposalId: review.proposalId,
        cwd,
        windowDays,
        executionEvidence: [],
        executionLineageRefs: [],
      }),
    ),
  );

  // ---- 3. Tally metrics from explanationIntegrity ------------------------
  let reviewsWithProvenance = 0;
  let reviewsWithExplanations = 0;
  let reviewsLinkedToOutcomes = 0;
  let untraceableFindings = 0;

  for (const expl of explanations) {
    const integrity = expl.explanationIntegrity;
    let traceable = false;

    if (integrity.evidenceChainUsed) {
      reviewsWithProvenance++;
      traceable = true;
    }
    if (integrity.layersAvailable > 0) {
      reviewsWithExplanations++;
      traceable = true;
    }
    if (integrity.outcomeFound) {
      reviewsLinkedToOutcomes++;
      traceable = true;
    }
    if (!traceable) {
      untraceableFindings++;
    }
  }

  const total = reviews.length;

  // ---- 4. Build and return the report ------------------------------------
  return {
    id: `gov-integrity-${generatedAt}`,
    subject: `Governance Integrity Report — ${windowDays}d window`,
    outcome: "informational",
    confidence: 1,
    reasons: [
      `Analyzed ${total} governance reviews for integrity metrics`,
      `Provenance rate: ${rate1dp(reviewsWithProvenance, total)}%`,
      `Explanation rate: ${rate1dp(reviewsWithExplanations, total)}%`,
      `Outcome link rate: ${rate1dp(reviewsLinkedToOutcomes, total)}%`,
    ],
    evidenceRefs: [],
    generatedAt,
    reportType: "governance_integrity",
    metrics: {
      totalReviews: total,
      reviewsWithProvenance,
      reviewsWithExplanations,
      reviewsLinkedToOutcomes,
      untraceableFindings,
      provenanceRate: rate1dp(reviewsWithProvenance, total),
      explanationRate: rate1dp(reviewsWithExplanations, total),
      outcomeLinkRate: rate1dp(reviewsLinkedToOutcomes, total),
    },
  };
}
