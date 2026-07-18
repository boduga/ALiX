import { describe, it, expect } from "vitest";
import { SessionPhase } from "../../src/tui/state.js";

describe("SessionPhase (contract)", () => {
  it("Idle is defined for sessions that have not yet run", () => {
    expect(SessionPhase.Idle).toBeDefined();
  });

  it("progresses through Understanding → Planning → Executing → Verifying → Summarizing → Idle", () => {
    const order = [
      SessionPhase.Understanding,
      SessionPhase.Planning,
      SessionPhase.Executing,
      SessionPhase.Verifying,
      SessionPhase.Summarizing,
      SessionPhase.Idle,
    ];
    expect(order).toEqual([
      SessionPhase.Understanding,
      SessionPhase.Planning,
      SessionPhase.Executing,
      SessionPhase.Verifying,
      SessionPhase.Summarizing,
      SessionPhase.Idle,
    ]);
  });

  it("enum has 6 phases (string-valued, no reverse-mapped duplication)", () => {
    expect(Object.keys(SessionPhase).length).toBe(6);
  });

  it("each phase is a distinct non-empty string", () => {
    const values = Object.values(SessionPhase);
    expect(values).toHaveLength(6);
    for (const v of values) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
    expect(new Set(values).size).toBe(6);
  });

  it("phase values are JSON-serialisable as readable strings", () => {
    expect(JSON.stringify({ phase: SessionPhase.Understanding })).toBe(
      '{"phase":"Understanding"}',
    );
  });
});
