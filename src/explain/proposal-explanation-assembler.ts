/**
 * P8.5c.3 — ProposalExplanation assembler.
 *
 * Pure read-only aggregation. Walks 4 persisted decision-lifecycle stores
 * (Outcome, Recommendation, Risk, Governance) + EvidenceChain graph +
 * Learning/Calibration stores, assembles ephemeral ProposalExplanation
 * view-model.
 *
 * CORE INVARIANT: module NEVER writes any store, evidence chain, adapter,
 * proposal surface. Explain reads. Sentinel-enforced in Task 5.
 *
 * Layer-resolution priority (locked):
 * 1. EvidenceChain traversal (Task 3)
 * 2. Direct-id OutcomeRecord (recommendationId / riskScoreId /
 *    governanceReviewId) — Task 2
 * 3. Proposal-based fallback (filter proposalId / proposal-scoped
 *    query — cross-proposal isolation invariant) — Task 2
 * 4. String heuristic on subject/sourceReportId (Task 3, deprecated
 *    post-P9; LOCKED to Learning + Calibration layers ONLY)
 *
 * This file ships all four priorities across six persisted layers.
 */

import { join } from "node:path";
import { OutcomeStore } from "../adaptation/outcome-store.js";
import { ApprovalRecommendationStore } from "../adaptation/approval-recommendation-store.js";
import { RiskScoreStore } from "../adaptation/risk-score-store.js";
import { GovernanceReviewStore } from "../adaptation/governance-review-store.js";
import { LearningStore } from "../learning/learning-store.js";
import { EvidenceChainStore } from "../learning/evidence-chain-store.js";
import { EXPLAIN_MAX_DEPTH } from "../learning/evidence-chain-types.js";
import type { LearningSignal, CalibrationProfile } from "../learning/learning-types.js";
import type { RiskScore, RiskDimension, RiskOutcome } from "../adaptation/risk-score-types.js";
import type { GovernanceReview } from "../adaptation/governance-review-types.js";
import type {
  JoinPath,
  ProposalExplanation,
  OutcomeLayer,
  RecommendationLayer,
  RiskLayer,
  GovernanceLayer,
  ExecutionLayer,
  LearningLayer,
  CalibrationLayer,
  UnavailableLayer,
  ExplanationIntegrity,
} from "./proposal-explanation-types.js";
import type { ExecutionEvidence } from "../runtime/contracts/execution-intent-contract.js";
import type { ExecutionLineageRef } from "../governance/governance-execution-types.js";

// ---------------------------------------------------------------------------
// Constants — store directory layout (mirrors per-store STORE_DIR).
// ---------------------------------------------------------------------------

const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
const RECOMMENDATIONS_DIR = join(".alix", "recommendations");
const RISK_SCORES_DIR = join(".alix", "risk-scores");
const GOVERNANCE_REVIEWS_DIR = join(".alix", "governance-reviews");
const LEARNING_DIR = join(".alix", "learning");

const REFRESH_HINT =
  "Learning layer is empty for this proposal. Run `alix learning refresh` to regenerate signals from recent outcomes.";

