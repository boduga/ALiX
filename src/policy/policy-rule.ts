/**
 * policy-rule.ts — PolicyRule type, matching, and validation.
 *
 * A PolicyRule declares what ALiX should do when a tool or capability
 * is requested: allow automatically, ask for approval, or deny.
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PolicyDecision = "allow" | "ask" | "deny";

export interface PolicyMatch {
  capability?: string;
  toolId?: string;
  riskLevel?: RiskLevel;
  executionProfile?: string;
  pathPattern?: string;
}

export interface PolicyRule {
  id: string;
  description: string;
  match: PolicyMatch;
  decision: PolicyDecision;
  reason?: string;
  enabled: boolean;
}

export interface PolicyEvaluationInput {
  capability?: string;
  toolId?: string;
  riskLevel?: RiskLevel;
  executionProfile?: string;
  path?: string;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  matchedRuleId?: string;
  matchedRuleDescription?: string;
  reason?: string;
}

export interface PolicyRuleValidation {
  valid: boolean;
  errors: string[];
}

/** Validate a PolicyRule has all required fields and valid values. */
export function validatePolicyRule(rule: PolicyRule): PolicyRuleValidation {
  const errors: string[] = [];
  if (!rule.id || typeof rule.id !== "string") errors.push("id is required");
  if (!rule.description) errors.push("description is required");
  if (!["allow", "ask", "deny"].includes(rule.decision)) errors.push("decision must be allow, ask, or deny");
  if (rule.enabled === undefined) errors.push("enabled is required");

  const match = rule.match;
  if (match.riskLevel && !["low", "medium", "high", "critical"].includes(match.riskLevel)) {
    errors.push("match.riskLevel must be low, medium, high, or critical");
  }
  if (!match.capability && !match.toolId && !match.riskLevel && !match.executionProfile && !match.pathPattern) {
    errors.push("match must have at least one condition");
  }

  return { valid: errors.length === 0, errors };
}

/** Check whether a PolicyMatch applies to a given evaluation input. */
export function matchPolicy(
  match: PolicyMatch,
  input: PolicyEvaluationInput,
): boolean {
  if (match.capability && match.capability !== input.capability) return false;
  if (match.toolId && match.toolId !== input.toolId) return false;
  if (match.riskLevel && match.riskLevel !== input.riskLevel) return false;
  if (match.executionProfile && match.executionProfile !== input.executionProfile) return false;
  if (match.pathPattern && input.path) {
    try {
      if (!new RegExp(match.pathPattern).test(input.path)) return false;
    } catch {
      return false; // invalid regex means no match
    }
  }
  return true;
}
