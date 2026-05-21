import { describe, it, expect } from "vitest";
import { selectStrategy, buildRefinePrompt, applyStrategy, getStrategy } from "../../src/orchestrator/refine-strategies.js";

describe("RefineStrategies", () => {
  describe("selectStrategy", () => {
    it("selects simplify for syntax errors", () => {
      const strategy = selectStrategy("SyntaxError: unexpected token", "feature");
      expect(strategy).toBe("simplify");
    });

    it("selects verify_only for test failures", () => {
      const strategy = selectStrategy("Test failed: expected 2 to equal 3", "feature");
      expect(strategy).toBe("verify_only");
    });

    it("selects decompose for bugfix logic errors", () => {
      const strategy = selectStrategy("Logic error: wrong condition", "bugfix");
      expect(strategy).toBe("decompose");
    });

    it("defaults to retry for unknown failures", () => {
      const strategy = selectStrategy("Something went wrong", "feature");
      expect(strategy).toBe("retry");
    });
  });

  describe("buildRefinePrompt", () => {
    it("returns a prompt with failure context", async () => {
      const { prompt, strategy } = await buildRefinePrompt(
        "Test failed: expected true to be false",
        "bugfix"
      );
      expect(prompt).toContain("Test failed");
      expect(strategy).toBeTruthy();
    });
  });

  describe("applyStrategy", () => {
    it("substitutes failure placeholder", () => {
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
      expect(result).toContain("Syntax error");
      expect(result).not.toContain("{{failure}}");
    });

    it("substitutes context placeholder", () => {
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
      expect(result).toContain("current state");
    });
  });

  describe("getStrategy", () => {
    it("returns default retry when file not found", async () => {
      const strategy = await getStrategy("nonexistent");
      expect(strategy.name).toBe("retry");
    });
  });
});