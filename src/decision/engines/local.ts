/**
 * engines/local.ts — Deterministic local baseline executor (J0).
 *
 * Fail-closed defaults: claim verification answers "insufficient" (never
 * grants authority); context relevance abstains (consumer keeps existing
 * behavior); model-tier is unsupported here (default route is
 * existing-routing, wired in J3). No confidence emitted — local rules carry
 * no calibration (JEV-9).
 */

import type { DecisionType } from "../contracts.js";
import type { DecisionEngine } from "../registry.js";
import type {
  DecisionExecutor,
  ExecuteInput,
  ExecutorOutcome,
} from "../executors.js";
import { classifyClaimLocally } from "../decisions/claim-verification/local-baseline.js";
import { readClaimProjection } from "../decisions/claim-verification/projection.js";
import { scoreRelevanceLocally } from "../decisions/context-relevance/local-baseline.js";
import { readRelevanceProjection } from "../decisions/context-relevance/projection.js";

export const LOCAL_ENGINE_ID = "local";

function claimChoice(input: ExecuteInput, started: number): ExecutorOutcome {
  const { verdict } = classifyClaimLocally(readClaimProjection(input.sealed.payload));
  if (input.candidates !== undefined && !input.candidates.includes(verdict)) {
    return { kind: "failure", error: "candidate set incompatible with local baseline" };
  }
  return {
    kind: "choice",
    choice: verdict,
    provenance: {
      engineId: LOCAL_ENGINE_ID,
      latencyMs: Date.now() - started,
      remote: false,
      projectionHash: input.sealed.hash,
    },
  };
}

function relevanceNoul(input: ExecuteInput, started: number): ExecutorOutcome {
  const { probability } = scoreRelevanceLocally(readRelevanceProjection(input.sealed.payload));
  return {
    kind: "noul",
    probability,
    provenance: {
      engineId: LOCAL_ENGINE_ID,
      latencyMs: Date.now() - started,
      remote: false,
      projectionHash: input.sealed.hash,
    },
  };
}

function unsupported(_input: ExecuteInput, _started: number): ExecutorOutcome {
  return { kind: "failure", error: "unsupported decision for local engine" };
}

/** Exhaustive dispatch: adding a DecisionType without a baseline fails compile. */
const BASELINE: Record<DecisionType, (input: ExecuteInput, started: number) => ExecutorOutcome> = {
  "claim-verification": claimChoice,
  "context-relevance": relevanceNoul,
  "model-tier": unsupported,
};

export function createLocalBaselineExecutor(): DecisionExecutor {
  return {
    engineId: LOCAL_ENGINE_ID,
    async execute(input: ExecuteInput): Promise<ExecutorOutcome> {
      return BASELINE[input.decision](input, Date.now());
    },
  };
}

export function localEngineMeta(executor?: DecisionExecutor): DecisionEngine {
  return {
    id: LOCAL_ENGINE_ID,
    remote: false,
    capabilities: ["choice", "noul"],
    ...(executor !== undefined ? { executor } : {}),
  };
}
