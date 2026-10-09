/**
 * projection.ts — ModelTierProjection (J3).
 *
 * Request/task FEATURES only. Provider names, model IDs, prompt text, source
 * files and tool output never enter this shape (JEV-10, JEV-4, JEV-5): the
 * candidate set is the only place a compute class is named, and it is named
 * by ALiX, not by the model.
 */

import { projectForRemote, type Projector } from "../../projector.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type { DecisionType } from "../../contracts.js";

export const MODEL_TIER_DECISION: DecisionType = "model-tier";
export const MODEL_TIER_PROJECTOR_VERSION = "model-tier/v1";

/**
 * Task kinds.
 *
 * `image` means the deliverable IS an image — a pure image-generation prompt
 * ("create a Christmas card", "edit this photo"). When an image is only PART
 * of a larger deliverable (a report with images, a UI mockup in a coding
 * session), keep the composite kind (`synthesis` / `code` / `analysis`) so the
 * task stays on the multimodal reasoning tier and the image work happens as a
 * nested sub-task. The `image` tier is chosen only when the prompt itself asks
 * for image generation; an explicit instruction in the prompt wins.
 */
export const MODEL_TIER_TASK_KINDS = [
  "code",
  "analysis",
  "synthesis",
  "quick",
  "critique",
  "image",
  "other",
] as const;

export type ModelTierTaskKind = (typeof MODEL_TIER_TASK_KINDS)[number];

export function isModelTierTaskKind(value: unknown): value is ModelTierTaskKind {
  return (MODEL_TIER_TASK_KINDS as readonly unknown[]).includes(value);
}

/** Prompt length is a feature, never the prompt itself. */
export const MAX_PROMPT_CHARS = 2_000_000;

/**
 * `needsVision` is an image-INPUT hint. It is NOT a gate: the caller excludes
 * tiers that cannot satisfy hard requirements before invoking the decision.
 */
export type ModelTierRequestFeatures = {
  taskKind: ModelTierTaskKind;
  promptChars: number;
  needsTools: boolean;
  needsVision: boolean;
  longContext: boolean;
};

/** The projection IS the normalized feature set — one shape, so they cannot drift. */
export type ModelTierProjection = ModelTierRequestFeatures;

export function createModelTierProjector(): Projector<
  ModelTierRequestFeatures,
  ModelTierProjection
> {
  return {
    decision: MODEL_TIER_DECISION,
    version: MODEL_TIER_PROJECTOR_VERSION,
    project(input: ModelTierRequestFeatures): ModelTierProjection {
      const taskKind = isModelTierTaskKind(input?.taskKind) ? input.taskKind : "other";
      const rawChars = typeof input?.promptChars === "number" ? input.promptChars : 0;
      const promptChars = Number.isFinite(rawChars)
        ? Math.max(0, Math.min(Math.floor(rawChars), MAX_PROMPT_CHARS))
        : 0;
      return {
        taskKind,
        promptChars,
        needsTools: input?.needsTools === true,
        needsVision: input?.needsVision === true,
        longContext: input?.longContext === true,
      };
    },
  };
}

export function projectModelTier(
  input: ModelTierRequestFeatures,
  opts?: { now?: number },
): RemoteSealedProjection<ModelTierProjection> {
  return projectForRemote(createModelTierProjector(), input, opts);
}

/** Lenient read of a sealed payload for local engines. */
export function readModelTierProjection(payload: unknown): ModelTierProjection {
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    taskKind: isModelTierTaskKind(record.taskKind) ? record.taskKind : "other",
    promptChars: typeof record.promptChars === "number" ? record.promptChars : 0,
    needsTools: record.needsTools === true,
    needsVision: record.needsVision === true,
    longContext: record.longContext === true,
  };
}
