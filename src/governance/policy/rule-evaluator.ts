/**
 * rule-evaluator.ts — Policy rule evaluator with deny-wins precedence.
 *
 * Separate from the PolicyGate (which is wired to config, capability registry,
 * shell whitelist, etc). This is a pure, testable rule matching engine.
 *
 * PRECEDENCE: deny > ask > allow, over ALL matching rules.
 *
 * This was `first-match-wins`, which made a deny advisory: it held only when no
 * permissive rule appeared before it in file order. The shipped defaults
 * demonstrate the hole without anyone editing anything — `allow-file-read`
 * (match: capability) is declared before `deny-critical-risk` (match: risk
 * level), so a critical-risk file read matched the allow first and was
 * permitted. Independent Gate E review defect D11.
 *
 * Two properties the ordering no longer has:
 *   - file order cannot grant authority; only an absence of stricter matches can
 *   - adding a deny rule anywhere in the file takes effect immediately
 *
 * The reported rule is the strictest match, so audit records name the rule that
 * actually decided. When several rules share the strictest decision, the
 * earliest one is reported: nothing about the DECISION then depends on order,
 * but the audit line stays stable across runs.
 */

import type { PolicyRule, PolicyEvaluationInput, PolicyEvaluation, PolicyDecision } from "./policy-rule.js";
import { matchPolicy } from "./policy-rule.js";

/**
 * Strictness ranking. Higher wins.
 *
 * Declared here rather than inline so the precedence order is stated once and a
 * future decision value cannot be silently ranked as permissive by an
 * exhaustive `if` chain.
 */
const DECISION_RANK: Record<PolicyDecision, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

export class RuleEvaluator {
  private rules: PolicyRule[];

  constructor(rules: PolicyRule[] = []) {
    this.rules = rules;
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  setRules(rules: PolicyRule[]): void {
    this.rules = [...rules];
  }

  getEnabledRules(): PolicyRule[] {
    return this.rules.filter(r => r.enabled);
  }

  getAllRules(): PolicyRule[] {
    return [...this.rules];
  }

  /**
   * Evaluate an input against enabled rules. The STRICTEST matching decision
   * wins (deny > ask > allow), regardless of order. Falls back to "deny" when
   * no rule matches.
   */
  evaluate(input: PolicyEvaluationInput): PolicyEvaluation {
    let winner: PolicyRule | undefined;

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (!matchPolicy(rule.match, input)) continue;
      // Strictly greater, so the earliest rule wins among equals and the audit
      // line does not drift between runs.
      if (!winner || DECISION_RANK[rule.decision] > DECISION_RANK[winner.decision]) {
        winner = rule;
      }
    }

    if (!winner) {
      return { decision: "deny", reason: "No matching policy rule; denied by default" };
    }

    return {
      decision: winner.decision,
      matchedRuleId: winner.id,
      matchedRuleDescription: winner.description,
      reason: winner.reason,
    };
  }

  /** Evaluate multiple inputs at once. */
  evaluateBatch(inputs: PolicyEvaluationInput[]): PolicyEvaluation[] {
    return inputs.map(i => this.evaluate(i));
  }
}
