/**
 * policy-rule.test.ts — Tests for PolicyRule validation and matching.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validatePolicyRule,
  matchPolicy,
  type PolicyRule,
  type PolicyEvaluationInput,
} from "../../src/policy/policy-rule.js";

describe("PolicyRule validation", () => {
  it("accepts a valid rule", () => {
    const rule: PolicyRule = {
      id: "test.allow",
      description: "Allow test",
      match: { capability: "test.op" },
      decision: "allow",
      enabled: true,
    };
    const result = validatePolicyRule(rule);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects rule without id", () => {
    const rule = {
      id: "",
      description: "No id",
      match: { capability: "test" },
      decision: "allow" as const,
      enabled: true,
    };
    const result = validatePolicyRule(rule);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("id")));
  });

  it("rejects rule without description", () => {
    const rule: PolicyRule = {
      id: "no.desc",
      description: "",
      match: { capability: "test" },
      decision: "allow",
      enabled: true,
    };
    const result = validatePolicyRule(rule);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("description")));
  });

  it("rejects invalid decision", () => {
    const rule = {
      id: "bad.decision",
      description: "Bad decision",
      match: { capability: "test" },
      decision: "maybe",
      enabled: true,
    };
    const result = validatePolicyRule(rule as any);
    assert.equal(result.valid, false);
  });

  it("rejects rule with no match conditions", () => {
    const rule: PolicyRule = {
      id: "empty.match",
      description: "Empty match",
      match: {},
      decision: "allow",
      enabled: true,
    };
    const result = validatePolicyRule(rule);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("match must have")));
  });
});

describe("matchPolicy", () => {
  const baseRule: PolicyRule = {
    id: "test",
    description: "Test",
    match: { capability: "test.op", riskLevel: "low", toolId: "test_tool" },
    decision: "allow",
    enabled: true,
  };

  it("matches when all conditions match", () => {
    const input: PolicyEvaluationInput = {
      capability: "test.op",
      riskLevel: "low",
      toolId: "test_tool",
    };
    assert.equal(matchPolicy(baseRule.match, input), true);
  });

  it("rejects on capability mismatch", () => {
    assert.equal(matchPolicy(baseRule.match, { capability: "other" }), false);
  });

  it("rejects on toolId mismatch", () => {
    assert.equal(matchPolicy(baseRule.match, { toolId: "other" }), false);
  });

  it("rejects on riskLevel mismatch", () => {
    assert.equal(matchPolicy(baseRule.match, { riskLevel: "high" }), false);
  });

  it("matches with partial input (missing optional fields)", () => {
    const rule: PolicyRule = {
      id: "partial",
      description: "Partial",
      match: { capability: "test.op" },
      decision: "allow",
      enabled: true,
    };
    assert.equal(matchPolicy(rule.match, { capability: "test.op" }), true);
    assert.equal(matchPolicy(rule.match, { capability: "other" }), false);
  });

  it("matches pathPattern via regex", () => {
    const rule: PolicyRule = {
      id: "path-rule",
      description: "Path pattern",
      match: { pathPattern: "\\.ts$" },
      decision: "allow",
      enabled: true,
    };
    assert.equal(matchPolicy(rule.match, { path: "/src/file.ts" }), true);
    assert.equal(matchPolicy(rule.match, { path: "file.js" }), false);
  });

  it("returns false for invalid regex pattern", () => {
    const rule: PolicyRule = {
      id: "bad-regex",
      description: "Bad regex",
      match: { pathPattern: "[" },
      decision: "allow",
      enabled: true,
    };
    assert.equal(matchPolicy(rule.match, { path: "test" }), false);
  });
});
