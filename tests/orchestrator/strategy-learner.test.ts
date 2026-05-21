import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailureType, recommendStrategy, getRecommendationConfidence } from "../../src/orchestrator/strategy-learner.js";

test("StrategyLearner - classifyFailureType", async (t) => {
  await t.test("classifies syntax errors", () => {
    assert.strictEqual(classifyFailureType("SyntaxError: unexpected token"), "syntax");
    assert.strictEqual(classifyFailureType("parse error"), "syntax");
    assert.strictEqual(classifyFailureType("Syntax error at line 5"), "syntax");
  });

  await t.test("classifies test failures", () => {
    assert.strictEqual(classifyFailureType("Test failed: expected 2 to equal 3"), "test");
    assert.strictEqual(classifyFailureType("Test passed, assert passed"), "test");
    assert.strictEqual(classifyFailureType("assertion error"), "test");
  });

  await t.test("classifies scope denials", () => {
    assert.strictEqual(classifyFailureType("Scope denied for /etc/passwd"), "scope");
    assert.strictEqual(classifyFailureType("Permission denied"), "scope");
  });

  await t.test("classifies logic errors", () => {
    assert.strictEqual(classifyFailureType("Logic error: wrong condition"), "logic");
  });

  await t.test("defaults to unknown", () => {
    assert.strictEqual(classifyFailureType("Something went wrong"), "unknown");
  });
});

test("StrategyLearner - recommendStrategy", async (t) => {
  await t.test("recommends simplify for syntax errors", async () => {
    const strategy = await recommendStrategy("SyntaxError: unexpected token", "feature");
    assert.strictEqual(strategy, "simplify");
  });

  await t.test("recommends verify_only for test failures", async () => {
    const strategy = await recommendStrategy("Test failed: expected 2", "feature");
    assert.strictEqual(strategy, "verify_only");
  });

  await t.test("recommends analyze for scope denials", async () => {
    const strategy = await recommendStrategy("Scope denied for /etc/passwd", "feature");
    assert.strictEqual(strategy, "analyze");
  });

  await t.test("recommends decompose for bugfix logic errors", async () => {
    const strategy = await recommendStrategy("Logic error: wrong condition", "bugfix");
    assert.strictEqual(strategy, "decompose");
  });

  await t.test("falls back to retry for unknown errors", async () => {
    const strategy = await recommendStrategy("Something went wrong", "feature");
    assert.strictEqual(strategy, "retry");
  });
});

test("StrategyLearner - getRecommendationConfidence", async (t) => {
  await t.test("returns low confidence when no history", async () => {
    const result = await getRecommendationConfidence("Some error");
    assert.strictEqual(result.confidence, "low");
    assert.strictEqual(result.samples, 0);
  });
});