export interface AssembleProposalExplanationOptions {
  proposalId: string;
  cwd: string;
  windowDays: number;
  executionEvidence: readonly ExecutionEvidence[];
  executionLineageRefs: readonly ExecutionLineageRef[];
  /**
   * Optional \"now\" anchor for deterministic window joins. Defaults to
   * wall-clock; threads through to the LearningStore and OutcomeStore
   * window reads so fixed-fixture test data doesn't drift past the
   * 30-day cutoff as time passes.
   */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// resolveChainReachable — Priority 1 helper (EvidenceChain traversal)
// ---------------------------------------------------------------------------

/**
 * Resolve the set of artifact IDs reachable from `rootArtifactId` via the
 * EvidenceChain graph. Walks `chain.links` for every chain rooted at the
 * given artifact, collecting target IDs up to EXPLAIN_MAX_DEPTH hops.
 *
 * Returns `{ reachable, usedChain }`. `usedChain` is true when at least
 * one chain exists for the root (so `evidenceChainUsed` can be set even
 * if the chain is broken/orphaned — see incompleteChainLayers).
 *
 * Read-only. Calls only `getChainForRoot`.
 */
async function resolveChainReachable(
  chainStore: EvidenceChainStore,
  rootArtifactId: string,
): Promise<{ reachable: Set<string>; usedChain: boolean }> {
  const reachable = new Set<string>();
  let usedChain = false;
  if (!rootArtifactId) return { reachable, usedChain };
  const chains = await chainStore.getChainForRoot(rootArtifactId).catch(() => []);
  if (chains.length === 0) return { reachable, usedChain };
  usedChain = true;
  for (const chain of chains) {
    let hops = 0;
    for (const link of chain.links) {
      if (hops >= EXPLAIN_MAX_DEPTH) break;
      hops++;
      if (link.targetArtifactId) reachable.add(link.targetArtifactId);
    }
  }
  return { reachable, usedChain };
}

// ---------------------------------------------------------------------------
// assembleProposalExplanation
// ---------------------------------------------------------------------------

/**
 * Assemble ProposalExplanation view-model by walking 6 persisted stores +
 * the EvidenceChain graph. Read-only. See module doc for the layer
 * resolution priority ladder.
 */
export async function assembleProposalExplanation(
  opts: AssembleProposalExplanationOptions,
): Promise<ProposalExplanation> {
  const { proposalId, cwd, windowDays, executionEvidence, executionLineageRefs } = opts;
  // Caller may pin `now` for deterministic joins against fixed-fixture
  // test data. Defaults to wall clock, which is fine for production use
  // but causes silent drift past 30-day cutoff on historical fixtures.
  const generatedAt = opts.generatedAt ?? new Date().toISOString();

  // Track integrity flags across all layers.
  let fallbackJoinsUsed = false;
  let evidenceChainUsed = false;
  // Distinct chain-linked artifact ids whose store lookup failed (orphans).
  // Counted once across all three layer loops (Recommendation/Risk/Governance)
  // regardless of how many loops re-iterate the same reachable set, so a single
  // broken chain edge reports `incompleteChainLayers === 1`, not 3x.
  // Direct-id misses only count when a chain is actually in use for this
  // proposal (evidenceChainUsed === true) — a no-chain direct-id miss is a
  // stale foreign key, not a chain failure, and must NOT set
  // incompleteChainLayers while evidenceChainUsed stays false.
  const orphanedChainTargets = new Set<string>();

  // ---- Layer 1: Outcome ------------------------------------------------
  // Outcome is always proposal-scoped (queried by subjectId === proposalId).
  // There is no direct-id or chain join for Outcome itself — OutcomeRecord
  // IS the proposal anchor. joinPath therefore always proposal_fallback.
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
        // Outcome is always proposal-scoped (no direct-id or chain link to
        // OutcomeRecord itself — anchor artifact).
        joinPath: "proposal_fallback",
      }
    : { status: "not_available", reason: `no OutcomeRecord for proposal ${proposalId}` };

  // ---- EvidenceChain graph (Priority 1 for layers 2-4) -----------------
  const chainStore = new EvidenceChainStore(join(cwd, LEARNING_DIR));
  let chainReachable = new Set<string>();
  if (mostRecentOutcome) {
    const { reachable, usedChain } = await resolveChainReachable(chainStore, mostRecentOutcome.id);
    chainReachable = reachable;
    if (usedChain) evidenceChainUsed = true;
  }

