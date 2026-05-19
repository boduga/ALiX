import { describe, it } from "node:test";
import assert from "node:assert";
import { RunLimiter } from "../../src/autonomy/run-limiter.js";
import type { RunLimits, RunCounters } from "../../src/autonomy/run-limiter.js";

describe("RunLimiter", () => {
  const limits: RunLimits = {
    maxSteps: 10,
    maxCost: 100,
    maxFileChanges: 20,
    maxShellCommands: 30,
    maxRetries: 5,
    maxRuntimeSeconds: 3600,
  };

  describe("constructor", () => {
    it("accepts valid limits", () => {
      new RunLimiter(limits);
    });

    it("accepts zero values for unlimited", () => {
      const unlimited = { maxSteps: 0, maxCost: 0, maxFileChanges: 0, maxShellCommands: 0, maxRetries: 0, maxRuntimeSeconds: 0 };
      new RunLimiter(unlimited);
    });
  });

  describe("check", () => {
    it("returns allowed when under all limits", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 5, cost: 50, fileChanges: 10, shellCommands: 15 };
      const result = limiter.check(counters);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.reason, undefined);
      assert.strictEqual(result.limit, undefined);
    });

    it("blocks when steps exceed maxSteps", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 11, cost: 50, fileChanges: 10, shellCommands: 15 };
      const result = limiter.check(counters);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.limit, "maxSteps");
    });

    it("blocks when cost exceeds maxCost", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 5, cost: 101, fileChanges: 10, shellCommands: 15 };
      const result = limiter.check(counters);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.limit, "maxCost");
    });

    it("blocks when fileChanges exceed maxFileChanges", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 5, cost: 50, fileChanges: 21, shellCommands: 15 };
      const result = limiter.check(counters);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.limit, "maxFileChanges");
    });

    it("blocks when shellCommands exceed maxShellCommands", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 5, cost: 50, fileChanges: 10, shellCommands: 31 };
      const result = limiter.check(counters);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.limit, "maxShellCommands");
    });

    it("allows zero values when limits are zero (unlimited)", () => {
      const limiter = new RunLimiter({ maxSteps: 0, maxCost: 0, maxFileChanges: 0, maxShellCommands: 0, maxRetries: 0, maxRuntimeSeconds: 0 });
      const counters: RunCounters = { steps: 999, cost: 999, fileChanges: 999, shellCommands: 999 };
      const result = limiter.check(counters);
      assert.strictEqual(result.allowed, true);
    });

    it("returns the first exceeded limit encountered", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 15, cost: 150, fileChanges: 25, shellCommands: 35 };
      const result = limiter.check(counters);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.limit, "maxSteps");
    });
  });

  describe("getRemaining", () => {
    it("returns correct remaining capacity", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 3, cost: 30, fileChanges: 5, shellCommands: 10 };
      const remaining = limiter.getRemaining(counters);
      assert.strictEqual(remaining.steps, 7);
      assert.strictEqual(remaining.cost, 70);
      assert.strictEqual(remaining.fileChanges, 15);
      assert.strictEqual(remaining.shellCommands, 20);
    });

    it("returns zero for exceeded limits", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 15, cost: 50, fileChanges: 5, shellCommands: 10 };
      const remaining = limiter.getRemaining(counters);
      assert.strictEqual(remaining.steps, 0);
      assert.strictEqual(remaining.cost, 50);
      assert.strictEqual(remaining.fileChanges, 15);
      assert.strictEqual(remaining.shellCommands, 20);
    });

    it("returns full capacity when limits are zero (unlimited)", () => {
      const limiter = new RunLimiter({ maxSteps: 0, maxCost: 0, maxFileChanges: 0, maxShellCommands: 0, maxRetries: 0, maxRuntimeSeconds: 0 });
      const counters: RunCounters = { steps: 100, cost: 100, fileChanges: 100, shellCommands: 100 };
      const remaining = limiter.getRemaining(counters);
      assert.strictEqual(remaining.steps, Infinity);
      assert.strictEqual(remaining.cost, Infinity);
      assert.strictEqual(remaining.fileChanges, Infinity);
      assert.strictEqual(remaining.shellCommands, Infinity);
    });
  });

  describe("getWarnings", () => {
    it("returns no warnings when far from limits", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 1, cost: 10, fileChanges: 2, shellCommands: 3 };
      const warnings = limiter.getWarnings(counters);
      assert.strictEqual(warnings.length, 0);
    });

    it("warns when steps at 80% capacity", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 8, cost: 10, fileChanges: 2, shellCommands: 3 };
      const warnings = limiter.getWarnings(counters);
      assert.ok(warnings.some(w => w.includes("steps")), warnings.join(", "));
    });

    it("warns when cost at 80% capacity", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 1, cost: 85, fileChanges: 2, shellCommands: 3 };
      const warnings = limiter.getWarnings(counters);
      assert.ok(warnings.some(w => w.includes("cost")), warnings.join(", "));
    });

    it("warns when fileChanges at 80% capacity", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 1, cost: 10, fileChanges: 17, shellCommands: 3 };
      const warnings = limiter.getWarnings(counters);
      assert.ok(warnings.some(w => w.includes("fileChanges")), warnings.join(", "));
    });

    it("warns when shellCommands at 80% capacity", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 1, cost: 10, fileChanges: 2, shellCommands: 25 };
      const warnings = limiter.getWarnings(counters);
      assert.ok(warnings.some(w => w.includes("shellCommands")), warnings.join(", "));
    });

    it("returns multiple warnings when multiple limits approached", () => {
      const limiter = new RunLimiter(limits);
      const counters: RunCounters = { steps: 9, cost: 95, fileChanges: 2, shellCommands: 3 };
      const warnings = limiter.getWarnings(counters);
      assert.ok(warnings.length >= 2, `Expected at least 2 warnings, got ${warnings.length}: ${warnings.join(", ")}`);
    });

    it("returns no warnings when limits are zero (unlimited)", () => {
      const limiter = new RunLimiter({ maxSteps: 0, maxCost: 0, maxFileChanges: 0, maxShellCommands: 0, maxRetries: 0, maxRuntimeSeconds: 0 });
      const counters: RunCounters = { steps: 100, cost: 100, fileChanges: 100, shellCommands: 100 };
      const warnings = limiter.getWarnings(counters);
      assert.strictEqual(warnings.length, 0);
    });
  });

  describe("isExpired", () => {
    it("returns false when start time is recent", () => {
      const limiter = new RunLimiter(limits);
      const startTime = new Date(Date.now() - 1000); // 1 second ago
      assert.strictEqual(limiter.isExpired(startTime), false);
    });

    it("returns true when runtime exceeds maxRuntimeSeconds", () => {
      const limiter = new RunLimiter(limits);
      const startTime = new Date(Date.now() - 4000 * 1000); // 4000 seconds ago, exceeds 3600
      assert.strictEqual(limiter.isExpired(startTime), true);
    });

    it("returns false when maxRuntimeSeconds is zero (unlimited)", () => {
      const limiter = new RunLimiter({ maxSteps: 10, maxCost: 100, maxFileChanges: 20, maxShellCommands: 30, maxRetries: 5, maxRuntimeSeconds: 0 });
      const startTime = new Date(Date.now() - 10000 * 1000); // 10000 seconds ago
      assert.strictEqual(limiter.isExpired(startTime), false);
    });

    it("handles fractional seconds correctly", () => {
      const limiter = new RunLimiter({ maxSteps: 10, maxCost: 100, maxFileChanges: 20, maxShellCommands: 30, maxRetries: 5, maxRuntimeSeconds: 1 });
      const startTime = new Date(Date.now() - 1500); // 1.5 seconds ago, exceeds 1 second limit
      assert.strictEqual(limiter.isExpired(startTime), true);
    });
  });
});