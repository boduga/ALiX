/**
 * policy-loader.test.ts — Tests for loading policy rules from disk and defaults.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPolicyRules, loadRuleEvaluator } from "../../src/policy/policy-loader.js";
import { defaultPolicyRules } from "../../src/policy/default-policies.js";

describe("PolicyLoader", () => {
  it("loads default rules when no policy dir exists", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "policy-loader-test-"));
    try {
      const rules = await loadPolicyRules(tmp);
      assert.equal(rules.length, defaultPolicyRules().length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads default rules when policy dir is empty", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "policy-loader-empty-"));
    try {
      mkdirSync(join(tmp, ".alix", "policies"), { recursive: true });
      const rules = await loadPolicyRules(tmp);
      assert.equal(rules.length, defaultPolicyRules().length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads single rule from a .json file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "policy-loader-single-"));
    try {
      const policiesDir = join(tmp, ".alix", "policies");
      mkdirSync(policiesDir, { recursive: true });
      writeFileSync(join(policiesDir, "custom.json"), JSON.stringify({
        id: "custom.rule",
        description: "Custom rule",
        match: { capability: "custom.op" },
        decision: "allow",
        enabled: true,
      }));

      const rules = await loadPolicyRules(tmp);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].id, "custom.rule");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads array of rules from a .json file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "policy-loader-array-"));
    try {
      const policiesDir = join(tmp, ".alix", "policies");
      mkdirSync(policiesDir, { recursive: true });
      writeFileSync(join(policiesDir, "rules.json"), JSON.stringify([
        { id: "rule.a", description: "Rule A", match: { capability: "a" }, decision: "allow", enabled: true },
        { id: "rule.b", description: "Rule B", match: { capability: "b" }, decision: "deny", enabled: true },
      ]));

      const rules = await loadPolicyRules(tmp);
      assert.equal(rules.length, 2);
      assert.equal(rules[0].id, "rule.a");
      assert.equal(rules[1].id, "rule.b");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects duplicate rule IDs, keeping first", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "policy-loader-dup-"));
    try {
      const policiesDir = join(tmp, ".alix", "policies");
      mkdirSync(policiesDir, { recursive: true });
      writeFileSync(join(policiesDir, "dup.json"), JSON.stringify([
        { id: "dup.rule", description: "First", match: { capability: "a" }, decision: "allow", enabled: true },
        { id: "dup.rule", description: "Second", match: { capability: "b" }, decision: "deny", enabled: true },
      ]));

      const rules = await loadPolicyRules(tmp);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].description, "First");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips invalid JSON files without crashing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "policy-loader-bad-json-"));
    try {
      const policiesDir = join(tmp, ".alix", "policies");
      mkdirSync(policiesDir, { recursive: true });
      writeFileSync(join(policiesDir, "bad.json"), "not valid json");

      const rules = await loadPolicyRules(tmp);
      // Falls back to defaults when no valid rules loaded
      assert.equal(rules.length, defaultPolicyRules().length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips invalid rules but keeps valid ones", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "policy-loader-bad-rule-"));
    try {
      const policiesDir = join(tmp, ".alix", "policies");
      mkdirSync(policiesDir, { recursive: true });
      writeFileSync(join(policiesDir, "mix.json"), JSON.stringify([
        { id: "good.rule", description: "Good", match: { capability: "a" }, decision: "allow", enabled: true },
        { id: "bad.rule", description: "", match: { capability: "b" }, decision: "deny", enabled: true },
      ]));

      const rules = await loadPolicyRules(tmp);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].id, "good.rule");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loadRuleEvaluator wraps rules in RuleEvaluator", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "policy-loader-eval-"));
    try {
      const policiesDir = join(tmp, ".alix", "policies");
      mkdirSync(policiesDir, { recursive: true });
      writeFileSync(join(policiesDir, "eval.json"), JSON.stringify({
        id: "eval.rule",
        description: "Eval",
        match: { capability: "eval.op" },
        decision: "allow",
        enabled: true,
      }));

      const evaluator = await loadRuleEvaluator(tmp);
      const result = evaluator.evaluate({ capability: "eval.op" });
      assert.equal(result.decision, "allow");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
