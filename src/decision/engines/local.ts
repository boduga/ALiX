/**
 * engines/local.ts — Deterministic local baseline executor (J0-J2).
 *
 * Fail-closed defaults: claim verification answers from deterministic rules
 * (never grants authority); context relevance scores P(relevant) per item;
 * model-tier is unsupported here (default route is existing-routing, wired in
 * J3). No confidence emitted — local rules carry no calibration (JEV-9).
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
import { chooseTierLocally } from "../decisions/model-tier/local-baseline.js";
import { readModelTierProjection } from "../decisions/model-tier/projection.js";
import { filterTierCandidates } from "../decisions/model-tier/tiers.js";
import { classifyRiskLocally } from "../decisions/risk-escalation/local-baseline.js";
import { readRiskProjection } from "../decisions/risk-escalation/projection.js";

export const LOCAL_ENGINE_ID = "local";

function claimChoice(
  input: ExecuteInput,
  started: number,
  claimThreshold?: number,
): ExecutorOutcome {
  const { verdict } = classifyClaimLocally(
    readClaimProjection(input.sealed.payload),
    claimThreshold !== undefined ? { supportOverlapThreshold: claimThreshold } : undefined,
  );
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

function modelTierChoice(input: ExecuteInput, started: number): ExecutorOutcome {
  const enabledTiers = filterTierCandidates(input.candidates);
  if (enabledTiers.length === 0) {
    return { kind: "failure", error: "model-tier requires an enabled candidate set" };
  }
  const { tier, reason } = chooseTierLocally(readModelTierProjection(input.sealed.payload), enabledTiers);
  if (tier === undefined) {
    return { kind: "failure", error: `no enabled tier satisfies the request: ${reason}` };
  }
  return {
    kind: "choice",
    choice: tier,
    provenance: {
      engineId: LOCAL_ENGINE_ID,
      latencyMs: Date.now() - started,
      remote: false,
      projectionHash: input.sealed.hash,
    },
  };
}

function riskChoice(input: ExecuteInput, started: number): ExecutorOutcome {
  const { tier } = classifyRiskLocally(readRiskProjection(input.sealed.payload));
  if (input.candidates !== undefined && !input.candidates.includes(tier)) {
    return { kind: "failure", error: "candidate set incompatible with local baseline" };
  }
  return {
    kind: "choice",
    choice: tier,
    provenance: {
      engineId: LOCAL_ENGINE_ID,
      latencyMs: Date.now() - started,
      remote: false,
      projectionHash: input.sealed.hash,
    },
  };
}

export type LocalBaselineExecutorOptions = {
  /** Claim support-overlap threshold (the active local profile); absent = default. */
  claimThreshold?: number;
};

export function createLocalBaselineExecutor(opts?: LocalBaselineExecutorOptions): DecisionExecutor {
  const claimThreshold = opts?.claimThreshold;
  // Exhaustive dispatch: adding a DecisionType without a baseline fails compile.
  const baseline: Record<DecisionType, (input: ExecuteInput, started: number) => ExecutorOutcome> = {
    "claim-verification": (input, started) => claimChoice(input, started, claimThreshold),
    "context-relevance": relevanceNoul,
    "model-tier": modelTierChoice,
    "risk-escalation": riskChoice,
  };
  return {
    engineId: LOCAL_ENGINE_ID,
    async execute(input: ExecuteInput): Promise<ExecutorOutcome> {
      return baseline[input.decision](input, Date.now());
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
