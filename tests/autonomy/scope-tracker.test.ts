import { describe, it, expect, beforeEach } from "vitest";
import { ScopeTracker, TaskScope, Expansion, ChangeEvaluation } from "../../src/autonomy/scope-tracker.js";

describe("ScopeTracker", () => {
  let tracker: ScopeTracker;

  beforeEach(() => {
    tracker = new ScopeTracker();
  });

  describe("setInitialScope / getCurrentScope", () => {
    it("should store and retrieve the initial scope", () => {
      const scope: TaskScope = {
        goal: "Implement login",
        files: ["src/auth/login.ts", "src/auth/session.ts"],
      };
      tracker.setInitialScope(scope);
      expect(tracker.getCurrentScope()).toEqual(scope);
    });

    it("should return undefined scope before initialization", () => {
      expect(tracker.getCurrentScope()).toBeUndefined();
    });

    it("should track approvedAt after confirmation", () => {
      const scope: TaskScope = {
        goal: "Implement login",
        files: ["src/auth/login.ts"],
      };
      tracker.setInitialScope(scope);
      tracker.confirmExpansion();
      const current = tracker.getCurrentScope();
      expect(current?.approvedAt).toBeDefined();
    });
  });

  describe("checkExpansion", () => {
    it("should not detect expansion when files are within scope", () => {
      const scope: TaskScope = {
        goal: "Refactor utils",
        files: ["src/utils/math.ts", "src/utils/string.ts"],
      };
      tracker.setInitialScope(scope);
      // No error thrown means no significant expansion detected
      expect(() => {
        tracker.checkExpansion({ files: ["src/utils/math.ts"] });
      }).not.toThrow();
    });

    it("should detect when accessing files outside scope", () => {
      const scope: TaskScope = {
        goal: "Refactor utils",
        files: ["src/utils/math.ts"],
      };
      tracker.setInitialScope(scope);
      // Accessing a file outside scope should not throw (just tracks it)
      tracker.checkExpansion({ files: ["src/utils/math.ts", "src/utils/string.ts"] });
      const expansions = tracker.getExpansions();
      expect(expansions.length).toBe(1);
      expect(expansions[0].additionalFiles).toContain("src/utils/string.ts");
    });

    it("should record original files and new files on expansion", () => {
      const scope: TaskScope = {
        goal: "Fix bug",
        files: ["src/feature/loader.ts"],
      };
      tracker.setInitialScope(scope);
      tracker.checkExpansion({ files: ["src/feature/loader.ts", "src/feature/store.ts", "src/feature/api.ts"] });
      const expansions = tracker.getExpansions();
      expect(expansions.length).toBe(1);
      expect(expansions[0].originalFiles).toEqual(["src/feature/loader.ts"]);
      expect(expansions[0].newFiles).toEqual(["src/feature/loader.ts", "src/feature/store.ts", "src/feature/api.ts"]);
      expect(expansions[0].additionalFiles).toEqual(["src/feature/store.ts", "src/feature/api.ts"]);
    });
  });

  describe("getExpansions", () => {
    it("should return empty array before any expansion", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      expect(tracker.getExpansions()).toEqual([]);
    });

    it("should return all detected expansions", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      tracker.checkExpansion({ files: ["a.ts", "b.ts"] });
      tracker.checkExpansion({ files: ["a.ts", "b.ts", "c.ts"] });
      const expansions = tracker.getExpansions();
      expect(expansions.length).toBe(2);
    });
  });

  describe("needsConfirmation", () => {
    it("should return false when no expansion detected", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      expect(tracker.needsConfirmation({ files: ["a.ts"] })).toBe(false);
    });

    it("should return true when files outside scope are accessed", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      expect(tracker.needsConfirmation({ files: ["a.ts", "b.ts"] })).toBe(true);
    });

    it("should return false after confirmation", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      tracker.checkExpansion({ files: ["a.ts", "b.ts"] });
      tracker.confirmExpansion();
      expect(tracker.needsConfirmation({ files: ["a.ts", "b.ts"] })).toBe(false);
    });
  });

  describe("evaluateChange", () => {
    it("should approve when no expansion", () => {
      const evaluation = tracker.evaluateChange({ files: ["a.ts"] });
      expect(evaluation.approved).toBe(true);
      expect(evaluation.requiresConfirmation).toBe(false);
    });

    it("should require confirmation on significant expansion", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      const evaluation = tracker.evaluateChange({ files: ["a.ts", "b.ts", "c.ts"] });
      expect(evaluation.approved).toBe(false);
      expect(evaluation.requiresConfirmation).toBe(true);
      expect(evaluation.newFiles).toEqual(["b.ts", "c.ts"]);
    });

    it("should approve after scope is confirmed", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      tracker.checkExpansion({ files: ["a.ts", "b.ts"] });
      tracker.confirmExpansion();
      const evaluation = tracker.evaluateChange({ files: ["a.ts", "b.ts"] });
      expect(evaluation.approved).toBe(true);
      expect(evaluation.requiresConfirmation).toBe(false);
    });

    it("should include reason in evaluation", () => {
      tracker.setInitialScope({ goal: "Implement auth", files: ["auth.ts"] });
      const evaluation = tracker.evaluateChange({ files: ["auth.ts", "db.ts"] });
      expect(evaluation.reason).toBeDefined();
      expect(evaluation.reason.length).toBeGreaterThan(0);
    });
  });

  describe("confirmExpansion", () => {
    it("should update approvedAt on confirmation", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      tracker.checkExpansion({ files: ["a.ts", "b.ts"] });
      expect(tracker.getCurrentScope()?.approvedAt).toBeUndefined();
      tracker.confirmExpansion();
      expect(tracker.getCurrentScope()?.approvedAt).toBeDefined();
    });

    it("should clear pending expansions after confirmation", () => {
      tracker.setInitialScope({ goal: "Test", files: ["a.ts"] });
      tracker.checkExpansion({ files: ["a.ts", "b.ts"] });
      tracker.confirmExpansion();
      expect(tracker.needsConfirmation({ files: ["a.ts", "b.ts"] })).toBe(false);
    });
  });
});