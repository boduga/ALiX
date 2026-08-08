import { describe, it, expect } from "vitest";
import { createContextBudget } from "../../src/config/context-budget.js";

const descriptor = { provider: "test", model: "m", contextWindowTokens: 64_000, tokenizer: "cl100k_base" as const, safetyFactor: 1.2 };

describe("createContextBudget — output-knob decoupling (§5)", () => {
  it("defaults requestedMaxOutputTokens to budgetReservation (behavior preserved)", () => {
    const b = createContextBudget(descriptor);
    expect(b.budgetReservation).toBe(12_800); // floor(64k×0.2)=12800
    expect(b.requestedMaxOutputTokens).toBe(12_800);
    expect(b.availableInputTokens).toBe(64_000 - 12_800);
  });

  it("clamps a configured maxOutputTokens to ≤ budgetReservation", () => {
    const b = createContextBudget(descriptor, { maxOutputTokens: 99_999 });
    expect(b.requestedMaxOutputTokens).toBeLessThanOrEqual(b.budgetReservation);
  });

  it("honors a smaller requestedMaxOutputTokens without changing input budget", () => {
    const b = createContextBudget(descriptor, { maxOutputTokens: 4_000 });
    expect(b.requestedMaxOutputTokens).toBe(4_000);
    expect(b.budgetReservation).toBe(12_800); // input reservation unchanged
    expect(b.availableInputTokens).toBe(64_000 - 12_800); // unchanged
  });
});
