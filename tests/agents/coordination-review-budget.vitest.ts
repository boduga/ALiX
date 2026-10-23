/**
 * The review budget bounds the REVIEWER'S PROMPT, not the worker's verdict.
 *
 * A real coordination run failed a worker with "Evidence exceeds review budget;
 * completion remains unverified" after three attempts — the worker had inspected
 * test files and read a 1000-line log, so thoroughness was punished as failure.
 * Exceeding the budget must reduce what is SENT, never reject the work.
 */
import { describe, it, expect } from "vitest";
import { REVIEW_BUDGET_CHARS, boundEvidence } from "../../src/agents/coordination-objective-review.js";

describe("boundEvidence", () => {
  it("keeps the newest evidence and marks what it dropped", () => {
    const evidence = Array.from({ length: 100 }, (_, i) => `tool-${i}: ${"x".repeat(5_000)}`);
    const joined = boundEvidence(evidence, 20_000).join("\n");
    expect(joined.length).toBeLessThanOrEqual(20_200);
    // The newest item is what the worker's conclusion rests on.
    expect(joined).toContain("tool-99");
    expect(joined).toMatch(/earlier tool output\(s\) omitted to fit the review budget/);
  });

  it("leaves evidence that already fits completely untouched", () => {
    const evidence = ["a small output", "another"];
    expect(boundEvidence(evidence, 1_000_000)).toEqual(evidence);
  });

  it("clips a single oversized item instead of dropping it", () => {
    const out = boundEvidence([`only: ${"y".repeat(50_000)}`], 20_000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/truncated for review budget/);
    expect(out[0].length).toBeLessThan(3_000);
  });

  it("never returns an empty set when there was evidence", () => {
    // Budget so small every item exceeds it: the first (newest) must still be
    // kept, or the reviewer would judge an objective with no evidence at all.
    const out = boundEvidence(["a".repeat(5_000), "b".repeat(5_000)], 10);
    expect(out.length).toBeGreaterThan(0);
  });

  it("declares a budget large enough for findings plus bounded evidence", () => {
    // Guards a regression to a budget so small that any real run trips it.
    expect(REVIEW_BUDGET_CHARS).toBeGreaterThanOrEqual(64_000);
  });
});
