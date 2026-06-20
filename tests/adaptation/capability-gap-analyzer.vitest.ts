/**
 * P5.5.3 — CapabilityGapAnalyzer tests.
 *
 * Covers all 7 requirements:
 *   (a) Only signal 1 present → gap with signalStrength=1, confidence="low"
 *   (b) All 3 signals converge on same capability → signalStrength=3, confidence="high"
 *   (c) Signal 2 + Signal 3 → signalStrength=2, confidence="medium"
 *   (d) No signals → empty array
 *   (e) All capabilities registered → no proposals create gaps
 *   (f) Multiple distinct gap candidates → all returned
 *   (g) minSignalStrength=2 filters out weak signals
 */

import { describe, it, expect } from "vitest";
import { CapabilityGapAnalyzer } from "../../src/adaptation/capability-gap-analyzer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capability event with optional resolvedAgent and candidates. */
function capEvent(
  capability: string,
  opts?: { resolvedAgent?: string; candidates?: number },
): {
  payload: { capability?: string; resolvedAgent?: string; candidates?: number };
  timestamp: string;
} {
  return {
    payload: {
      capability,
      resolvedAgent: opts?.resolvedAgent,
      candidates: opts?.candidates,
    },
    timestamp: new Date().toISOString(),
  };
}

/** Proposal targeting a capability. */
function proposalForCap(capability: string): {
  target: { kind: string; capability?: string };
  payload?: Record<string, unknown>;
  reason?: string;
} {
  return {
    target: { kind: "capability", capability },
    reason: "test proposal",
  };
}

/** Proposal targeting something other than a capability. */
function proposalForOther(kind: string): {
  target: { kind: string; capability?: string };
  payload?: Record<string, unknown>;
  reason?: string;
} {
  return {
    target: { kind },
    reason: "non-capability proposal",
  };
}

/** Reflection event with capability_gap recommendation. */
function reflectionGap(
  capability: string,
): {
  payload: { recommendationType?: string; details?: string; capability?: string };
  timestamp: string;
} {
  return {
    payload: {
      recommendationType: "capability_gap",
      capability,
    },
    timestamp: new Date().toISOString(),
  };
}

