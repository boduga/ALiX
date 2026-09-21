/**
 * corpus.ts — Model-tier fixture corpus (J3).
 *
 * Features → expected tier. `expected` is the label for shadow comparison and
 * J4 tuning; `unsatisfiable: true` marks requests the decision must abstain on
 * rather than guess (e.g. an image task with no image tier configured).
 */

import type { ModelTierRequestFeatures } from "./projection.js";
import type { ModelTier } from "../../../config/schema.js";

export type ModelTierFixture = ModelTierRequestFeatures & {
  id: string;
  expected: ModelTier | null;
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
    id: "image-generation",
    taskKind: "image",
    promptChars: 300,
    needsTools: false,
    needsVision: false,
    longContext: false,
    expected: "image",
    note: "routes to models.image (e.g. a nano-banana-class model)",
  },
  {
    id: "vision-input-analysis",
    taskKind: "analysis",
    promptChars: 8_000,
    needsTools: false,
    needsVision: true,
    longContext: false,
    expected: "thinking",
    note: "image input is a hard constraint the caller pre-filters, not a tier",
  },
];
