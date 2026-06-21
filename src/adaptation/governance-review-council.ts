/**
 * P6.5 — GovernanceReviewCouncil: deterministic aggregation logic.
 *
 * Takes four independent LensScores and produces a single GovernanceReview
 * artifact. All logic is deterministic — no LLM calls, no side effects.
 * Same inputs always produce same output.
 *
 * @module
 */

import type {
  GovernanceReview,
  GovernanceVerdict,
  LensScore,
  CouncilVote,
  GovernanceReviewInput,
} from "./governance-review-types.js";
import type { SourceArtifact } from "./decision-types.js";
import { GOVERNANCE_VERDICT_SEVERITY } from "./governance-review-types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CouncilOptions {
  /** Override generatedAt for deterministic testing. */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Council
// ---------------------------------------------------------------------------

export class GovernanceReviewCouncil {
  /**
   * Aggregate four independent lens scores into a single GovernanceReview
   * artifact.
   *
   * 1. Count votes into CouncilVote tally.
   * 2. Determine plurality verdict (tie = most severe wins).
   * 3. Compute confidence using definitive-lens agreement formula.
   * 4. Deduplicate concerns and blind spots.
   * 5. Build reasons with verdict and vote counts.
   *
   * @param reviewId - Stable review identifier
   * @param proposalId - Proposal being reviewed
   * @param recommendationId - Source recommendation
   * @param lensScores - Four lens scores (expected length = 4)
   * @param input - Original input context (for source artifacts)
   * @param options - Optional generatedAt override
   * @returns GovernanceReview artifact
   */
  aggregate(
    reviewId: string,
    proposalId: string,
    recommendationId: string,
    lensScores: LensScore[],
    input: GovernanceReviewInput,
    options?: CouncilOptions,
  ): GovernanceReview {
    const generatedAt = options?.generatedAt ?? new Date(Date.now()).toISOString();

    // Step 1: Count votes
    const councilVote = this.#countVotes(lensScores);

    // Step 2: Determine verdict (plurality, tie = most severe)
    const verdict = this.#determineVerdict(councilVote);

    // Step 3: Compute confidence
    const confidence = this.#computeConfidence(lensScores, verdict);

    // Step 4: Merge concerns, blind spots, analogies
    const concerns = this.#mergeConcerns(lensScores);
    const blindSpots = this.#mergeBlindSpots(lensScores);
    const historicalAnalogies = this.#mergeAnalogies(lensScores);

    // Step 5: Build source artifacts
    const sourceArtifacts: SourceArtifact[] = [
      {
        type: "recommendation",
        id: recommendationId,
        timestamp: input.recommendation.generatedAt,
      },
      {
        type: "context",
        id: input.decisionContext.id,
        timestamp: input.decisionContext.generatedAt,
      },
      ...(input.riskScore
        ? [
            {
              type: "risk" as const,
              id: input.riskScore.id,
              timestamp: input.riskScore.generatedAt,
            },
          ]
        : []),
      { type: "review" as const, id: reviewId, timestamp: generatedAt },
    ];

    return {
      id: reviewId,
      subject: `Governance Review: ${proposalId}`,
      outcome: "reviewed",
      confidence,
      reasons: this.#buildReasons(verdict, councilVote, confidence, lensScores),
      generatedAt,
      recommendationId,
      proposalId,
      verdict,
      concerns,
      blindSpots,
      historicalAnalogies,
      lensScores,
      councilVote,
      sourceArtifacts,
    };
  }