  // ---- Layer 2: Recommendation (chain → direct-id → proposal fallback) -
  let recommendation: RecommendationLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no ApprovalRecommendation linked to proposal ${proposalId}`,
  };

  const recStore = new ApprovalRecommendationStore(join(cwd, RECOMMENDATIONS_DIR));

  // Helper: build an available recommendation layer from a record.
  // Some persisted fixtures (P7.5p.1 era + test fixtures) carry a
  // `recommendation` alias; prefer the typed `decision` field, fall back to
  // alias for backwards-compat with existing stores.
  const buildRecommendationLayer = (
    rec: {
      id: string;
      confidence: number | undefined;
      reasons: string[];
      proposalId?: string;
      decision?: string;
      recommendation?: string;
    },
    joinPath: JoinPath,
  ): RecommendationLayer => {
    const recAny = rec as unknown as Record<string, unknown>;
    const decision =
      (recAny["recommendation"] as string | undefined) ??
      (recAny["decision"] as string | undefined) ??
      "unknown";
    return {
      status: "available",
      recommendationId: rec.id,
      decision,
      confidence: rec.confidence,
      reasons: rec.reasons,
      sourceArtifactIds: [rec.id],
      joinPath,
    };
  };

  // Priority 1: EvidenceChain traversal. For each chain-reachable target,
  // attempt to load it from the recommendation store; on a hit that
  // matches the proposal, mark evidence_chain. A chain link to a missing
  // artifact (orphan) records its target id for deduplicated counting.
  if (recommendation.status === "not_available") {
    for (const targetId of chainReachable) {
      const rec = await recStore.get(targetId).catch(() => null);
      if (rec && rec.proposalId === proposalId) {
        recommendation = buildRecommendationLayer(rec, "evidence_chain");
        break;
      }
      // Chain-referenced artifact missing from this store (orphan). Record
      // the distinct target id; counted once across all layer loops.
      orphanedChainTargets.add(targetId);
    }
  }
  // Priority 2: direct-id from OutcomeRecord.recommendationId.
  // A direct-id miss only counts as a chain failure when a chain is in use
  // for this proposal; otherwise it is a stale foreign key, not a chain edge.
  if (recommendation.status === "not_available" && mostRecentOutcome?.recommendationId) {
    const rec = await recStore.get(mostRecentOutcome.recommendationId).catch(() => null);
    if (rec) {
      recommendation = buildRecommendationLayer(rec, "direct_id");
    } else if (evidenceChainUsed) {
      orphanedChainTargets.add(mostRecentOutcome.recommendationId);
    }
  }
  // Priority 3: proposal-scoped fallback (list().filter(proposalId)).
  if (recommendation.status === "not_available") {
    const allRecs = await recStore.list().catch(() => []);
    const matching = allRecs.find((r) => r.proposalId === proposalId);
    if (matching) {
      recommendation = buildRecommendationLayer(matching, "proposal_fallback");
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layer 3: Risk (chain → direct-id → proposal-fallback) -----------
  let risk: RiskLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no RiskScore linked to proposal ${proposalId}`,
  };

  const riskStore = new RiskScoreStore(join(cwd, RISK_SCORES_DIR));

  const buildRiskLayer = (
    r: RiskScore,
    joinPath: JoinPath,
  ): RiskLayer => {
    const overallRisk = r.overallRisk;
    const outcomeVal: RiskOutcome =
      overallRisk < 0.3 ? "low" : overallRisk < 0.6 ? "medium" : overallRisk < 0.85 ? "high" : "critical";
    const dimensions = Object.entries(r.dimensions).map(([dim, score]) => ({
      dimension: dim as RiskDimension,
      score,
      confidence: r.risks.find((x: { dimension: string }) => x.dimension === dim)?.confidence ?? 0,
      reasons: r.risks.find((x: { dimension: string }) => x.dimension === dim)?.reasons ?? [],
    }));
    return {
      status: "available",
      riskScoreId: r.id,
      overallRisk,
      outcome: outcomeVal,
      dimensions,
      sourceArtifactIds: [r.id],
      joinPath,
    };
  };

  // Priority 1: EvidenceChain traversal. RiskScore carries no proposalId
  // field, so the only scope check available is the ID convention
  // `risk-<proposalId>` (used at Priority 3). Reject chain targets that do
  // not match this proposal to avoid cross-proposal data leakage.
  if (risk.status === "not_available") {
    for (const targetId of chainReachable) {
      if (targetId !== `risk-${proposalId}`) {
        continue;
      }
      const r = await riskStore.get(targetId).catch(() => null);
      if (r) {
        risk = buildRiskLayer(r, "evidence_chain");
        break;
      }
      orphanedChainTargets.add(targetId);
    }
  }
  // Priority 2: direct-id OutcomeRecord.riskScoreId.
  // A direct-id miss only counts as a chain failure when a chain is in use
  // for this proposal; otherwise it is a stale foreign key, not a chain edge.
  if (risk.status === "not_available" && mostRecentOutcome?.riskScoreId) {
    const r = await riskStore.get(mostRecentOutcome.riskScoreId).catch(() => null);
    if (r) {
      risk = buildRiskLayer(r, "direct_id");
    } else if (evidenceChainUsed) {
      orphanedChainTargets.add(mostRecentOutcome.riskScoreId);
    }
  }
  // Priority 3: proposal-scoped fallback. RiskScore IDs follow `risk-<proposalId>`
  // (confirmed at src/adaptation/risk-score-builder.ts).
  if (risk.status === "not_available") {
    // Thread `generatedAt` through so the windowed read sees the same
    // `now` the rest of the assembler is using. Without this the join
    // silently drops historical fixtures past the wall-clock cutoff.
    const allRisks = await riskStore.queryByWindow(windowDays, generatedAt).catch(() => []);
    const matching = allRisks.find((r) => r.id === `risk-${proposalId}`);
    if (matching) {
      risk = buildRiskLayer(matching, "proposal_fallback");
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layer 4: Governance (chain → direct-id → proposal-fallback) -----
  let governance: GovernanceLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no GovernanceReview linked to proposal ${proposalId}`,
  };

  const govStore = new GovernanceReviewStore(join(cwd, GOVERNANCE_REVIEWS_DIR));

  const buildGovernanceLayer = (
    g: GovernanceReview,
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

  // Priority 1: EvidenceChain traversal.
  if (governance.status === "not_available") {
    for (const targetId of chainReachable) {
      const g = await govStore.get(targetId).catch(() => null);
      if (g && g.proposalId === proposalId) {
        governance = buildGovernanceLayer(g, "evidence_chain");
        break;
      }
      orphanedChainTargets.add(targetId);
    }
  }
  // Priority 2: direct-id OutcomeRecord.governanceReviewId.
  // A direct-id miss only counts as a chain failure when a chain is in use
  // for this proposal; otherwise it is a stale foreign key, not a chain edge.
  if (governance.status === "not_available" && mostRecentOutcome?.governanceReviewId) {
    const g = await govStore.get(mostRecentOutcome.governanceReviewId).catch(() => null);
    if (g) {
      governance = buildGovernanceLayer(g, "direct_id");
    } else if (evidenceChainUsed) {
      orphanedChainTargets.add(mostRecentOutcome.governanceReviewId);
    }
  }
  // Priority 3: proposal-scoped fallback. MUST use queryByProposal
  // (cross-proposal isolation invariant — never list().at(-1)).
  if (governance.status === "not_available") {
    const matching = await govStore.queryByProposal(proposalId).catch(() => null);
    if (matching && matching.length > 0) {
      const mostRecentReview = matching[matching.length - 1];
      governance = buildGovernanceLayer(mostRecentReview, "proposal_fallback");
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layer 5: Execution (passed as parameters — not from store) ------
  const link = executionLineageRefs.find((ref) => ref.candidateId === proposalId);
  const matched = link
    ? executionEvidence.find((e) => e.evidenceId === link.evidenceId)
    : undefined;

  const execution: ExecutionLayer | UnavailableLayer = matched
    ? {
        status: "available",
        evidenceId: matched.evidenceId,
        intentId: matched.intentId,
        evidenceHash: matched.evidenceHash,
        outcome: matched.outcome,
        completedAt: matched.completedAt,
        verificationPassed: matched.verificationPassed,
        summary: matched.summary,
      }
    : { status: "not_available", reason: `no ExecutionEvidence for proposal ${proposalId}` };

  // ---- Layer 6: Learning Signals (chain → heuristic) -------------------
  // String heuristics are LOCKED to Learning + Calibration layers only.
  const learningStore = new LearningStore(join(cwd, LEARNING_DIR));
  // Thread `generatedAt` through to deterministic window reads — the
  // assembler is supposed to be a pure, replayable function, and the
  // LearningStore's window filter would otherwise drift past the
  // fixture dates as wall-clock time passes.
  const allSignals = await learningStore.querySignals({ windowDays, now: generatedAt }).catch(() => []);
  const allProfiles = await learningStore.queryProfiles({ windowDays, now: generatedAt }).catch(() => []);

  // Collect proposal-scoped artifact ids for chain-root resolution.
  const proposalArtifactIds = new Set<string>();
  if (mostRecentOutcome) proposalArtifactIds.add(mostRecentOutcome.id);
  if (recommendation.status === "available")
    proposalArtifactIds.add((recommendation as RecommendationLayer).recommendationId);
  if (risk.status === "available") proposalArtifactIds.add((risk as RiskLayer).riskScoreId);
  if (governance.status === "available")
    proposalArtifactIds.add((governance as GovernanceLayer).reviewId);

  // Inbound chain edges: find chain roots whose links target any
  // proposal-scoped artifact. Signals whose id equals such a root are
  // reachable via the chain.
  const allChains = await chainStore.listChains().catch(() => []);
  const chainRootsForSignals = new Set<string>();
  for (const chain of allChains) {
    for (const link of chain.links) {
      if (proposalArtifactIds.has(link.targetArtifactId)) {
        chainRootsForSignals.add(chain.rootArtifactId);
        evidenceChainUsed = true;
      }
    }
  }

  const matchingSignals: LearningSignal[] = [];
  // Priority 1+2: chain-reachable signals.
  for (const sig of allSignals) {
    if (chainRootsForSignals.has(sig.id)) {
      matchingSignals.push(sig);
    }
  }
  // Priority 3: string heuristic fallback (subject/sourceReportId contains proposalId).
  // LOCKED invariant: heuristics permitted ONLY in Learning + Calibration.
  if (matchingSignals.length === 0) {
    for (const sig of allSignals) {
      if (sig.subject?.includes(proposalId) || sig.sourceReportId?.includes(proposalId)) {
        matchingSignals.push(sig);
        fallbackJoinsUsed = true;
      }
    }
  }

  // Classify signals by adapter via sourceReportId prefix (registry-aligned).
  const signalsByAdapter: Record<string, LearningSignal[]> = {};
  for (const sig of matchingSignals) {
    const adapter = adapterForReport(sig.sourceReportId);
    if (!signalsByAdapter[adapter]) signalsByAdapter[adapter] = [];
    signalsByAdapter[adapter].push(sig);
  }
  const adaptersWithSignals = Object.keys(signalsByAdapter).sort();
  const learning: LearningLayer = {
    signalsByAdapter,
    adaptersWithSignals,
    totalSignals: matchingSignals.length,
  };

  // ---- Layer 6: Calibration Profiles (chain → heuristic) ---------------
  // String heuristics LOCKED to Calibration here too.
  const matchingProfiles: CalibrationProfile[] = [];
  // Priority 1+2: chain — profiles reachable when their sourceSignalIds or
  // evidenceRefs intersect chain roots (the signal ids that link back to
  // proposal artifacts).
  const chainSignalRoots = chainRootsForSignals;
  for (const prof of allProfiles) {
    const refs = [...(prof.sourceSignalIds ?? []), ...(prof.evidenceRefs ?? [])];
    if (refs.some((r) => chainSignalRoots.has(r))) {
      matchingProfiles.push(prof);
    }
  }
  // Priority 3: heuristic fallback (subject/evidenceRefs includes proposalId).
  if (matchingProfiles.length === 0) {
    for (const prof of allProfiles) {
      if (prof.subject?.includes(proposalId) || prof.evidenceRefs?.includes(proposalId)) {
        matchingProfiles.push(prof);
        fallbackJoinsUsed = true;
      }
    }
  }
  const profilesByTarget: Record<string, CalibrationProfile[]> = {};
  for (const prof of matchingProfiles) {
    if (!profilesByTarget[prof.target]) profilesByTarget[prof.target] = [];
    profilesByTarget[prof.target].push(prof);
  }
  const calibration: CalibrationLayer = {
    profilesByTarget,
    adjustments: matchingProfiles.map((p) => ({
      target: p.target,
      previousValue: p.previousValue,
      suggestedValue: p.suggestedValue,
      reason: p.reason,
    })),
  };

  // ---- ExplanationIntegrity (refined — now real) -----------------------
  const executionFound = execution.status === "available";
  const outcomeFound = outcome.status === "available";
  const recommendationFound = recommendation.status === "available";
  const riskFound = risk.status === "available";
  const governanceFound = governance.status === "available";
  const learningFound = learning.totalSignals > 0;
  const calibrationFound = matchingProfiles.length > 0;
  const found = [
    outcomeFound,
    recommendationFound,
    riskFound,
    governanceFound,
    executionFound,
    learningFound,
    calibrationFound,
  ];
  const layersAvailable = found.filter(Boolean).length;
  // Distinct orphaned chain-linked artifacts (deduplicated across all three
  // layer loops and direct-id gates). A no-chain direct-id miss never entered
  // the set, so evidenceChainUsed and incompleteChainLayers stay consistent.
  const incompleteChainLayers = orphanedChainTargets.size;

  const explanationIntegrity: ExplanationIntegrity = {
    outcomeFound,
    recommendationFound,
    riskFound,
    governanceFound,
    executionFound,
    learningFound,
    calibrationFound,
    evidenceChainUsed,
    fallbackJoinsUsed,
    incompleteChainLayers,
    totalLayers: 7,
    layersAvailable,
    completenessPercent: Math.round((layersAvailable / 7) * 1000) / 10,
  };

  return {
    proposalId,
    generatedAt,
    windowDays,
    outcome,
    recommendation,
    risk,
    governance,
    execution,
    learning,
    calibration,
    explanationIntegrity,
    learningRefreshHint: learningFound ? null : REFRESH_HINT,
  };
}

// ---------------------------------------------------------------------------
// adapterForReport — classify a signal by its source report id prefix.
// ---------------------------------------------------------------------------

/**
 * Map a LearningSignal.sourceReportId to the AdapterRegistry key it
 * originated from. Registry-aligned: keys mirror the P8.5a.2 AdapterRegistry
 * ("recommendation", "risk", "governance"). Unknown prefixes default to
 * "recommendation" (the oldest adapter surface) so signals are never
 * silently dropped.
 */
function adapterForReport(sourceReportId: string): string {
  if (sourceReportId?.startsWith("risk-calibration-")) return "risk";
  if (sourceReportId?.startsWith("governance-calibration-")) return "governance";
  if (sourceReportId?.startsWith("recommendation-")) return "recommendation";
  return "recommendation";
}
