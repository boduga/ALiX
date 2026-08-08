import { describe, it, expect } from "vitest";
import {
  createContextBudget,
  preflight,
  assertFits,
  classifyOverflow,
  ContextBudgetOverflowError,
  CONTEXT_CATEGORIES,
  DEFAULT_OUTPUT_RATIO,
  DEFAULT_OUTPUT_FLOOR,
  DEFAULT_OUTPUT_CAP,
  type BudgetedContextItem,
  type ContextBudget,
} from "../../src/config/context-budget.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { ModelDescriptor } from "../../src/config/context-limits.js";

function descriptor(windowTokens: number, outputTokenLimit?: number): ModelDescriptor {
  return {
    provider: "test",
    model: "test-model",
    contextWindowTokens: windowTokens,
    tokenizer: "cl100k_base",
    safetyFactor: 1.2,
  };
}

describe("createContextBudget (B contract — reserved output)", () => {
  it("64k window → 12,800 reserved (20%)", () => {
    const b = createContextBudget(descriptor(64_000));
    expect(b.budgetReservation).toBe(12_800);
    expect(b.requestedMaxOutputTokens).toBe(12_800); // §5: defaults to reservation
    expect(b.availableInputTokens).toBe(64_000 - 12_800);
  });

  it("200k window → 32,768 reserved (capped)", () => {
    const b = createContextBudget(descriptor(200_000));
    expect(b.budgetReservation).toBe(32_768);
    expect(b.availableInputTokens).toBe(200_000 - 32_768);
  });

  it("1M window → 32,768 reserved (capped)", () => {
    const b = createContextBudget(descriptor(1_000_000));
    expect(b.budgetReservation).toBe(32_768);
  });

  it("4,096 floor applies to small windows (16k → 4,096, not 3,200)", () => {
    const b = createContextBudget(descriptor(16_000));
    expect(b.budgetReservation).toBe(4_096);
    expect(b.availableInputTokens).toBe(16_000 - 4_096);
  });

  it("exposes the immutable 5-field shape", () => {
    const b = createContextBudget(descriptor(64_000));
    expect(b.contextWindowTokens).toBe(64_000);
    expect(typeof b.budgetReservation).toBe("number");
    expect(typeof b.requestedMaxOutputTokens).toBe("number");
    expect(typeof b.availableInputTokens).toBe("number");
    expect(typeof b.policyReservation).toBe("number");
  });

  it("is immutable (frozen) — the object never mutates", () => {
    const b = createContextBudget(descriptor(64_000)) as ContextBudget & { budgetReservation: number };
    expect(Object.isFrozen(b)).toBe(true);
    const before = b.budgetReservation;
    try {
      b.budgetReservation = 1;
    } catch {
      /* frozen: strict-mode assignment throws; value stays */
    }
    expect(b.budgetReservation).toBe(before);
  });

  it("clamps reservedOutput to model.outputTokenLimit when known", () => {
    const b = createContextBudget(descriptor(64_000), { outputTokenLimit: 10_000 });
    expect(b.budgetReservation).toBe(10_000);
    expect(b.requestedMaxOutputTokens).toBe(10_000); // §5: still defaults to reservation
    expect(b.availableInputTokens).toBe(64_000 - 10_000);
  });

  it("does not clamp below policy reservation when outputTokenLimit is large", () => {
    const b = createContextBudget(descriptor(200_000), { outputTokenLimit: 100_000 });
    expect(b.budgetReservation).toBe(32_768);
    expect(b.requestedMaxOutputTokens).toBe(32_768);
  });

  it("config-overridable ratio", () => {
    const b = createContextBudget(descriptor(64_000), { outputRatio: 0.5 });
    expect(b.budgetReservation).toBe(32_000);
  });

  it("config-overridable floor", () => {
    const b = createContextBudget(descriptor(16_000), { outputFloor: 8_000 });
    expect(b.budgetReservation).toBe(8_000);
  });

  it("config-overridable cap", () => {
    const b = createContextBudget(descriptor(1_000_000), { outputCap: 16_000 });
    expect(b.budgetReservation).toBe(16_000);
  });

  it("ships default knob constants 0.20 / 4,096 / 32,768", () => {
    expect(DEFAULT_OUTPUT_RATIO).toBe(0.2);
    expect(DEFAULT_OUTPUT_FLOOR).toBe(4_096);
    expect(DEFAULT_OUTPUT_CAP).toBe(32_768);
  });

  it("wires the knobs into ContextConfig defaults (the one config integration point)", () => {
    expect(DEFAULT_CONFIG.context.budget).toEqual({
      outputRatio: 0.2,
      outputFloor: 4_096,
      outputCap: 32_768,
    });
  });

  it("guard: a window below the floor never yields negative available input", () => {
    const b = createContextBudget(descriptor(2_000));
    // floor (4,096) > window (2,000): reservation clamps to the window itself.
    expect(b.budgetReservation).toBe(2_000);
    expect(b.availableInputTokens).toBe(0);
  });

  it("guard: an explicit floor above the window also clamps to non-negative available", () => {
    const b = createContextBudget(descriptor(2_000), { outputFloor: 8_000, outputCap: 16_000 });
    expect(b.budgetReservation).toBe(2_000);
    expect(b.availableInputTokens).toBe(0);
  });

  it("partial config object falls back to defaults for unset knobs", () => {
    // Only outputRatio is overridden; floor/cap must keep their defaults.
    const b = createContextBudget(descriptor(16_000), { outputRatio: 0.5 });
    expect(b.budgetReservation).toBe(8_000); // floor(16k*0.5)=8k, above floor 4,096, below cap
    expect(b.availableInputTokens).toBe(8_000);
  });
});

