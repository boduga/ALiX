/**
 * P9.3 — GovernanceApprovalCriteria.
 *
 * Pure read-only validation module for governance_change proposals.
 * Checks 6 criteria before allowing a governance proposal to proceed
 * to approval. The status-pending check is owned by ApprovalGate
 * via requirePending() — the criteria module does not duplicate it.
 *
 * CORE INVARIANT: This module NEVER writes to any store. It returns a
 * GovernanceCriteriaResult. The caller (ApprovalGate) records evidence
 * and transitions status.
 *
 * Sentinel-enforced: this file may import EvidenceChainStore (read-only)
 * and the explain assembler (read-only). It must NOT import ProposalStore,
 * ApprovalGate, any applier, or call any write/mutation method.
 *
 * @module
 */

import { join } from "node:path";
import { EvidenceChainStore } from "../learning/evidence-chain-store.js";
import { GovernanceStore } from "./governance-store.js";
import { assembleProposalExplanation } from "../explain/proposal-explanation-assembler.js";
import type { AdaptationProposal, ProposalTarget } from "../adaptation/adaptation-types.js";
import type { GovernanceCriteriaResult } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Core invariant: status-pending is checked by ApprovalGate.
 * This module checks the remaining 6 criteria.
 */

/**
 * Confidence threshold for the source recommendation (0–1 scale).
 * Aligned with P9.2 confidence gate default.
 */
const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Integrity threshold for explanation completeness (0–100 scale).
 * Aligned with the completenessPercent formula: (layersAvailable / 6) * 100.
 * Maps to >= 4 of 6 layers available.
 */
const EXPLANATION_INTEGRITY_THRESHOLD = 60;

const DEFAULT_WINDOW_DAYS = 90;

const EVIDENCE_CHAINS_DIR = join(".alix", "learning");

// ---------------------------------------------------------------------------
// runGovernanceCriteria
// ---------------------------------------------------------------------------

/**
 * Run all governance approval criteria against a governance_change proposal.
 *
 * Returns a GovernanceCriteriaResult. `passed === true` means all 6 criteria
 * passed. `passed === false` means at least one criterion failed; the
 * `failedCriterion` field identifies which one.
 *
 * Read-only. Never writes to any store.
 */
export async function runGovernanceCriteria(opts: {
  proposal: AdaptationProposal;
  cwd: string;
  windowDays?: number;
}): Promise<GovernanceCriteriaResult> {
  const { proposal, cwd } = opts;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Resolve the source recommendation ID from the proposal target first
  // (needed by both EvidenceChain check and recommendation lookup).
  const target = proposal.target as ProposalTarget & { recommendationId?: string };
  const recommendationId = target.recommendationId;

  // Criterion 1: must not be orphaned
  if (proposal.systemState?.orphaned === true) {
    return { passed: false, failedCriterion: "proposal is orphaned" };
  }

  // Criterion 2: EvidenceChain must have a proposal_from_recommendation edge
  // matching the current proposal's source recommendation.
  const chainStore = new EvidenceChainStore(join(cwd, EVIDENCE_CHAINS_DIR));
  const chains = await chainStore.getChainForRoot(proposal.id).catch(() => []);
  const hasMatchingEdge = chains.some((chain) =>
    chain.links.some(
      (link) =>
        link.relationship === "proposal_from_recommendation" &&
        link.targetArtifactId === recommendationId,
    ),
  );
  if (!hasMatchingEdge) {
    return {
      passed: false,
      failedCriterion: `no proposal_from_recommendation edge for recommendation ${recommendationId ?? "missing"}`,
    };
  }

  // Criterion 3: source recommendation must exist
  const govStore = new GovernanceStore(join(cwd, ".alix", "governance"));
  const foundResult = recommendationId
    ? await govStore.findRecommendationById(recommendationId).catch(() => null)
    : null;
  if (!foundResult) {
    return {
      passed: false,
      failedCriterion: `source recommendation not found: ${recommendationId ?? "missing"}`,
    };
  }
  const recommendation = foundResult.rec;

  // Criterion 4: source recommendation confidence must be >= threshold (0–1 scale)
  if (recommendation.confidence < CONFIDENCE_THRESHOLD) {
    return {
      passed: false,
      failedCriterion: `source recommendation confidence ${recommendation.confidence} is below threshold ${CONFIDENCE_THRESHOLD}`,
    };
  }

  // Criterion 5: source recommendation status must be "open"
  if (recommendation.status !== "open") {
    return {
      passed: false,
      failedCriterion: `source recommendation status is "${recommendation.status}", expected "open"`,
    };
  }

  // Criterion 6: explanation must assemble with integrity >= threshold (0–100 scale)
  let integrityScore = 0;
  try {
    const explanation = await assembleProposalExplanation({
      proposalId: proposal.id,
      cwd,
      windowDays,
    });
    integrityScore = explanation.explanationIntegrity.completenessPercent;
    if (integrityScore < EXPLANATION_INTEGRITY_THRESHOLD) {
      return {
        passed: false,
        failedCriterion: `explanation integrity score ${integrityScore} is below threshold ${EXPLANATION_INTEGRITY_THRESHOLD}`,
        integrityScore,
      };
    }
  } catch {
    return {
      passed: false,
      failedCriterion: "explanation assembly failed",
      integrityScore: 0,
    };
  }

  // All 6 criteria passed
  return {
    passed: true,
    integrityScore,
    details: {
      recommendationId,
      recommendationConfidence: recommendation.confidence,
      recommendationStatus: recommendation.status,
      proposalAction: proposal.action,
    },
  };
}
