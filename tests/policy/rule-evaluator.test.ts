/**
 * rule-evaluator.test.ts — Tests for RuleEvaluator and default policies.
 */

import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { RuleEvaluator } from "../../src/governance/policy/rule-evaluator.js";
import { defaultPolicyRules } from "../../src/governance/policy/default-policies.js";
import { validatePolicyRule } from "../../src/governance/policy/policy-rule.js";

describe("RuleEvaluator", () => {
  it("matches a single applicable rule", () => {
    // Disjoint rules: only one can match, so first-match and deny-wins agree
    // here. This is why the case could not detect the precedence bug (Gate E
    // review, vacuous assertion #7) — overlapping rules are tested under D11.
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

// ── D11: deny-wins precedence, independent of declaration order ──────
//
// Independent Gate E review defect D11. The evaluator was first-match-wins, so a
// deny held only when no permissive rule appeared before it. File order granted
// authority. These tests fail under first-match-wins; several fail specifically
// when the permissive rule is declared FIRST.

function rule(id: string, match: any, decision: "allow" | "ask" | "deny"): any {
  return { id, description: id, match, decision, enabled: true };
}

test("D11: a deny wins over an allow declared BEFORE it", () => {
  const evaluator = new RuleEvaluator([
    rule("allow-read", { capability: "filesystem.read" }, "allow"),
    rule("deny-critical", { riskLevel: "critical" }, "deny"),
  ]);
  const result = evaluator.evaluate({ capability: "filesystem.read", riskLevel: "critical" });
  assert.equal(result.decision, "deny");
  assert.equal(result.matchedRuleId, "deny-critical");
});

test("D11: the same rules in the OPPOSITE order reach the same decision", () => {
  // Order independence is the actual property. Asserting one order alone would
  // not distinguish deny-wins from first-match-wins.
  const rules = [
    rule("allow-read", { capability: "filesystem.read" }, "allow"),
    rule("deny-critical", { riskLevel: "critical" }, "deny"),
  ];
  const forward = new RuleEvaluator(rules).evaluate({ capability: "filesystem.read", riskLevel: "critical" });
  const reversed = new RuleEvaluator([...rules].reverse()).evaluate({ capability: "filesystem.read", riskLevel: "critical" });
  assert.equal(forward.decision, "deny");
  assert.equal(reversed.decision, "deny");
});

test("D11: ask outranks allow, so an allow before an ask cannot silence it", () => {
  const evaluator = new RuleEvaluator([
    rule("allow-risk", { riskLevel: "low" }, "allow"),
    rule("ask-capability", { capability: "filesystem.write" }, "ask"),
  ]);
  const result = evaluator.evaluate({ capability: "filesystem.write", riskLevel: "low" });
  assert.equal(result.decision, "ask");
  assert.equal(result.matchedRuleId, "ask-capability");
});

test("D11: strictest of three wins regardless of order", () => {
  const rules = [
    rule("a-allow", { capability: "x" }, "allow"),
    rule("b-ask", { capability: "x" }, "ask"),
    rule("c-deny", { capability: "x" }, "deny"),
  ];
  for (const ordering of [rules, [...rules].reverse(), [rules[1], rules[2], rules[0]]]) {
    assert.equal(new RuleEvaluator(ordering).evaluate({ capability: "x" }).decision, "deny");
  }
});

test("D11: among equal decisions the earliest rule is reported, stably", () => {
  // The DECISION never depends on order. The audit line does not drift either.
  const evaluator = new RuleEvaluator([
    rule("first-deny", { capability: "y" }, "deny"),
    rule("second-deny", { riskLevel: "critical" }, "deny"),
  ]);
  const result = evaluator.evaluate({ capability: "y", riskLevel: "critical" });
  assert.equal(result.decision, "deny");
  assert.equal(result.matchedRuleId, "first-deny");
});

test("D11: the SHIPPED defaults cannot allow a critical-risk file read", () => {
  // The hole existed without anyone editing a rule file: `allow-file-read`
  // (capability match) is declared before `deny-critical-risk` (risk-level
  // match) in default-policies.ts.
  const evaluator = new RuleEvaluator(defaultPolicyRules());
  const result = evaluator.evaluate({ capability: "filesystem.read", riskLevel: "critical" });
  assert.equal(result.decision, "deny", "critical risk must outrank a capability allow");
});

test("D11: disabled rules still cannot decide anything", () => {
  const evaluator = new RuleEvaluator([
    { ...rule("deny-x", { capability: "x" }, "deny"), enabled: false },
    rule("allow-x", { capability: "x" }, "allow"),
  ]);
  assert.equal(evaluator.evaluate({ capability: "x" }).decision, "allow");
});

test("D11: no match still fails closed to deny", () => {
  const evaluator = new RuleEvaluator([rule("allow-y", { capability: "y" }, "allow")]);
  const result = evaluator.evaluate({ capability: "unlisted" });
  assert.equal(result.decision, "deny");
  assert.equal(result.matchedRuleId, undefined);
});
