import { describe, it, expect } from "vitest";
import { createContextPressureTracker } from "../../src/run/context-pressure.js";
import type { AssembledContext } from "../../src/config/context-assembly.js";

function assembled(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    admitted: [],
    dropped: [],
    admittedTokens: 0,
    droppedTokens: 0,
    mandatoryTokens: 0,
    protectedTokens: 0,
    remainingTokens: 100,
    ...overrides,
  } as AssembledContext;
}
function dropItem(category: "recent_conversation" | "recent_tool_results" | "older_context") {
  return { item: { category, tokens: 10 } as never, reason: "budget_exhausted" as const };
}

describe("contextPressure tracker — aggregate + peak", () => {
  it("aggregates tier drops across iterations and tracks min remainingTokens", () => {
    const t = createContextPressureTracker();
    t.record(0, assembled({ dropped: [dropItem("recent_conversation"), dropItem("recent_conversation")], remainingTokens: 40 }));
    t.record(1, assembled({ dropped: [dropItem("recent_tool_results")], remainingTokens: 80 }));
    const s = t.snapshot();
    expect(s.aggregate.tier4Dropped).toBe(2);
    expect(s.aggregate.tier5Dropped).toBe(1);
    expect(s.aggregate.tier6Dropped).toBe(0);
    expect(s.aggregate.minRemainingTokens).toBe(40);
  });

  it("records the peak as the highest-drop iteration, with its iteration index", () => {
    const t = createContextPressureTracker();
    t.record(0, assembled({ dropped: [dropItem("recent_conversation")], remainingTokens: 90 }));
    t.record(1, assembled({ dropped: [dropItem("recent_tool_results"), dropItem("older_context")], remainingTokens: 30 }));
    const s = t.snapshot();
    expect(s.peak.iteration).toBe(1);
    expect(s.peak.tier4Dropped).toBe(0);
    expect(s.peak.tier5Dropped).toBe(1);
    expect(s.peak.tier6Dropped).toBe(1);
    expect(s.peak.remainingTokens).toBe(30);
  });

  it("exposes totalIterations so iterationsSincePeak is derivable", () => {
    const t = createContextPressureTracker();
    t.record(0, assembled({}));
    t.record(1, assembled({ dropped: [dropItem("older_context")], remainingTokens: 10 }));
    const s = t.snapshot();
    expect(s.totalIterations).toBe(2);
    expect(s.totalIterations - s.peak.iteration).toBe(1); // iterationsSincePeak
  });
});
