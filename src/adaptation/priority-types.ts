/**
 * P5.4 — Priority types: report schema for proposal prioritization.
 *
 * These types describe the output of the ProposalScorer pipeline.
 * A ProposalPriorityReport ranks pending proposals by expected value.
 *
 * @module
 */

import type { AdaptationProposal } from "./adaptation-types.js";

// ---------------------------------------------------------------------------
// Priority scoring version
// ---------------------------------------------------------------------------

/** Current scoring formula version. Increment when weights change. */
export const SCORING_VERSION = "v1";

// ---------------------------------------------------------------------------
// Scored proposal
// ---------------------------------------------------------------------------

/** Component breakdown of a priority score — for explainability. */
export interface ScoredProposalComponents {
  /** proposal.sourceConfidence (raw 0-1). */
  confidenceWeight: number;
  /** Matching bucket's keepRate (0 if insufficient data). */
  historicalSuccessWeight: number;
  /** Matching bucket's approvalRate (0 if insufficient data). */
  approvalWeight: number;
  /** 1 - blendedRevertRate (0.5 if insufficient data). */
  revertPenalty: number;
  /** Age multiplier: 1.00 <7d, 1.05 7-30d, 1.10 30-90d, 1.15 >90d. */
  ageMultiplier: number;
}

/** A single proposal with its computed priority score and rationale. */
export interface ScoredProposal {
  proposalId: string;
  /** Overall priority score 0-1. */
  priorityScore: number;
  /**
   * Confidence in the score:
   *   HIGH  — multiple buckets with sufficient data
   *   MEDIUM — at least one bucket with sufficient data
   *   LOW   — no buckets with sufficient data or no IntelligenceReport
   */
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Component breakdown for explainability. */
  components: ScoredProposalComponents;
  /** Human-readable explanation of the score. */
  rationale: string;
  /** The proposal itself. */
  proposal: AdaptationProposal;
}

// ---------------------------------------------------------------------------
// Priority report
// ---------------------------------------------------------------------------

/**
 * Full priority report — the output of `alix adaptation prioritize`.
 *
 * Contains a ranked list of pending proposals with scores, confidence tiers,
 * and an executive summary.  Persisted to `.alix/adaptation/priorities/`.
 */
export interface ProposalPriorityReport {
  /** ISO 8601 when this report was generated. */
  generatedAt: string;
  /** Scoring formula version (e.g. "v1"). Increment when weights change. */
  scoringVersion: string;
  /** ISO 8601 of the IntelligenceReport used (null if none). */
  intelligenceReportDate: string | null;
  /** Total pending proposals considered. */
  totalPending: number;
  /** Proposals that received a score (all pending proposals are scored). */
  totalScored: number;
  /** Proposals with confidence: LOW (insufficient historical data). */
  totalLowConfidence: number;
  /** Score distribution across decile ranges. */
  scoreDistribution: Array<{ decile: string; count: number }>;
  /** Natural-language executive summary (3-5 sentences, template-driven). */
  executiveSummary: string;
  /** Ranked proposals, highest score first. */
  ranked: ScoredProposal[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PrioritizeOptions {
  /** Only show the top N proposals. */
  top?: number;
  /** Only show proposals with score >= this value. */
  minScore?: number;
}
