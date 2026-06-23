/**
 * P8.5c.2 — ProposalExplanation assembler.
 *
 * Pure read-only aggregation. Walks 4 stores (Outcome, Recommendation,
 * Risk, Governance) + (in Task 3) EvidenceChain graph + Learning/Calibration
 * stores, and assembles an ephemeral ProposalExplanation view-model.
 *
 * CORE INVARIANT: this module NEVER writes any store, evidence chain,
 * adapter, proposal surface. Explain reads. Sentinel-enforced in Task 5.
 *
 * Layer-resolution priority (locked):
 *   1. EvidenceChain traversal (Task 3 — not yet implemented here)
 *   2. Direct-id OutcomeRecord (recommendationId / riskScoreId /
 *      governanceReviewId) — this task
 *   3. Proposal-based fallback (filter by proposalId / proposal-scoped
 *      query — cross-proposal isolation invariant) — this task
 *   4. String heuristic on subject/sourceReportId (Task 3, deprecated
 *      post-P9; only used for Learning signals)
 *
 * This file ships priorities 2 + 3 for the four persisted layers.
 * Priority 1 (chain) + Learning/Calibration layers are filled by Task 3.
 */

import { join } from "node:path";
import { OutcomeStore } from "../adaptation/outcome-store.js";
import { ApprovalRecommendationStore } from "../adaptation/approval-recommendation-store.js";
import { RiskScoreStore } from "../adaptation/risk-score-store.js";
import { GovernanceReviewStore } from "../adaptation/governance-review-store.js";
import { riskOutcomeFromScore } from "../adaptation/risk-score-types.js";
import type { JoinPath, ProposalExplanation, OutcomeLayer, RecommendationLayer, RiskLayer, GovernanceLayer, UnavailableLayer, ExplanationIntegrity } from "./proposal-explanation-types.js";

// ---------------------------------------------------------------------------
// Constants — store directory layout (mirrors the per-store STORE_DIR).
// ---------------------------------------------------------------------------

const OUTCOMES_DIR = join(".alix", "outcomes");
const RECOMMENDATIONS_DIR = join(".alix", "recommendations");
const RISK_SCORES_DIR = join(".alix", "risk-scores");
const GOVERNANCE_REVIEWS_DIR = join(".alix", "governance-reviews");

/**
 * Refresh hint rendered when the Learning layer is empty. Real learning
 * data is assembled in Task 3; in Task 2 the Learning layer is always
 * empty so the hint is always returned.
 */
const REFRESH_HINT =
  "Learning layer empty — run `alix learning refresh` to populate signals, or the proposal has no recorded learning within the window.";

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

export interface AssembleProposalExplanationOptions {
  proposalId: string;
  cwd: string;
  windowDays: number;
}

// ---------------------------------------------------------------------------
// assembleProposalExplanation
// ---------------------------------------------------------------------------

/**
 * Assemble a ProposalExplanation view-model by walking the 4 persisted
 * decision-lifecycle stores. Read-only. See module doc for the layer
 * resolution priority ladder.
 */
