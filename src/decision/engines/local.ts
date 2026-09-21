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

export const LOCAL_ENGINE_ID = "local";

function claimChoice(input: ExecuteInput, started: number): ExecutorOutcome {
  if (input.candidates !== undefined && !input.candidates.includes("insufficient")) {
    return { kind: "failure", error: "candidate set incompatible with local baseline" };
  }
  return {
    kind: "choice",
    choice: "insufficient",
    provenance: {
      engineId: LOCAL_ENGINE_ID,
      latencyMs: Date.now() - started,
      remote: false,
      projectionHash: input.sealed.hash,
    },
  };
}

function abstain(_input: ExecuteInput, _started: number): ExecutorOutcome {
  return { kind: "failure", error: "local-abstain: keep existing behavior" };
}

function unsupported(_input: ExecuteInput, _started: number): ExecutorOutcome {
  return { kind: "failure", error: "unsupported decision for local engine" };
}

/** Exhaustive dispatch: adding a DecisionType without a baseline fails compile. */
const BASELINE: Record<DecisionType, (input: ExecuteInput, started: number) => ExecutorOutcome> = {
  "claim-verification": claimChoice,
  "context-relevance": abstain,
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
    capabilities: ["choice"],
    ...(executor !== undefined ? { executor } : {}),
  };
}
