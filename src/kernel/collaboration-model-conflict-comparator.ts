/**
 * collaboration-model-conflict-comparator.ts — Optional bounded model-assisted conflict comparison.
 *
 * The model receives already-grouped pairs and evidence summaries only.
 * It cannot resolve conflicts, reintroduce stale findings, expand candidate sets,
 * mutate the store, or invoke tools.
 *
 * Identity fallback is the default — embedding/model implementations are opt-in.
 */

import type { ConflictType } from "./collaboration-conflict-types.js";

export type ModelConflictComparisonInput = {
  pairId: string;
  leftFinding: { title: string; content: string; claim?: any; confidence?: number };
  rightFinding: { title: string; content: string; claim?: any; confidence?: number };
  evidenceSummary: { leftScore: number; rightScore: number; margin: number; };
};

export type ModelConflictComparisonResult = {
  compatibility: "compatible" | "incompatible" | "uncertain";
  conflictType?: ConflictType;
  confidence: number;
  reasons: string[];
};

export interface ModelConflictComparator {
  compare(
    input: ModelConflictComparisonInput,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<ModelConflictComparisonResult>;
}

/**
 * Identity fallback — always returns uncertain.
 * Guaranteed deterministic. Used when no model comparator is configured.
 */
export class IdentityConflictComparator implements ModelConflictComparator {
  async compare(
    input: ModelConflictComparisonInput,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<ModelConflictComparisonResult> {
    return {
      compatibility: "uncertain",
      confidence: 0,
      reasons: ["model assistance not configured"],
    };
  }
}