export async function assembleProposalExplanation(
  opts: AssembleProposalExplanationOptions,
): Promise<ProposalExplanation> {
  const { proposalId, cwd, windowDays } = opts;
  const generatedAt = new Date().toISOString();

  // Track whether any layer used a fallback join (for explanationIntegrity).
  let fallbackJoinsUsed = false;
  // Task 3 will populate both of these via EvidenceChain traversal.
  let incompleteChainLayers = 0;
  let evidenceChainUsed = false;

  // ---- Layer 1: Outcome ------------------------------------------------
  // Outcome is always proposal-scoped (queried by subjectId === proposalId).
  // There is no direct-id or chain join for the Outcome itself — the
  // OutcomeRecord IS the proposal anchor. joinPath is therefore always
  // proposal_fallback in the Task 2 terminology.
  const outcomeStore = new OutcomeStore(join(cwd, OUTCOMES_DIR));
  const matchingOutcomes = await outcomeStore.queryBySubject(proposalId).catch(() => []);
  matchingOutcomes.sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
  );
  const mostRecentOutcome = matchingOutcomes[0];

  const outcome: OutcomeLayer | UnavailableLayer = mostRecentOutcome
    ? {
        status: "available",
        outcome: mostRecentOutcome.outcome,
        observedAt: mostRecentOutcome.generatedAt,
        sourceArtifactIds: [mostRecentOutcome.id],
        // Outcome is always proposal-scoped (no direct-id or chain link for
        // the OutcomeRecord itself — it is the anchor artifact).
        joinPath: "proposal_fallback",
      }
    : {
        status: "not_available",
        reason: `no OutcomeRecord for proposal ${proposalId}`,
      };

  // ---- Layer 2: Recommendation (direct-id → proposal-fallback) ---------
  let recommendation: RecommendationLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no ApprovalRecommendation linked to proposal ${proposalId}`,
  };

  const recStore = new ApprovalRecommendationStore(join(cwd, RECOMMENDATIONS_DIR));
  // Priority 2: direct-id from OutcomeRecord.recommendationId.
  if (mostRecentOutcome?.recommendationId) {
    const rec = await recStore.get(mostRecentOutcome.recommendationId).catch(() => null);
    if (rec) {
      // Note: ApprovalRecommendation carries `recommendation` (the typed
      // field). Some persisted fixtures (P7.5p.1 era + test fixtures) also
      // carry a `decision` alias; prefer the typed field, fall back to the
      // alias for backwards-compat with existing stores.
      const recAny = rec as unknown as Record<string, unknown>;
      const decision =
        (recAny["recommendation"] as string | undefined) ??
        (recAny["decision"] as string | undefined) ??
        "unknown";
      recommendation = {
        status: "available",
        recommendationId: rec.id,
        decision,
        confidence: rec.confidence,
        reasons: rec.reasons,
        sourceArtifactIds: [rec.id],
        joinPath: "direct_id",
      };
    }
  }
  // Priority 3: proposal-scoped fallback (list().filter(proposalId)).
  if (recommendation.status === "not_available") {
    const allRecs = await recStore.list().catch(() => []);
    const matching = allRecs.find((r) => r.proposalId === proposalId);
    if (matching) {
      const recAny = matching as unknown as Record<string, unknown>;
      const decision =
        (recAny["recommendation"] as string | undefined) ??
        (recAny["decision"] as string | undefined) ??
        "unknown";
      recommendation = {
        status: "available",
        recommendationId: matching.id,
        decision,
        confidence: matching.confidence,
        reasons: matching.reasons,
        sourceArtifactIds: [matching.id],
        joinPath: "proposal_fallback",
      };
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layer 3: Risk (direct-id → proposal-fallback) -------------------
  let risk: RiskLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no RiskScore linked to proposal ${proposalId}`,
  };

  const riskStore = new RiskScoreStore(join(cwd, RISK_SCORES_DIR));

  const buildRiskLayer = (r: import("../adaptation/risk-score-types.js").RiskScore): RiskLayer => {
    const dimensions = Object.entries(r.dimensions).map(([dim, score]) => {
      const item = r.risks.find((x) => x.dimension === dim);
      return {
        dimension: dim as import("../adaptation/risk-score-types.js").RiskDimension,
        score,
        confidence: item?.confidence ?? 0,
        reasons: item?.reasons ?? [],
      };
    });
    return {
      status: "available",
      riskScoreId: r.id,
      overallRisk: r.overallRisk,
      outcome: riskOutcomeFromScore(r.overallRisk),
      dimensions,
      sourceArtifactIds: [r.id],
      joinPath: "direct_id",
    };
  };

  // Priority 2: direct-id from OutcomeRecord.riskScoreId.
  if (mostRecentOutcome?.riskScoreId) {
    const r = await riskStore.get(mostRecentOutcome.riskScoreId).catch(() => null);
    if (r) {
      risk = buildRiskLayer(r);
    }
  }
  // Priority 3: proposal-scoped fallback. RiskScore id format is
  // `risk-<proposalId>` (confirmed at src/adaptation/risk-score-builder.ts).
  if (risk.status === "not_available") {
    const allRisks = await riskStore.queryByWindow(windowDays).catch(() => []);
    const matching = allRisks.find((r) => r.id === `risk-${proposalId}`);
    if (matching) {
      const layer = buildRiskLayer(matching);
      risk = { ...layer, joinPath: "proposal_fallback" };
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layer 4: Governance (direct-id → proposal-fallback) -------------
  let governance: GovernanceLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no GovernanceReview linked to proposal ${proposalId}`,
  };

  const govStore = new GovernanceReviewStore(join(cwd, GOVERNANCE_REVIEWS_DIR));

  const buildGovernanceLayer = (
    g: import("../adaptation/governance-review-types.js").GovernanceReview,
    joinPath: JoinPath,
  ): GovernanceLayer => ({
    status: "available",
    reviewId: g.id,
    verdict: g.verdict,
    concerns: g.concerns,
    lensScores: g.lensScores.map((ls) => ({
      lens: ls.lens,
      verdict: ls.recommendedVerdict,
      confidence: ls.confidence,
    })),
    sourceArtifactIds: [g.id],
    joinPath,
  });

  // Priority 2: direct-id from OutcomeRecord.governanceReviewId.
  if (mostRecentOutcome?.governanceReviewId) {
    const g = await govStore.get(mostRecentOutcome.governanceReviewId).catch(() => null);
    if (g) {
      governance = buildGovernanceLayer(g, "direct_id");
    }
  }
  // Priority 3: proposal-scoped fallback. MUST use queryByProposal —
  // cross-proposal isolation invariant (never list().at(-1)).
  if (governance.status === "not_available") {
    const forProposal = await govStore.queryByProposal(proposalId).catch(() => []);
    if (forProposal.length > 0) {
      // queryByProposal returns oldest-first; the LAST element is the most
      // recent review (per the store's documented contract).
      const mostRecentReview = forProposal[forProposal.length - 1];
      governance = buildGovernanceLayer(mostRecentReview, "proposal_fallback");
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layers 5 + 6 (filled in Task 3) ---------------------------------
  // Learning + Calibration layers. Empty placeholders in Task 2 — Task 3
  // adds EvidenceChain traversal + Learning/Calibration store reads.
  const learning = {
    signalsByAdapter: {} as Record<string, never[]>,
    adaptersWithSignals: [] as string[],
    totalSignals: 0,
  };
  const calibration = {
    profilesByTarget: {} as Record<string, never[]>,
    adjustments: [] as {
      target: string;
      previousValue: number;
      suggestedValue: number;
      reason: string;
    }[],
  };

  // ---- ExplanationIntegrity (preliminary — refined in Task 3) ---------
  const outcomeFound = outcome.status === "available";
  const recommendationFound = recommendation.status === "available";
  const riskFound = risk.status === "available";
  const governanceFound = governance.status === "available";
  const learningFound = false; // Task 3
  const calibrationFound = false; // Task 3
  const found = [
    outcomeFound,
    recommendationFound,
    riskFound,
    governanceFound,
    learningFound,
    calibrationFound,
  ];
  const layersAvailable = found.filter(Boolean).length;

  const explanationIntegrity: ExplanationIntegrity = {
    outcomeFound,
    recommendationFound,
    riskFound,
    governanceFound,
    learningFound,
    calibrationFound,
    evidenceChainUsed,
    fallbackJoinsUsed,
    incompleteChainLayers,
    totalLayers: 6,
    layersAvailable,
    completenessPercent: Math.round((layersAvailable / 6) * 1000) / 10,
  };

  return {
    proposalId,
    generatedAt,
    windowDays,
    outcome,
    recommendation,
    risk,
    governance,
    learning,
    calibration,
    explanationIntegrity,
    learningRefreshHint: learningFound ? null : REFRESH_HINT,
  };
}
