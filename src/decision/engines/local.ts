/**
 * engines/local.ts — Deterministic local baseline executor (J0).
 *
 * Fail-closed defaults: claim verification answers "insufficient" (never
 * grants authority); context relevance abstains (consumer keeps existing
 * behavior); model-tier is unsupported here (default route is
 * existing-routing, wired in J3). No confidence emitted — local rules carry
 * no calibration (JEV-9).
 */

import type { DecisionEngine } from "../registry.js";
import type {
  DecisionExecutor,
  ExecuteInput,
  ExecutorOutcome,
} from "../executors.js";

export const LOCAL_ENGINE_ID = "local";

export class LocalBaselineExecutor implements DecisionExecutor {
  readonly engineId = LOCAL_ENGINE_ID;

  async execute(input: ExecuteInput): Promise<ExecutorOutcome> {
    const started = Date.now();
    const provenance = {
      engineId: LOCAL_ENGINE_ID,
      latencyMs: 0,
      remote: false,
      projectionHash: input.sealed.hash,
    };
    switch (input.decision) {
      case "claim-verification": {
        if (input.candidates !== undefined && !input.candidates.includes("insufficient")) {
          return { kind: "failure", error: "candidate set incompatible with local baseline" };
        }
        return {
          kind: "choice",
          choice: "insufficient",
          provenance: { ...provenance, latencyMs: Date.now() - started },
        };
      }
      case "context-relevance":
        return { kind: "failure", error: "local-abstain: keep existing behavior" };
      case "model-tier":
        return { kind: "failure", error: "unsupported decision for local engine" };
    }
  }
}

export function localEngineMeta(executor?: DecisionExecutor): DecisionEngine {
  return {
    id: LOCAL_ENGINE_ID,
    remote: false,
    capabilities: ["choice"],
    ...(executor !== undefined ? { executor } : {}),
  };
}
