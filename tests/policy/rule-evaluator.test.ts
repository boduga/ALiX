/**
 * rule-evaluator.test.ts — Tests for RuleEvaluator and default policies.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RuleEvaluator } from "../../src/policy/rule-evaluator.js";
import { defaultPolicyRules } from "../../src/policy/default-policies.js";
import { validatePolicyRule } from "../../src/policy/policy-rule.js";

describe("RuleEvaluator", () => {
  it("evaluates first matching rule", () => {
    const engine = new RuleEvaluator([
      { id: "first", description: "First", match: { capability: "a" }, decision: "allow", enabled: true },
      { id: "second", description: "Second", match: { capability: "b" }, decision: "deny", enabled: true },
    ]);
    const result = engine.evaluate({ capability: "b" });
    assert.equal(result.decision, "deny");
    assert.equal(result.matchedRuleId, "second");
  });

  it('falls back to "deny" when no rule matches', () => {
    const engine = new RuleEvaluator([]);
    const result = engine.evaluate({ capability: "unknown" });
    assert.equal(result.decision, "deny");
    assert.equal(result.reason, "No matching policy rule; denied by default");
  });

  it("skips disabled rules", () => {
    const engine = new RuleEvaluator([
      { id: "disabled", description: "Disabled", match: { capability: "x" }, decision: "allow", enabled: false },
      { id: "fallback", description: "Fallback", match: {}, decision: "deny", enabled: true },
    ]);
    const result = engine.evaluate({ capability: "x" });
    assert.equal(result.matchedRuleId, "fallback");
  });

  it("supports batch evaluation", () => {
    const engine = new RuleEvaluator([
      { id: "allow-a", description: "Allow a", match: { capability: "a" }, decision: "allow", enabled: true },
      { id: "deny-b", description: "Deny b", match: { capability: "b" }, decision: "deny", enabled: true },
    ]);
    const results = engine.evaluateBatch([
      { capability: "a" },
      { capability: "b" },
      { capability: "c" },
    ]);
    assert.equal(results.length, 3);
    assert.equal(results[0].decision, "allow");
    assert.equal(results[1].decision, "deny");
    assert.equal(results[2].decision, "deny");
  });

  it("addRule appends to the rule list", () => {
    const engine = new RuleEvaluator();
    engine.addRule({
      id: "added", description: "Added later", match: {}, decision: "allow", enabled: true,
    });
    assert.equal(engine.getAllRules().length, 1);
  });

  it("setRules replaces all rules", () => {
    const engine = new RuleEvaluator([
      { id: "old", description: "Old", match: {}, decision: "deny", enabled: true },
    ]);
    engine.setRules([
      { id: "new", description: "New", match: {}, decision: "allow", enabled: true },
    ]);
    assert.equal(engine.getAllRules().length, 1);
    assert.equal(engine.getAllRules()[0].id, "new");
  });

  it("getEnabledRules excludes disabled", () => {
    const engine = new RuleEvaluator([
      { id: "a", description: "A", match: {}, decision: "allow", enabled: true },
      { id: "b", description: "B", match: {}, decision: "deny", enabled: false },
    ]);
    assert.equal(engine.getEnabledRules().length, 1);
  });
});

describe("Default policies", () => {
  it("returns expected number of default rules", () => {
    const rules = defaultPolicyRules();
    assert.ok(rules.length >= 8);
  });

  it("all rules pass validation", () => {
    const rules = defaultPolicyRules();
    for (const rule of rules) {
      const result = validatePolicyRule(rule);
      if (!result.valid) {
        assert.fail(`Rule ${rule.id} failed validation: ${result.errors.join("; ")}`);
      }
    }
  });

  it("evaluates web.search as allow", () => {
    const evaluator = new RuleEvaluator(defaultPolicyRules());
    const result = evaluator.evaluate({ capability: "web.search", riskLevel: "low" });
    assert.equal(result.decision, "allow");
  });

  it("evaluates shell.exec as ask", () => {
    const evaluator = new RuleEvaluator(defaultPolicyRules());
    const result = evaluator.evaluate({ capability: "shell.exec", riskLevel: "high" });
    assert.equal(result.decision, "ask");
  });

  it("evaluates unknown capability as deny", () => {
    const evaluator = new RuleEvaluator(defaultPolicyRules());
    const result = evaluator.evaluate({ capability: "nonexistent.magic", riskLevel: "critical" });
    assert.equal(result.decision, "deny");
  });

  it("evaluates low-risk unknown as allow (via risk-level fallback)", () => {
    const evaluator = new RuleEvaluator(defaultPolicyRules());
    const result = evaluator.evaluate({ riskLevel: "low" });
    assert.equal(result.decision, "allow");
  });
});