/** Reflection event whose payload mentions a missing capability. */
function reflectionMissingCap(
  capability: string,
): {
  payload: { recommendationType?: string; details?: string; capability?: string };
  timestamp: string;
} {
  return {
    payload: {
      capability,
      details: `Missing capability: ${capability}`,
    },
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CapabilityGapAnalyzer", () => {
  const analyzer = new CapabilityGapAnalyzer();

  // -----------------------------------------------------------------------
  // (a) Only signal 1 present → signalStrength=1, confidence="low"
  // -----------------------------------------------------------------------

  it("(a) Only signal 1 present → signalStrength=1, confidence=low", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation", "code-review"],
      capabilityEvents: [
        capEvent("security-scan"), // unresolved (no resolvedAgent)
        capEvent("security-scan"), // unresolved
        capEvent("security-scan"), // unresolved
      ],
      proposals: [],
    });

    expect(results).toHaveLength(1);
    const gap = results[0];
    expect(gap.suggestedCapability).toBe("security-scan");
    expect(gap.signalStrength).toBe(1);
    expect(gap.confidence).toBe("low");
    expect(gap.evidence).toContain("3 unresolved capability_routed events");
  });

  it("(a2) candidates===0 also counts as unresolved", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      capabilityEvents: [
        capEvent("missing-cap", { candidates: 0 }),
        capEvent("missing-cap", { candidates: 0 }),
      ],
      proposals: [],
    });

    expect(results).toHaveLength(1);
    expect(results[0].suggestedCapability).toBe("missing-cap");
    expect(results[0].signalStrength).toBe(1);
    expect(results[0].evidence).toContain("2 unresolved capability_routed events");
  });

  it("(a3) Resolved events (with resolvedAgent, candidates>0) excluded from signal 1", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      capabilityEvents: [
        capEvent("code-generation", { resolvedAgent: "agent-1", candidates: 3 }),
        capEvent("code-generation", { resolvedAgent: "agent-2" }),
      ],
      proposals: [],
    });

    // All events resolved → no gaps
    expect(results).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // (b) All 3 signals converge → signalStrength=3, confidence="high"
  // -----------------------------------------------------------------------

  it("(b) All 3 signals converge on same capability → signalStrength=3, confidence=high", () => {
    const missingCap = "security-audit";

    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation", "code-review"],
      capabilityEvents: [
        capEvent(missingCap), // unresolved (no resolvedAgent)
        capEvent(missingCap),
        capEvent(missingCap),
        capEvent(missingCap),
      ],
      proposals: [
        proposalForCap(missingCap),
        proposalForCap(missingCap),
      ],
      reflectionEvents: [
        reflectionGap(missingCap),
        reflectionGap(missingCap),
        reflectionGap(missingCap),
      ],
    });

    expect(results).toHaveLength(1);
    const gap = results[0];
    expect(gap.suggestedCapability).toBe(missingCap);
    expect(gap.signalStrength).toBe(3);
    expect(gap.confidence).toBe("high");
    expect(gap.evidence).toHaveLength(3);
    expect(gap.evidence).toContain("4 unresolved capability_routed events");
    expect(gap.evidence).toContain("2 proposals targeting non-existent capability");
    expect(gap.evidence).toContain("3 reflection gap mentions");
  });

  // -----------------------------------------------------------------------
  // (c) Signal 2 + Signal 3 → signalStrength=2, confidence="medium"
  // -----------------------------------------------------------------------

  it("(c) Signal 2 + Signal 3 → signalStrength=2, confidence=medium", () => {
    const missingCap = "load-testing";

    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      capabilityEvents: [
        // All resolved — no signal 1
        capEvent("code-generation", { resolvedAgent: "agent-1" }),
      ],
      proposals: [
        proposalForCap(missingCap),
        proposalForCap(missingCap),
        proposalForCap(missingCap),
      ],
      reflectionEvents: [
        reflectionGap(missingCap),
        reflectionGap(missingCap),
      ],
    });

    expect(results).toHaveLength(1);
    const gap = results[0];
    expect(gap.suggestedCapability).toBe(missingCap);
    expect(gap.signalStrength).toBe(2);
    expect(gap.confidence).toBe("medium");
    expect(gap.evidence).toHaveLength(2);
    expect(gap.evidence).toContain("3 proposals targeting non-existent capability");
    expect(gap.evidence).toContain("2 reflection gap mentions");
  });

  // -----------------------------------------------------------------------
  // (d) No signals → empty array
  // -----------------------------------------------------------------------

  it("(d) No signals → empty array", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation", "code-review"],
      capabilityEvents: [
        capEvent("code-generation", { resolvedAgent: "agent-1" }),
        capEvent("code-review", { resolvedAgent: "agent-2" }),
      ],
      proposals: [
        proposalForCap("code-generation"),
        proposalForCap("code-review"),
      ],
    });

    expect(results).toEqual([]);
  });

  it("(d2) Empty inputs → empty array", () => {
    const results = analyzer.analyze({
      registeredCapabilities: [],
      capabilityEvents: [],
      proposals: [],
    });

    expect(results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // (e) All capabilities registered → no proposals create gaps
  // -----------------------------------------------------------------------

  it("(e) All capabilities registered → no proposal-based gaps", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation", "code-review", "testing"],
      capabilityEvents: [
        capEvent("code-generation", { resolvedAgent: "agent-1" }),
        capEvent("code-review", { resolvedAgent: "agent-2" }),
        capEvent("testing", { resolvedAgent: "agent-3" }),
      ],
      proposals: [
        proposalForCap("code-generation"),
        proposalForCap("code-review"),
        proposalForCap("testing"),
      ],
    });

    // All capabilities are registered and all events are resolved → no gaps
    expect(results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // (f) Multiple distinct gap candidates → all returned
  // -----------------------------------------------------------------------

  it("(f) Multiple distinct gap candidates → all returned", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      capabilityEvents: [
        capEvent("security-scan"), // signal 1
        capEvent("security-scan"),
        capEvent("load-testing"), // signal 1
      ],
      proposals: [
        proposalForCap("security-scan"), // signal 2
        proposalForCap("load-testing"), // signal 2
        proposalForCap("accessibility-audit"), // signal 2 only
      ],
      reflectionEvents: [
        reflectionGap("security-scan"), // signal 3
      ],
    });

    expect(results).toHaveLength(3);

    const byName = new Map(
      results.map((g) => [g.suggestedCapability, g] as const),
    );

    // security-scan: all 3 signals
    const sec = byName.get("security-scan")!;
    expect(sec).toBeDefined();
    expect(sec.signalStrength).toBe(3);
    expect(sec.confidence).toBe("high");

    // load-testing: signals 1 + 2
    const load = byName.get("load-testing")!;
    expect(load).toBeDefined();
    expect(load.signalStrength).toBe(2);
    expect(load.confidence).toBe("medium");

    // accessibility-audit: signal 2 only
    const a11y = byName.get("accessibility-audit")!;
    expect(a11y).toBeDefined();
    expect(a11y.signalStrength).toBe(1);
    expect(a11y.confidence).toBe("low");
  });

  // -----------------------------------------------------------------------
  // (g) minSignalStrength=2 filters out weak signals
  // -----------------------------------------------------------------------

  it("(g) minSignalStrength=2 filters out weak signals", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      minSignalStrength: 2,
      capabilityEvents: [
        capEvent("weak-gap"), // signal 1 only
        capEvent("weak-gap"),
      ],
      proposals: [
        proposalForCap("strong-gap"), // signal 2
      ],
      reflectionEvents: [
        reflectionGap("strong-gap"), // signal 3 → signalStrength=2
      ],
    });

    // weak-gap has only signal 1 (strength=1), filtered out
    // strong-gap has signal 2 + signal 3 (strength=2), included
    expect(results).toHaveLength(1);
    expect(results[0].suggestedCapability).toBe("strong-gap");
    expect(results[0].signalStrength).toBe(2);
    expect(results[0].confidence).toBe("medium");
  });

  it("(g2) minSignalStrength=3 → only triple-signal gaps survive", () => {
    const missingCap = "triple-signal";

    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      minSignalStrength: 3,
      capabilityEvents: [
        capEvent(missingCap), // unresolved
        capEvent("weak-1"),   // unresolved
        capEvent("weak-2"),   // unresolved
      ],
      proposals: [
        proposalForCap(missingCap),
        proposalForCap("weak-2"),
      ],
      reflectionEvents: [
        reflectionGap(missingCap),
        reflectionGap("weak-1"),
      ],
    });

    // missingCap: signals 1+2+3=3 → included
    // weak-1: signals 1+3=2 → excluded
    // weak-2: signals 1+2=2 → excluded
    expect(results).toHaveLength(1);
    expect(results[0].suggestedCapability).toBe(missingCap);
    expect(results[0].signalStrength).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Edge case: signal 3 via missing capability payload (not capability_gap type)
  // -----------------------------------------------------------------------

  it("detects signal 3 via payload.capability not in registeredCapabilities", () => {
    const missingCap = "undeclared-cap";

    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      capabilityEvents: [],
      proposals: [],
      reflectionEvents: [
        // Not a capability_gap recommendation, but payload has an unregistered capability
        reflectionMissingCap(missingCap),
        reflectionMissingCap(missingCap),
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].suggestedCapability).toBe(missingCap);
    expect(results[0].signalStrength).toBe(1);
    expect(results[0].evidence).toContain("2 reflection gap mentions");
  });

  // -----------------------------------------------------------------------
  // Edge case: duplicate signal-3 counting avoided
  // -----------------------------------------------------------------------

  it("does not double-count reflection event matching both gap conditions", () => {
    const missingCap = "single-count";

    // A reflection event that is BOTH capability_gap type AND has
    // an unregistered capability — should contribute s3+=1, not s3+=2.
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      capabilityEvents: [],
      proposals: [],
      reflectionEvents: [
        {
          payload: {
            recommendationType: "capability_gap",
            capability: missingCap,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].evidence).toContain("1 reflection gap mention");
  });

  // -----------------------------------------------------------------------
  // Edge case: singular grammar in evidence for count=1
  // -----------------------------------------------------------------------

  it("uses singular form for single-item evidence", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      capabilityEvents: [
        capEvent("lonely-gap"), // single unresolved event
      ],
      proposals: [
        proposalForCap("lonely-gap"), // single proposal
      ],
      reflectionEvents: [
        reflectionGap("lonely-gap"), // single reflection
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].evidence).toContain("1 unresolved capability_routed event");
    expect(results[0].evidence).toContain("1 proposal targeting non-existent capability");
    expect(results[0].evidence).toContain("1 reflection gap mention");
  });

  // -----------------------------------------------------------------------
  // Edge case: capability events with undefined capability are skipped
  // -----------------------------------------------------------------------

  it("skips capability events with undefined capability", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-generation"],
      capabilityEvents: [
        { payload: {}, timestamp: new Date().toISOString() },
        { payload: { resolvedAgent: "agent-1" }, timestamp: new Date().toISOString() },
      ],
      proposals: [],
    });

    expect(results).toEqual([]);
  });
});
