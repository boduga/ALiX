/**
 * default-policies.ts — Built-in default policy rules.
 *
 * These match the risk-level conventions used elsewhere:
 *   low-risk read tools      → allow
 *   medium write tools       → ask
 *   high/critical tools      → ask
 *   unknown capabilities     → deny (fallthrough in RuleEvaluator)
 */

import type { PolicyRule } from "./policy-rule.js";

export function defaultPolicyRules(): PolicyRule[] {
  return [
    // Low-risk read tools
    {
      id: "allow-file-read",
      description: "Allow low-risk file reads",
      match: { capability: "filesystem.read" },
      decision: "allow",
      enabled: true,
    },
    {
      id: "allow-web-search",
      description: "Allow web search and fetch (read-only)",
      match: { capability: "web.search" },
      decision: "allow",
      enabled: true,
    },
    {
      id: "allow-web-fetch",
      description: "Allow web fetch (read-only)",
      match: { capability: "web.fetch" },
      decision: "allow",
      enabled: true,
    },
    {
      id: "allow-shell-read",
      description: "Allow read-only shell commands",
      match: { executionProfile: "research", riskLevel: "low" },
      decision: "allow",
      enabled: true,
    },

    // Medium-risk write tools
    {
      id: "ask-file-write",
      description: "Ask before writing files",
      match: { capability: "filesystem.write" },
      decision: "ask",
      reason: "File writes modify project state",
      enabled: true,
    },

    // High/critical tools
    {
      id: "ask-shell-exec",
      description: "Ask before executing shell commands",
      match: { capability: "shell.exec" },
      decision: "ask",
      reason: "Shell execution can modify system state",
      enabled: true,
    },
    {
      id: "ask-file-delete",
      description: "Ask before deleting files",
      match: { capability: "filesystem.delete" },
      decision: "ask",
      reason: "File deletion is destructive",
      enabled: true,
    },

    // By risk level
    {
      id: "allow-low-risk",
      description: "Auto-allow any low-risk operation not caught above",
      match: { riskLevel: "low" },
      decision: "allow",
      enabled: true,
    },
    {
      id: "ask-medium-risk",
      description: "Ask before medium-risk operations",
      match: { riskLevel: "medium" },
      decision: "ask",
      reason: "Medium-risk operation requires approval",
      enabled: true,
    },
    {
      id: "ask-high-risk",
      description: "Ask before high-risk operations",
      match: { riskLevel: "high" },
      decision: "ask",
      reason: "High-risk operation requires explicit approval",
      enabled: true,
    },
    {
      id: "deny-critical-risk",
      description: "Deny critical-risk operations by default",
      match: { riskLevel: "critical" },
      decision: "deny",
      reason: "Critical-risk operation denied by policy",
      enabled: true,
    },
  ];
}
