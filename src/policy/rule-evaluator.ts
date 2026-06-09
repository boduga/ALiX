/**
 * rule-evaluator.ts — Simple first-match-wins policy rule evaluator.
 *
 * Separate from the runtime PolicyEngine (which is wired to config,
 * capability registry, shell whitelist, etc). This is a pure, testable
 * rule matching engine that evaluates PolicyRules in order.
 */

import type { PolicyRule, PolicyEvaluationInput, PolicyEvaluation } from "./policy-rule.js";
import { matchPolicy } from "./policy-rule.js";

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
   * Evaluate an input against enabled rules (first match wins).
   * Falls back to "deny" when no rule matches.
   */
  evaluate(input: PolicyEvaluationInput): PolicyEvaluation {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (matchPolicy(rule.match, input)) {
        return {
          decision: rule.decision,
          matchedRuleId: rule.id,
          matchedRuleDescription: rule.description,
          reason: rule.reason,
        };
      }
    }
    return { decision: "deny", reason: "No matching policy rule; denied by default" };
  }

  /** Evaluate multiple inputs at once. */
  evaluateBatch(inputs: PolicyEvaluationInput[]): PolicyEvaluation[] {
    return inputs.map(i => this.evaluate(i));
  }
}
