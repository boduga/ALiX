/**
 * collaboration-semantic-reranker.ts — Optional semantic reranking with deterministic fallback.
 *
 * The interface supports async embedding-based reranking. The identity fallback
 * returns candidates as-is. The embedding implementation blends scores:
 *   finalScore = deterministicScore * 0.8 + semanticScore * 0.2
 *
 * Excluded items (invalidated, superseded, out-of-run) are never reintroduced.
 * Mandatory dependency results are not reranked. All operations are bounded
 * and support cancellation.
 */

import type { SharedFinding } from "./collaboration-types.js";
import type { RelevanceScore } from "./collaboration-relevance-types.js";

export type ScoredFindingCandidate = {
  finding: SharedFinding;
  score: RelevanceScore;
};

export type SemanticRerankResult = {
  candidates: ScoredFindingCandidate[];
  semanticScores: Record<string, number>;
  provider?: string;
  model?: string;
};

export type SemanticQuery = {
  goal: string;
};

/**
 * Semantic reranker interface.
 * Default implementation is the identity function (deterministic fallback).
 */
export interface SemanticReranker {
  rerank(
    query: SemanticQuery,
    candidates: ScoredFindingCandidate[],
    options?: { limit?: number; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<SemanticRerankResult>;
}

/**
 * Identity reranker — returns candidates as-is.
 * Guaranteed deterministic. Used when no embedding provider is available.
 */
export class IdentityReranker implements SemanticReranker {
  async rerank(
    query: SemanticQuery,
    candidates: ScoredFindingCandidate[],
    options?: { limit?: number; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<SemanticRerankResult> {
    const limit = options?.limit ?? candidates.length;
    return {
      candidates: candidates.slice(0, limit),
      semanticScores: {},
    };
  }
}

/**
 * Default deterministic weights for semantic score blending.
 */
export const DEFAULT_RERANK_WEIGHTS = {
  deterministic: 0.8,
  semantic: 0.2,
};
