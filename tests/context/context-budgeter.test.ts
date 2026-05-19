import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextBudgeter, TokenEstimate, BudgetInput, BudgetResult } from "../../src/context/context-budgeter.js";

describe("ContextBudgeter", () => {
  describe("constructor", () => {
    it("should accept maxTokens option", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 1000 });
      assert.ok(budgeter);
    });

    it("should accept reservedTokens option", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 1000, reservedTokens: 200 });
      assert.ok(budgeter);
    });
  });

  describe("calculate", () => {
    it("should calculate total tokens from primaryFiles", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({
        primaryFiles: 5000
      });
      assert.strictEqual(result.totalTokens, 5000);
      assert.strictEqual(result.maxTokens, 10000);
      assert.strictEqual(result.exceeded, false);
    });

    it("should calculate total tokens from supportingFiles", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({
        supportingFiles: 3000
      });
      assert.strictEqual(result.totalTokens, 3000);
    });

    it("should calculate total tokens from tests", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({
        tests: 2000
      });
      assert.strictEqual(result.totalTokens, 2000);
    });

    it("should calculate total tokens from history", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({
        history: 1000
      });
      assert.strictEqual(result.totalTokens, 1000);
    });

    it("should sum all token sources", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({
        primaryFiles: 3000,
        supportingFiles: 2000,
        tests: 1000,
        history: 500
      });
      assert.strictEqual(result.totalTokens, 6500);
    });

    it("should handle pinned files", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({
        pinned: [
          { path: "src/main.ts", tokens: 1000, pinned: true },
          { path: "src/utils.ts", tokens: 500, pinned: true }
        ]
      });
      assert.strictEqual(result.pinnedTokens, 1500);
    });

    it("should detect budget exceeded", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 5000 });
      const result = budgeter.calculate({
        primaryFiles: 3000,
        supportingFiles: 3000
      });
      assert.strictEqual(result.exceeded, true);
      assert.strictEqual(result.overflow, 1000);
    });

    it("should calculate remaining tokens", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({
        primaryFiles: 6000
      });
      assert.strictEqual(result.remainingTokens, 4000);
    });

    it("should subtract reserved tokens from maxTokens", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000, reservedTokens: 2000 });
      const result = budgeter.calculate({});
      assert.strictEqual(result.maxTokens, 8000);
      assert.strictEqual(result.remainingTokens, 8000);
    });

    it("should handle empty input", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({});
      assert.strictEqual(result.totalTokens, 0);
      assert.strictEqual(result.remainingTokens, 10000);
      assert.strictEqual(result.exceeded, false);
    });
  });

  describe("formatSummary", () => {
    it("should format budget result for display", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 10000 });
      const result = budgeter.calculate({
        primaryFiles: 5000,
        supportingFiles: 2000,
        tests: 1000,
        history: 500
      });
      const summary = budgeter.formatSummary(result);
      assert.ok(typeof summary === "string");
      assert.ok(summary.includes("10000") || summary.includes("8500"));
    });

    it("should indicate when budget exceeded", () => {
      const budgeter = new ContextBudgeter({ maxTokens: 5000 });
      const result = budgeter.calculate({
        primaryFiles: 4000,
        supportingFiles: 2000
      });
      const summary = budgeter.formatSummary(result);
      assert.ok(summary.includes("EXCEEDED") || summary.includes("exceeded") || summary.includes("overflow"));
    });
  });
});