  /**
   * Tally each lens's recommendedVerdict into a CouncilVote.
   */
  #countVotes(scores: LensScore[]): CouncilVote {
    const vote: CouncilVote = {
      agree: 0,
      agreeWithConcerns: 0,
      challenge: 0,
      insufficientInformation: 0,
    };
    for (const s of scores) {
      switch (s.recommendedVerdict) {
        case "agree":
          vote.agree++;
          break;
        case "agree_with_concerns":
          vote.agreeWithConcerns++;
          break;
        case "challenge":
          vote.challenge++;
          break;
        case "insufficient_information":
          vote.insufficientInformation++;
          break;
      }
    }
    return vote;
  }

  /**
   * Determine aggregate verdict.
   * Plurality rule — most votes wins.
   * On tie: most severe among tied verdicts wins (severity order:
   * insufficient_information > challenge > agree_with_concerns > agree).
   *
   * NOTE: cautious tie-breaking with insufficient_information:
   * 2 lenses vote "agree", 2 vote "insufficient_information",
   * verdict is "insufficient_information" (severity wins).
   * This is intentional: missing data should increase caution.
   * The confidence formula handles the mixed-signal case separately
   * (see #computeConfidence).
   */
  #determineVerdict(vote: CouncilVote): GovernanceVerdict {
    const entries = Object.entries(vote) as [keyof CouncilVote, number][];
    const maxVotes = Math.max(...entries.map(([, v]) => v));
    const tied = entries.filter(([, v]) => v === maxVotes).map(([k]) => k);

    if (tied.length === 1) {
      return this.#councilKeyToVerdict(tied[0]);
    }

    // Tie: most severe among tied
    tied.sort((a, b) => {
      const aV =
        GOVERNANCE_VERDICT_SEVERITY[this.#councilKeyToVerdict(a)];
      const bV =
        GOVERNANCE_VERDICT_SEVERITY[this.#councilKeyToVerdict(b)];
      return bV - aV;
    });
    return this.#councilKeyToVerdict(tied[0]);
  }

  /**
   * Compute review confidence.
   * If verdict is insufficient_information, confidence = count(insufficient) / total.
   * Otherwise: definitiveRatio * agreementFactor * avgLensConfidence.
   */
  #computeConfidence(
    scores: LensScore[],
    verdict: GovernanceVerdict,
  ): number {
    if (verdict === "insufficient_information") {
      const insufficientCount = scores.filter(
        (s) => s.recommendedVerdict === "insufficient_information",
      ).length;
      return insufficientCount / scores.length;
    }

    const definitive = scores.filter(
      (s) => s.recommendedVerdict !== "insufficient_information",
    );
    if (definitive.length === 0) return 0;

    const definitiveRatio = definitive.length / scores.length;
    const agreementCount = definitive.filter(
      (s) => s.recommendedVerdict === verdict,
    ).length;
    const agreementFactor = agreementCount / definitive.length;
    const avgLensConfidence =
      definitive.reduce((sum, s) => sum + s.confidence, 0) /
      definitive.length;

    return definitiveRatio * agreementFactor * avgLensConfidence;
  }

  /**
   * Merge and deduplicate concerns from all lens rationales.
   * Deduplication is case-insensitive exact-text match.
   */
  #mergeConcerns(scores: LensScore[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of scores) {
      const lines = s.rationale
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const key = line.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(line);
        }
      }
    }
    return result;
  }

  /**
   * Extract blind spots from lens rationales.
   * Placeholder — enhanced extraction from real lens output.
   */
  #mergeBlindSpots(_scores: LensScore[]): string[] {
    // TODO — P6.5b: enhanced blind-spot extraction from real lens output
    return [];
  }

  /**
   * Extract historical analogies from lens rationales.
   * Placeholder — enhanced passage from historian lens output.
   */
  #mergeAnalogies(_scores: LensScore[]): string[] {
    // TODO — P6.5b: enhanced passage from historian lens output
    return [];
  }

  /**
   * Build explanatory reasons for the review.
   */
  #buildReasons(
    verdict: GovernanceVerdict,
    vote: CouncilVote,
    confidence: number,
    _scores: LensScore[],
  ): string[] {
    return [
      `Council verdict: ${verdict} (${vote.agree}/${vote.agreeWithConcerns}/${vote.challenge}/${vote.insufficientInformation})`,
      `Confidence: ${(confidence * 100).toFixed(0)}%`,
    ];
  }

  /**
   * Map a CouncilVote key to a GovernanceVerdict.
   */
  #councilKeyToVerdict(key: keyof CouncilVote): GovernanceVerdict {
    switch (key) {
      case "agree":
        return "agree";
      case "agreeWithConcerns":
        return "agree_with_concerns";
      case "challenge":
        return "challenge";
      case "insufficientInformation":
        return "insufficient_information";
    }
  }
}
