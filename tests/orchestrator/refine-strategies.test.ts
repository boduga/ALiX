import test from "node:test";
import assert from "node:assert/strict";
import { selectStrategy, buildRefinePrompt, applyStrategy, getStrategy } from "../../src/orchestrator/refine-strategies.js";

test("RefineStrategies - selectStrategy", async (t) => {
  await t.test("selects simplify for syntax errors", () => {
    const strategy = selectStrategy("SyntaxError: unexpected token", "feature");
    assert.strictEqual(strategy, "simplify");
  });

  await t.test("selects verify_only for test failures", () => {
    const strategy = selectStrategy("Test failed: expected 2 to equal 3", "feature");
    assert.strictEqual(strategy, "verify_only");
  });

  await t.test("selects decompose for bugfix logic errors", () => {
    const strategy = selectStrategy("Logic error: wrong condition", "bugfix");
    assert.strictEqual(strategy, "decompose");
  });

  await t.test("defaults to retry for unknown failures", () => {
    const strategy = selectStrategy("Something went wrong", "feature");
    assert.strictEqual(strategy, "retry");
  });
});

test("RefineStrategies - buildRefinePrompt", async (t) => {
  await t.test("returns a prompt with failure context", async () => {
    const result = await buildRefinePrompt(
      "Test failed: expected true to be false",
      "bugfix"
    );
    assert.ok(result.prompt.includes("Test failed"), "Prompt should contain failure text");
    assert.ok(result.strategy, "Strategy should be defined");
  });

  await t.test("uses escalate after multiple repairs", async () => {
    const result = await buildRefinePrompt(
      "Test failed: expected 2",
      "feature",
      3 // repairCount >= 3 triggers escalate
    );
    assert.strictEqual(result.strategy, "escalate");
  });
});

test("RefineStrategies - applyStrategy", async (t) => {
  await t.test("substitutes failure placeholder", () => {
    const result = applyStrategy(
      {
        name: "retry",
        description: "Test",
        trigger: "any",
        template: "Fix: {{failure}}",
        temperature: 0.3,
      },
      "Syntax error",
      "context"
    );
    assert.ok(result.includes("Syntax error"));
    assert.ok(!result.includes("{{failure}}"));
  });

  await t.test("substitutes context placeholder", () => {
    const result = applyStrategy(
      {
        name: "retry",
        description: "Test",
        trigger: "any",
        template: "Context: {{context}}",
        temperature: 0.3,
      },
      "error",
      "current state"
    );
    assert.ok(result.includes("current state"));
  });
});

test("RefineStrategies - getStrategy", async (t) => {
  await t.test("returns default retry when file not found", async () => {
    const strategy = await getStrategy("nonexistent");
    assert.strictEqual(strategy.name, "retry");
  });

  await t.test("loads analyze strategy", async () => {
    const strategy = await getStrategy("analyze");
    assert.strictEqual(strategy.name, "analyze");
    assert.strictEqual(strategy.trigger, "scope_denied");
  });
});