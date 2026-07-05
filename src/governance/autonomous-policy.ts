/**
 * P12.1 — Autonomous governance policy adapter.
 *
 * A thin governance-specific policy layer for autonomous-run decisions.
 * Maps existing "allow" | "ask" | "deny" to P12's
 * "allow" | "requires_approval" | "deny" and adds governance-specific
 * match dimensions (action types, labels, repos, files, branches).
 *
 * Does NOT replace src/policy/* — that layer handles runtime tool/capability
 * policies. This layer handles autonomous-run governance decisions.
 */

import type { PolicyDecision } from "../policy/policy-rule.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GovernanceDecision = "allow" | "deny" | "requires_approval";

export interface GovernancePolicyResult {
  decision: GovernanceDecision;
  reason: string;
  matchedPolicies: string[];
  requiredApprovals: string[];
}

export interface GovernanceMatch {
  actionTypes?: string[];
  labels?: string[];
  repos?: string[];
  paths?: string[];
  maxFiles?: number;
  branches?: string[];
}

export interface GovernancePolicyRule {
  id: string;
  description: string;
  match: GovernanceMatch;
  decision: PolicyDecision;  // Uses "allow" | "ask" | "deny" from existing types
  approvalRole?: string;
}

export interface GovernanceActionContext {
  actionType: string;
  labels?: string[];
  repo?: string;
  files?: string[];
  branch?: string;
}

// ---------------------------------------------------------------------------
// Default governance policies
// ---------------------------------------------------------------------------

export const DEFAULT_GOVERNANCE_POLICIES: GovernancePolicyRule[] = [
  {
    id: "governance-security-paths-deny",
    description: "Deny autonomous changes to security/auth/infra paths",
    match: { paths: ["src/security/**", "src/auth/**", "deploy/**", "infra/**"] },
    decision: "deny",
  },
  {
    id: "governance-secrets-deny",
    description: "Deny changes to secrets and environment config",
    match: { paths: [".env", ".env.*", "**/secrets/**", "**/credentials/**"] },
    decision: "deny",
  },
  {
    id: "governance-large-change-ask",
    description: "Changes touching more than 10 files require approval",
    match: { maxFiles: 10 },
    decision: "ask",
  },
  {
    id: "governance-source-change-ask",
    description: "Source code changes require approval",
    match: { paths: ["src/**"] },
    decision: "ask",
  },
  {
    id: "governance-default-allow",
    description: "Default allow for changes not matching any other rule",
    match: {},
    decision: "allow",
  },
];

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

/**
 * Check whether a file path matches a glob-like pattern.
 * Safe regex escaping prevents injection from user-supplied patterns.
 */
export function pathMatches(filePath: string, pattern: string): boolean {
  if (pattern === filePath) return true;

  // Escape regex special chars, then restore * and ** as glob operators
  // Replace ** first (with sentinel), then * (single), then restore **
  let regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "ˢᵀᴬᴿ")
    .replace(/\*/g, "[^/]*")
    .replace(/ˢᵀᴬᴿ/g, ".*");

  // Optimize simple literal prefixes: /parent/** → starts with /parent/
  // Only when the prefix contains only safe path characters (no regex operators)
  if (regexStr.endsWith("/.*") && /^[\w\/\-.@]+$/.test(regexStr.slice(0, -3))) {
    return filePath.startsWith(regexStr.slice(0, -3));
  }

  return new RegExp("^" + regexStr + "$").test(filePath);

}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

/**
 * Check whether a GovernanceMatch matches a given action context.
 */
export function governanceMatch(
  rule: GovernancePolicyRule,
  context: GovernanceActionContext,
): boolean {
  const m = rule.match;

  if (m.actionTypes && m.actionTypes.length > 0) {
    if (!m.actionTypes.includes(context.actionType)) return false;
  }
  if (m.labels && m.labels.length > 0) {
    if (!context.labels || !m.labels.some((l) => context.labels!.includes(l))) return false;
  }
  if (m.repos && m.repos.length > 0) {
    if (!context.repo || !m.repos.includes(context.repo)) return false;
  }
  if (m.branches && m.branches.length > 0) {
    if (!context.branch || !m.branches.includes(context.branch)) return false;
  }
  if (m.maxFiles !== undefined) {
    if (!context.files || context.files.length <= m.maxFiles) return false;
  }
  if (m.paths && m.paths.length > 0) {
    if (!context.files || context.files.length === 0) return false;
    const anyFileMatches = context.files.some((f) => m.paths!.some((p) => pathMatches(f, p)));
    if (!anyFileMatches) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a governance action context against governance policy rules.
 *
 * Maps existing PolicyDecision to GovernanceDecision:
 *   "allow" → "allow"
 *   "ask"   → "requires_approval"
 *   "deny"  → "deny"
 *
 * Precedence: deny > ask > allow
 * Fallback: requires_approval (conservative)
 */
export function evaluateGovernancePolicies(
  context: GovernanceActionContext,
  rules: GovernancePolicyRule[] = DEFAULT_GOVERNANCE_POLICIES,
): GovernancePolicyResult {
  const matched: GovernancePolicyRule[] = [];

  for (const rule of rules) {
    if (governanceMatch(rule, context)) {
      matched.push(rule);
    }
  }

  // deny (highest precedence)
  const denyMatch = matched.find((r) => r.decision === "deny");
  if (denyMatch) {
    return {
      decision: "deny",
      reason: denyMatch.description,
      matchedPolicies: [denyMatch.id],
      requiredApprovals: [],
    };
  }

  // ask → requires_approval
  const askMatches = matched.filter((r) => r.decision === "ask");
  if (askMatches.length > 0) {
    return {
      decision: "requires_approval",
      reason: askMatches.map((r) => r.description).join("; "),
      matchedPolicies: askMatches.map((r) => r.id),
      requiredApprovals: askMatches
        .filter((r) => r.approvalRole)
        .map((r) => r.approvalRole!),
    };
  }

  // allow
  const allowMatch = matched.find((r) => r.decision === "allow");
  if (allowMatch) {
    return {
      decision: "allow",
      reason: allowMatch.description,
      matchedPolicies: [allowMatch.id],
      requiredApprovals: [],
    };
  }

  // Conservative default
  return {
    decision: "requires_approval",
    reason: "No matching policy — requires approval by default",
    matchedPolicies: [],
    requiredApprovals: [],
  };
}
