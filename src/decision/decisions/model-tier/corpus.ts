/**
 * corpus.ts — Model-tier fixture corpus (J3).
 *
 * Features → expected tier. `expected` is the label for shadow comparison and
 * J4 tuning; `unsatisfiable: true` marks requests the decision must abstain on
 * rather than guess.
 */

import type { ModelTierRequestFeatures } from "./projection.js";
import type { RoutableTier } from "./tiers.js";

export type ModelTierFixture = ModelTierRequestFeatures & {
  id: string;
  expected: RoutableTier | null;
  unsatisfiable?: boolean;
  note?: string;
};

export const MODEL_TIER_CORPUS: readonly ModelTierFixture[] = [
  {
    id: "code-edit",
    taskKind: "code",
    promptChars: 4_000,
    needsTools: true,
    needsVision: false,
    longContext: false,
    expected: "coding",
  },
  {
    id: "deep-analysis",
    taskKind: "analysis",
    promptChars: 40_000,
    needsTools: false,
    needsVision: false,
    longContext: true,
    expected: "thinking",
  },
  {
    id: "quick-classify",
    taskKind: "quick",
    promptChars: 400,
    needsTools: false,
    needsVision: false,
    longContext: false,
    expected: "fast",
  },
  {
    id: "review-diff",
    taskKind: "critique",
    promptChars: 12_000,
    needsTools: true,
    needsVision: false,
    longContext: false,
    expected: "critic",
  },
  {
    id: "vision-request",
    taskKind: "other",
    promptChars: 1_000,
    needsTools: false,
    needsVision: true,
    longContext: false,
    expected: null,
    unsatisfiable: true,
    note: "vision is a modality choice, not a compute class",
  },
];