describe("preflight (pure gate)", () => {
  const budget = createContextBudget(descriptor(64_000)); // available input = 51,200

  it("returns { fits: true } for an under-budget request", () => {
    const items: BudgetedContextItem[] = [
      { category: "mandatory_system_governance", tokens: 1_000 },
      { category: "current_task", tokens: 500 },
      { category: "recent_conversation", tokens: 2_000 },
    ];
    expect(preflight(budget, items)).toEqual({ fits: true });
  });

  it("returns overflow with a correct byCategory breakdown when over budget", () => {
    const items: BudgetedContextItem[] = [
      { category: "mandatory_system_governance", tokens: 10_000 },
      { category: "current_task", tokens: 5_000 },
      { category: "current_execution_state", tokens: 8_000 },
      { category: "recent_conversation", tokens: 20_000 },
      { category: "recent_tool_results", tokens: 15_000 },
      { category: "older_context", tokens: 10_000 },
    ];
    // total = 68,000; available = 51,200; overage = 16,800
    const result = preflight(budget, items);
    expect(result.fits).toBe(false);
    if (!result.fits) {
      expect(result.overflow.overageTokens).toBe(16_800);
      expect(result.overflow.byCategory).toEqual({
        mandatory_system_governance: 10_000,
        current_task: 5_000,
        current_execution_state: 8_000,
        recent_conversation: 20_000,
        recent_tool_results: 15_000,
        older_context: 10_000,
      });
    }
  });

  it("zero-fills absent categories so byCategory is a deterministic full record", () => {
    const items: BudgetedContextItem[] = [
      { category: "current_task", tokens: 60_000 },
    ];
    const result = preflight(budget, items);
    if (!result.fits) {
      expect(result.overflow.byCategory.mandatory_system_governance).toBe(0);
      expect(result.overflow.byCategory.recent_tool_results).toBe(0);
      expect(result.overflow.byCategory.older_context).toBe(0);
    }
  });

  it("is pure: does not mutate the input items", () => {
    const items: BudgetedContextItem[] = [
      { category: "mandatory_system_governance", tokens: 60_000 },
      { category: "recent_conversation", tokens: 1_000 },
    ];
    const snapshot = JSON.stringify(items);
    preflight(budget, items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it("is deterministic: identical input yields an identical result", () => {
    const items: BudgetedContextItem[] = [
      { category: "recent_conversation", tokens: 60_000 },
    ];
    expect(preflight(budget, items)).toEqual(preflight(budget, items));
  });
});

describe("classifyOverflow / ContextBudgetOverflowError (reducible vs irreducible)", () => {
  const budget = createContextBudget(descriptor(64_000)); // available input = 51,200

  it("classifies fits when total is under budget", () => {
    const items: BudgetedContextItem[] = [{ category: "current_task", tokens: 100 }];
    expect(classifyOverflow(budget, items)).toBe("fits");
  });

  it("classifies reducible when the mandatory core fits but optional tiers overflow", () => {
    const items: BudgetedContextItem[] = [
      { category: "mandatory_system_governance", tokens: 10_000 },
      { category: "current_task", tokens: 5_000 }, // mandatory = 15,000 ≤ 51,200
      { category: "older_context", tokens: 50_000 }, // total = 65,000 > 51,200
    ];
    expect(classifyOverflow(budget, items)).toBe("reducible");
  });

  it("classifies irreducible when the mandatory core alone exceeds available input", () => {
    const items: BudgetedContextItem[] = [
      { category: "mandatory_system_governance", tokens: 40_000 },
      { category: "current_task", tokens: 20_000 }, // mandatory = 60,000 > 51,200
      { category: "recent_conversation", tokens: 100 },
    ];
    expect(classifyOverflow(budget, items)).toBe("irreducible");
  });

  it("assertFits raises a typed ContextBudgetOverflowError for irreducible overflow", () => {
    const items: BudgetedContextItem[] = [
      { category: "mandatory_system_governance", tokens: 40_000 },
      { category: "current_task", tokens: 20_000 },
    ];
    expect(() => assertFits(budget, items)).toThrow(ContextBudgetOverflowError);
    try {
      assertFits(budget, items);
      throw new Error("assertFits should have thrown for an irreducible overflow");
    } catch (err) {
      expect(err).toBeInstanceOf(ContextBudgetOverflowError);
      const e = err as ContextBudgetOverflowError;
      expect(e.kind).toBe("context_budget_overflow");
      expect(e.reducible).toBe(false);
      expect(e.overageTokens).toBe(60_000 - 51_200);
      expect(e.availableInputTokens).toBe(51_200);
      expect(e.mandatoryTokens).toBe(60_000);
      expect(e.contextWindowTokens).toBe(64_000);
    }
  });

  it("assertFits returns overflow (does not throw) for a reducible overflow", () => {
    const items: BudgetedContextItem[] = [
      { category: "mandatory_system_governance", tokens: 10_000 },
      { category: "older_context", tokens: 50_000 },
    ];
    const result = assertFits(budget, items);
    expect(result.fits).toBe(false);
  });

  it("assertFits returns { fits: true } for a fitting request", () => {
    const items: BudgetedContextItem[] = [{ category: "current_task", tokens: 100 }];
    expect(assertFits(budget, items)).toEqual({ fits: true });
  });

  it("ContextBudgetOverflowError can also represent a reducible overflow (distinguishing field)", () => {
    const err = new ContextBudgetOverflowError({
      reducible: true,
      overageTokens: 100,
      byCategory: {
        mandatory_system_governance: 0,
        current_task: 0,
        current_execution_state: 0,
        recent_conversation: 100,
        recent_tool_results: 0,
        older_context: 0,
      },
      availableInputTokens: 51_200,
      mandatoryTokens: 0,
      contextWindowTokens: 64_000,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("context_budget_overflow");
    expect(err.reducible).toBe(true);
    expect(err.message).toContain("reducible");
  });
});

describe("ContextCategory taxonomy (spec D tiers)", () => {
  it("exposes the six tier categories in tier order", () => {
    expect(CONTEXT_CATEGORIES).toEqual([
      "mandatory_system_governance",
      "current_task",
      "current_execution_state",
      "recent_conversation",
      "recent_tool_results",
      "older_context",
    ]);
  });
});
