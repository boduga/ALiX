/**
 * config.ts — Decision configuration skeleton (J0a).
 *
 * Standalone on purpose: no edits to AlixConfig/loader/validator in J0a, so
 * zero blast radius on existing config readers. Wiring into the canonical
 * config happens in a later J0 slice. Names here are conceptual; alignment
 * with repo conventions occurs at wiring time (hand-off §4).
 */

import type { DecisionType } from "./contracts.js";

export type DecisionRoutePolicy = {
  engine: string;
  fallback: string;
  thresholdProfile: string;
  /**
   * Feature flag for routes wired into runtime behavior. Absent/false means
   * the consumer keeps its existing behavior (J2 exit criterion).
   */
  enabled?: boolean;
};

export type DecisionConfig = {
  defaultEngine: "local";
  remote: {
    jev: {
      enabled: boolean;
    };
  };
  claimVerification: DecisionRoutePolicy;
  contextRelevance: DecisionRoutePolicy;
  modelTier: DecisionRoutePolicy;
  riskEscalation: DecisionRoutePolicy;
};

/** Local-first defaults. Jev disabled. Every route resolves without remote. */
export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  defaultEngine: "local",
  remote: { jev: { enabled: false } },
  claimVerification: {
    engine: "local",
    fallback: "local",
    thresholdProfile: "claim-verification/local/v1",
  },
  contextRelevance: {
    engine: "local",
    fallback: "local",
    thresholdProfile: "context-relevance/local/v1",
    enabled: false,
  },
  modelTier: {
    engine: "existing-routing",
    fallback: "existing-routing",
    thresholdProfile: "model-tier/existing-routing/v1",
    enabled: false,
  },
  riskEscalation: {
    engine: "local",
    fallback: "local",
    thresholdProfile: "risk-escalation/local/v1",
    enabled: false,
  },
};

/** Example Jev-enabled overlay. Concept only, never default. */
export const JEV_ENABLED_OVERLAY: Pick<DecisionConfig, "remote"> = {
  remote: { jev: { enabled: true } },
};

/** Route table: adding a DecisionType without a route fails compile. */
const DECISION_ROUTE_KEYS = {
  "claim-verification": "claimVerification",
  "context-relevance": "contextRelevance",
  "model-tier": "modelTier",
  "risk-escalation": "riskEscalation",
} as const;

export function routePolicyFor(
  config: DecisionConfig,
  decision: DecisionType,
): DecisionRoutePolicy {
  return config[DECISION_ROUTE_KEYS[decision]];
}

/**
 * Remote allow-check. Local routes always allowed. Jev only when explicitly
 * enabled. Unknown engines fail closed (JEV-7, remote opt-in rule).
 */
export function isRemoteEngineAllowed(
  engineId: string,
  config: DecisionConfig,
): boolean {
  if (engineId === "local" || engineId === "existing-routing") return true;
  if (engineId === "jev") return config.remote.jev.enabled === true;
  return false;
}

export type DecisionConfigIssue = {
  path: string;
  message: string;
};

/** Pure shape validator. No I/O, no loader coupling. */
export function validateDecisionConfig(
  config: unknown,
): { valid: boolean; issues: DecisionConfigIssue[] } {
  const issues: DecisionConfigIssue[] = [];
  if (!config || typeof config !== "object") {
    return { valid: false, issues: [{ path: "", message: "Decision config must be an object" }] };
  }
  const c = config as Record<string, unknown>;
  if (c.defaultEngine !== "local") {
    issues.push({ path: "defaultEngine", message: 'defaultEngine must be "local"' });
  }
  const remote = c.remote as Record<string, unknown> | undefined;
  const jev = remote?.jev as Record<string, unknown> | undefined;
  if (typeof jev?.enabled !== "boolean") {
    issues.push({ path: "remote.jev.enabled", message: "remote.jev.enabled must be a boolean" });
  }
  for (const key of ["claimVerification", "contextRelevance", "modelTier", "riskEscalation"] as const) {
    const route = c[key] as Record<string, unknown> | undefined;
    if (!route || typeof route !== "object") {
      issues.push({ path: key, message: `${key} must be an object` });
      continue;
    }
    for (const field of ["engine", "fallback", "thresholdProfile"] as const) {
      if (typeof route[field] !== "string" || (route[field] as string).length === 0) {
        issues.push({ path: `${key}.${field}`, message: `${key}.${field} must be a non-empty string` });
      }
    }
    if (route.enabled !== undefined && typeof route.enabled !== "boolean") {
      issues.push({ path: `${key}.enabled`, message: `${key}.enabled must be a boolean` });
    }
  }
  return { valid: issues.length === 0, issues };
}
