/**
 * projection.ts — ContextRelevanceProjection (J2).
 *
 * One compact objective + ONE context item per call. A whole memory/session
 * dump is never a projection: the caller iterates items and calls the decision
 * per item (J2 exit criterion; hand-off §5.2). The item's correlation id stays
 * out of the remote payload — only the text crosses.
 */

import { projectForRemote, type Projector } from "../../projector.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type { DecisionType } from "../../contracts.js";

export const CONTEXT_RELEVANCE_DECISION: DecisionType = "context-relevance";
export const CONTEXT_RELEVANCE_PROJECTOR_VERSION = "context-relevance/v1";

/** Bounded so one call stays minimum-necessary (JEV-6). */
export const MAX_OBJECTIVE_CHARS = 1_500;
export const MAX_ITEM_CHARS = 2_000;

export type ContextRelevanceItemInput = {
  /** Local correlation handle. Never included in the projection. */
  id: string;
  text: string;
};

export type ContextRelevanceInput = {
  objective: string;
  item: ContextRelevanceItemInput;
};

/** Minimal typed projection: compact objective + one item's text. */
export type ContextRelevanceProjection = {
  objective: string;
  item: string;
};

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function createContextRelevanceProjector(): Projector<
  ContextRelevanceInput,
  ContextRelevanceProjection
> {
  return {
    decision: CONTEXT_RELEVANCE_DECISION,
    version: CONTEXT_RELEVANCE_PROJECTOR_VERSION,
    project(input: ContextRelevanceInput): ContextRelevanceProjection {
      const objective = clip(
        typeof input?.objective === "string" ? input.objective : "",
        MAX_OBJECTIVE_CHARS,
      );
      if (objective.length === 0) {
        throw new Error("context-relevance projection requires a non-empty objective");
      }
      const item = clip(
        typeof input?.item?.text === "string" ? input.item.text : "",
        MAX_ITEM_CHARS,
      );
      if (item.length === 0) {
        throw new Error("context-relevance projection requires a non-empty item");
      }
      return { objective, item };
    },
  };
}

export function projectContextRelevance(
  input: ContextRelevanceInput,
  opts?: { now?: number },
): RemoteSealedProjection<ContextRelevanceProjection> {
  return projectForRemote(createContextRelevanceProjector(), input, opts);
}

/** Lenient read of a sealed payload for local engines. */
export function readRelevanceProjection(payload: unknown): ContextRelevanceProjection {
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    objective: typeof record.objective === "string" ? record.objective : "",
    item: typeof record.item === "string" ? record.item : "",
  };
}
