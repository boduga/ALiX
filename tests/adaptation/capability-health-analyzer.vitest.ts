/**
 * P5.5.2 — CapabilityHealthAnalyzer tests.
 *
 * Covers all 8 behavioral requirements:
 *   (a) Capability with high usage → active or mature.
 *   (b) Capability with falling trend → declining.
 *   (c) Capability with low count → emerging.
 *   (d) Capability with no agents → deprecated.
 *   (e) No IntelligenceReport → keepRate/revertRate are null.
 *   (f) Demand score computed correctly.
 *   (g) Trend direction computed correctly.
 *   (h) Empty agent cards → empty result.
 */

import { describe, it, expect } from "vitest";
import { CapabilityHealthAnalyzer } from "../../src/adaptation/capability-health-analyzer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const DAYS_RECENT = 30;
const DAYS_PRIOR_END = 60;

/** Return an ISO timestamp `offsetDays` before now. */
function ts(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * MS_PER_DAY).toISOString();
}

/** Create a simple agent card. */
function agentCard(
  id: string,
  capabilities: string[],
): { capabilities: string[]; id: string } {
  return { id, capabilities };
}

/** Create a capability event. */
function capEvent(
  capability: string,
  offsetDays: number,
  resolvedAgent?: string,
): { payload: { capability: string; resolvedAgent?: string }; timestamp: string } {
  return {
    payload: { capability, resolvedAgent },
    timestamp: ts(offsetDays),
  };
}

/** Create a proposal targeting a capability via target. */
function proposalFor(
  capability: string,
  offsetDays: number,
): {
  target: { kind: string; capability: string };
  payload?: { capability?: string };
  createdAt: string;
} {
  return {
    target: { kind: "capability", capability },
    createdAt: ts(offsetDays),
  };
}

/** Create a proposal targeting a capability via payload. */
function proposalForPayload(
  capability: string,
  offsetDays: number,
): {
  target: { kind: string };
  payload: { capability: string };
  createdAt: string;
} {
  return {
    target: { kind: "agent_card" },
    payload: { capability },
    createdAt: ts(offsetDays),
  };
}

/** Create a goal event referencing capabilities. */
function goalEvent(
  capabilities: string[],
  offsetDays: number,
): { payload: { capabilities?: string[] }; timestamp: string } {
  return {
    payload: { capabilities },
    timestamp: ts(offsetDays),
  };
}

/** Build a minimal intelligence report input with by-capability buckets. */
function intelReport(
  buckets: Array<{
    value: string;
    keepRate?: number;
    advisoryRevertRate?: number;
    actualRevertRate?: number;
  }>,
): {
  buckets: {
    byCapability: {
      buckets: Array<{
        value: string;
        keepRate?: number;
        advisoryRevertRate?: number;
        actualRevertRate?: number;
      }>;
    };
  };
} {
  return { buckets: { byCapability: { buckets } } };
}

/** Spread `count` events evenly across the given offsetDays range. */
function spreadEvents(
  capability: string,
  count: number,
  minOffsetDays: number,
  maxOffsetDays: number,
  resolvedAgent?: string,
): Array<{ payload: { capability: string; resolvedAgent?: string }; timestamp: string }> {
  const events: ReturnType<typeof capEvent>[] = [];
  const range = maxOffsetDays - minOffsetDays;
  for (let i = 0; i < count; i++) {
    const offset = minOffsetDays + (range * i) / Math.max(count - 1, 1);
    events.push(capEvent(capability, Math.round(offset), resolvedAgent));
  }
  return events;
}

/** Spread `count` proposals evenly across the given offsetDays range. */
function spreadProposals(
  capability: string,
  count: number,
  minOffsetDays: number,
  maxOffsetDays: number,
): Array<{
  target: { kind: string; capability: string };
  createdAt: string;
}> {
  const proposals: ReturnType<typeof proposalFor>[] = [];
  const range = maxOffsetDays - minOffsetDays;
  for (let i = 0; i < count; i++) {
    const offset = minOffsetDays + (range * i) / Math.max(count - 1, 1);
    proposals.push(proposalFor(capability, Math.round(offset)));
  }
  return proposals;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CapabilityHealthAnalyzer", () => {
  const analyzer = new CapabilityHealthAnalyzer();

  // -----------------------------------------------------------------------
  // (a) Capability with high usage → mature
  // -----------------------------------------------------------------------

  it("(a) Capability with high usage, stable trends, high keep rate → mature", () => {
    const cap = "code-generation";

    // 3 agents register this capability
    const agentCards = [
      agentCard("agent-1", [cap, "code-review"]),
      agentCard("agent-2", [cap]),
      agentCard("agent-3", [cap, "testing"]),
    ];

    // 60 resolution events: 30 recent (1-28d), 25 prior (31-58d), 5 old (61-90d)
    const events = [
      ...spreadEvents(cap, 30, 1, 28, "agent-1"),
      ...spreadEvents(cap, 25, 31, 59, "agent-2"),
      ...spreadEvents(cap, 5, 61, 90, "agent-3"),
    ];

    // 25 proposals: 12 recent, 10 prior, 3 old
    const proposals = [
      ...spreadProposals(cap, 12, 1, 28),
      ...spreadProposals(cap, 10, 31, 59),
      ...spreadProposals(cap, 3, 61, 90),
    ];

    const intel = intelReport([
      { value: cap, keepRate: 0.85, advisoryRevertRate: 0.05, actualRevertRate: 0.02 },
    ]);

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: intel,
      proposals,
      capabilityEvents: events,
    });

    expect(results).toHaveLength(3); // code-generation, code-review, testing

    const health = results.find((r) => r.capability === cap)!;
    expect(health).toBeDefined();

    expect(health.agentCount).toBe(3);
    expect(health.resolutionCount).toBe(60);
    expect(health.resolutionCountRecent).toBe(30);
    expect(health.resolutionCountPrior).toBe(25);
    expect(health.proposalCountRecent).toBe(12);
    expect(health.proposalCountPrior).toBe(10);
    expect(health.proposalCount).toBe(25);
    expect(health.keepRate).toBeCloseTo(0.85);
    expect(health.revertRate).toBeCloseTo(0.05);

    // resolutionTrend: diff = 30-25 = 5, threshold = 60*0.2 = 12 → |5| < 12 → stable
    // proposalTrend: diff = 12-10 = 2, threshold = 25*0.2 = 5 → |2| < 5 → stable
    // Mature: resolution >= 50, keepRate >= 0.75, revertRate < 0.1, proposals >= 20, stable trends
    expect(health.lifecycleState).toBe("mature");
  });

  // -----------------------------------------------------------------------
  // (b) Capability with falling trend → declining
  // -----------------------------------------------------------------------

  it("(b) Capability with falling resolution trend → declining", () => {
    const cap = "falling-skill";

    const agentCards = [agentCard("agent-1", [cap])];

    // Skew heavily to prior: 5 recent, 30 prior (31-60 to avoid 30d boundary)
    const events = [
      ...spreadEvents(cap, 5, 1, 28),
      ...spreadEvents(cap, 30, 31, 59),
    ];

    const proposals = [
      ...spreadProposals(cap, 3, 1, 28),
      ...spreadProposals(cap, 3, 31, 59),
    ];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    expect(health.resolutionCountRecent).toBe(5);
    expect(health.resolutionCountPrior).toBe(30);
    // diff = 5-30 = -25, threshold = 35*0.2 = 7 → -25 < -7 → falling
    expect(health.lifecycleState).toBe("declining");
  });

  it("(b2) Capability with low keep rate → declining", () => {
    const cap = "low-keep";

    const agentCards = [agentCard("agent-1", [cap])];

    const events = [
      ...spreadEvents(cap, 12, 1, 28),
      ...spreadEvents(cap, 10, 31, 59),
    ];

    const proposals = [
      ...spreadProposals(cap, 5, 1, 28),
      ...spreadProposals(cap, 5, 31, 59),
    ];

    const intel = intelReport([
      { value: cap, keepRate: 0.3, advisoryRevertRate: 0.4, actualRevertRate: 0.2 },
    ]);

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: intel,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    // keepRate 0.3 < 0.5 → declining
    expect(health.lifecycleState).toBe("declining");
    expect(health.keepRate).toBeCloseTo(0.3);
  });

  it("(b3) Capability with high revert rate → declining", () => {
    const cap = "high-revert";

    const agentCards = [agentCard("agent-1", [cap])];

    const events = [
      ...spreadEvents(cap, 10, 1, 29),
      ...spreadEvents(cap, 10, 31, 59),
    ];

    const proposals = [
      ...spreadProposals(cap, 5, 1, 28),
      ...spreadProposals(cap, 5, 31, 59),
    ];

    const intel = intelReport([
      { value: cap, keepRate: 0.7, advisoryRevertRate: 0.1, actualRevertRate: 0.25 },
    ]);

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: intel,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    // revertRate = max(0.1, 0.25) = 0.25 > 0.2 → declining
    expect(health.lifecycleState).toBe("declining");
    expect(health.revertRate).toBeCloseTo(0.25);
  });

  // -----------------------------------------------------------------------
  // (c) Capability with low count → emerging
  // -----------------------------------------------------------------------

  it("(c) Capability with few proposals → emerging", () => {
    const cap = "new-capability";

    const agentCards = [agentCard("agent-1", [cap])];

    // Some resolutions but only 2 proposals
    const events = [...spreadEvents(cap, 8, 1, 29)];
    const proposals = [...spreadProposals(cap, 2, 1, 29)];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    expect(health.resolutionCount).toBe(8);
    expect(health.proposalCount).toBe(2);
    // resolutionCount > 0 and proposalCount < 5 → emerging
    expect(health.lifecycleState).toBe("emerging");
  });

  // -----------------------------------------------------------------------
  // (d) Capability with no agents → deprecated
  // -----------------------------------------------------------------------

  it("(d) Capability with zero resolution count → deprecated", () => {
    const cap = "orphan-capability";

    // Agent registers the capability but no events
    const agentCards = [agentCard("agent-1", [cap])];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals: [],
      capabilityEvents: [],
    });

    const health = results[0];
    expect(health.resolutionCount).toBe(0);
    expect(health.agentCount).toBe(1);
    // resolutionCount === 0 → deprecated
    expect(health.lifecycleState).toBe("deprecated");
  });

  it("(d2) Capability referenced by events but no agent has it → not in results", () => {
    // Only capabilities from agent cards are extracted.
    // A capability that appears only in events (not in any agent card) is excluded.
    const agentCards = [agentCard("agent-1", ["known-cap"])];

    const events = [capEvent("orphan-event-cap", 5)];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals: [],
      capabilityEvents: events,
    });

    // Only "known-cap" appears; "orphan-event-cap" is not extracted
    expect(results).toHaveLength(1);
    expect(results[0].capability).toBe("known-cap");
  });

  // -----------------------------------------------------------------------
  // (e) No IntelligenceReport → keepRate/revertRate are null
  // -----------------------------------------------------------------------

  it("(e) No IntelligenceReport → keepRate and revertRate are null", () => {
    const cap = "no-intel-cap";

    const agentCards = [agentCard("agent-1", [cap])];

    const events = [...spreadEvents(cap, 15, 1, 29)];
    const proposals = [...spreadProposals(cap, 8, 1, 29)];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    expect(health.keepRate).toBeNull();
    expect(health.revertRate).toBeNull();
    // Without intel, keepRate null means the null-check passes in lifecycle rules.
    // resolution=15 >= 10, keepRate null → passes null check
    // revertRate null → passes null check
    // proposals=8 >= 5
    // trending should check...
    // All events recent, so diff=15-0=15, threshold=15*0.2=3, 15>3 → rising
    // resolutionTrend !== "falling" → true
    // proposalTrend: recent=8, prior=0, diff=8, threshold=8*0.2=1.6, 8>1.6 → rising
    // proposalTrend !== "falling" → true
    // → active
    expect(health.lifecycleState).toBe("active");
  });

  // -----------------------------------------------------------------------
  // (f) Demand score computed correctly
  // -----------------------------------------------------------------------

  it("(f) Demand score min-max normalized across capabilities", () => {
    const capA = "high-demand";
    const capB = "low-demand";
    const capC = "no-demand";

    const agentCards = [
      agentCard("agent-1", [capA]),
      agentCard("agent-2", [capB]),
      agentCard("agent-3", [capC]),
    ];

    // capA: 10 unresolved events + referenced by 5 goals → raw demand = 15
    const eventsA: ReturnType<typeof capEvent>[] = [];
    for (let i = 0; i < 10; i++) {
      eventsA.push(capEvent(capA, 5)); // no resolvedAgent → unresolved
    }

    // capB: 2 unresolved events + referenced by 1 goal → raw demand = 3
    const eventsB: ReturnType<typeof capEvent>[] = [];
    for (let i = 0; i < 2; i++) {
      eventsB.push(capEvent(capB, 5));
    }

    // capC: 0 unresolved, 0 goals → raw demand = 0
    const eventsC: ReturnType<typeof capEvent>[] = [];

    const goalEvents = [
      goalEvent([capA, capA, capA, capA, capA], 5), // 5 references to capA
      goalEvent([capB], 5), // 1 reference to capB
    ];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals: [],
      capabilityEvents: [...eventsA, ...eventsB, ...eventsC],
      goalEvents,
    });

    const a = results.find((r) => r.capability === capA)!;
    const b = results.find((r) => r.capability === capB)!;
    const c = results.find((r) => r.capability === capC)!;

    // Min = 0 (capC), Max = 15 (capA), Range = 15
    // capA: (15-0)/15 = 1.0
    // capB: (3-0)/15 = 0.2
    // capC: (0-0)/15 = 0.0
    expect(a.demandScore).toBeCloseTo(1.0);
    expect(b.demandScore).toBeCloseTo(0.2);
    expect(c.demandScore).toBeCloseTo(0.0);
  });

  it("(f2) All capabilities have same demand → all demand scores are 0", () => {
    const capA = "same-a";
    const capB = "same-b";

    const agentCards = [
      agentCard("agent-1", [capA]),
      agentCard("agent-2", [capB]),
    ];

    // Both have 0 demand
    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals: [],
      capabilityEvents: [],
    });

    expect(results[0].demandScore).toBe(0);
    expect(results[1].demandScore).toBe(0);
  });

  // -----------------------------------------------------------------------
  // (g) Trend direction computed correctly
  // -----------------------------------------------------------------------

  it("(g) resolution trend rising (all recent, no prior)", () => {
    const cap = "rising-trend";

    const agentCards = [agentCard("agent-1", [cap])];

    // 20 recent events, 0 prior
    const events = [...spreadEvents(cap, 20, 1, 29)];

    const proposals = [...spreadProposals(cap, 5, 1, 29)];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    // diff = 20-0 = 20, threshold = 20*0.2 = 4, 20 > 4 → rising
    expect(health.resolutionCountRecent).toBe(20);
    expect(health.resolutionCountPrior).toBe(0);
    // Trend is "rising" but lifecycle is "active" (resolutionCount=20 >= 10, proposalCount=5 >= 5)
    expect(health.lifecycleState).toBe("active");
    expect(health.rationale).toContain("resolution trend rising");
  });

  it("(g2) resolution trend falling (all prior, no recent)", () => {
    const cap = "falling-trend";

    const agentCards = [agentCard("agent-1", [cap])];

    // 0 recent, 15 prior (31-59 to avoid boundary)
    const events = [...spreadEvents(cap, 15, 31, 59)];

    // Need enough proposals to not be emerging
    const proposals = [...spreadProposals(cap, 6, 31, 59)];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    expect(health.resolutionCountRecent).toBe(0);
    expect(health.resolutionCountPrior).toBe(15);
    // diff = 0-15 = -15, threshold = 15*0.2 = 3, -15 < -3 → falling → declining
    expect(health.lifecycleState).toBe("declining");
    expect(health.rationale).toContain("resolution trend falling");
  });

  it("(g3) resolution trend stable (balanced recent/prior)", () => {
    const cap = "stable-trend";

    const agentCards = [agentCard("agent-1", [cap])];

    // 10 recent, 10 prior → diff = 0
    const events = [
      ...spreadEvents(cap, 10, 1, 28),
      ...spreadEvents(cap, 10, 31, 59),
    ];

    const proposals = [
      ...spreadProposals(cap, 5, 1, 28),
      ...spreadProposals(cap, 5, 31, 59),
    ];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    // diff = 10-10 = 0, stable
    expect(health.resolutionCountRecent).toBe(10);
    expect(health.resolutionCountPrior).toBe(10);
    expect(health.rationale).toContain("resolution trend stable");
    // resolution=20 >= 10, proposals=10 >= 5, stable → active
    expect(health.lifecycleState).toBe("active");
  });

  // -----------------------------------------------------------------------
  // (h) Empty agent cards → empty result
  // -----------------------------------------------------------------------

  it("(h) Empty agent cards → empty result", () => {
    const results = analyzer.analyze({
      agentCards: [],
      intelligenceReport: null,
      proposals: [],
      capabilityEvents: [],
    });

    expect(results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Edge case: proposal matched via payload.capability
  // -----------------------------------------------------------------------

  it("counts proposals matched via payload.capability", () => {
    const cap = "payload-match";

    const agentCards = [agentCard("agent-1", [cap])];

    const events = [...spreadEvents(cap, 5, 1, 29)];

    // 3 proposals via target, 2 via payload
    const proposals = [
      proposalFor(cap, 5),
      proposalFor(cap, 10),
      proposalFor(cap, 15),
      proposalForPayload(cap, 20),
      proposalForPayload(cap, 25),
    ];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals,
      capabilityEvents: events,
    });

    expect(results[0].proposalCount).toBe(5);
    // resolutionCount=5 < 10 → not active, proposalCount=5 not < 5 → not emerging
    // Falls to default → stagnant
    expect(results[0].lifecycleState).toBe("stagnant");
  });

  // -----------------------------------------------------------------------
  // Edge case: multiple agents for same capability
  // -----------------------------------------------------------------------

  it("correctly counts agents across multiple cards", () => {
    const cap = "shared-cap";

    const agentCards = [
      agentCard("agent-1", [cap]),
      agentCard("agent-2", [cap, "other"]),
      agentCard("agent-3", [cap]),
      agentCard("agent-4", ["other"]),
    ];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals: [
        ...spreadProposals(cap, 6, 1, 29),
        ...spreadProposals("other", 6, 1, 29),
      ],
      capabilityEvents: [
        ...spreadEvents(cap, 12, 1, 29),
        ...spreadEvents("other", 12, 1, 29),
      ],
    });

    const capHealth = results.find((r) => r.capability === cap)!;
    const otherHealth = results.find((r) => r.capability === "other")!;

    expect(capHealth.agentCount).toBe(3);
    expect(otherHealth.agentCount).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Edge case: resolve events with resolvedAgent set (not unresolved)
  // -----------------------------------------------------------------------

  it("unresolved demand only counts events without resolvedAgent", () => {
    const cap = "resolved-check";

    const agentCards = [agentCard("agent-1", [cap])];

    // 5 resolved, 3 unresolved
    const events = [
      capEvent(cap, 5, "agent-1"),
      capEvent(cap, 5, "agent-1"),
      capEvent(cap, 5, "agent-1"),
      capEvent(cap, 5, "agent-1"),
      capEvent(cap, 5, "agent-1"),
      capEvent(cap, 5), // unresolved
      capEvent(cap, 5), // unresolved
      capEvent(cap, 5), // unresolved
    ];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals: [],
      capabilityEvents: events,
      goalEvents: [goalEvent([cap], 5)], // +1 demand from goal
    });

    // raw demand = 3 (unresolved) + 1 (goal) = 4
    // Only one capability → min=max=4 → demandScore = 0
    expect(results[0].demandScore).toBe(0);

    // But resolutionCount counts ALL events (resolved + unresolved)
    expect(results[0].resolutionCount).toBe(8);
  });

  // -----------------------------------------------------------------------
  // Edge case: capability events for capability not in agent cards
  // -----------------------------------------------------------------------

  it("does not include capabilities only present in events (not in agent cards)", () => {
    const agentCards = [agentCard("agent-1", ["registered-cap"])];

    const events = [
      capEvent("registered-cap", 5),
      capEvent("unregistered-cap", 5),
    ];

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: null,
      proposals: [],
      capabilityEvents: events,
    });

    expect(results).toHaveLength(1);
    expect(results[0].capability).toBe("registered-cap");
  });

  // -----------------------------------------------------------------------
  // Edge case: rationale string format
  // -----------------------------------------------------------------------

  it("generates human-readable rationale", () => {
    const cap = "rationale-test";

    const agentCards = [agentCard("agent-1", [cap])];

    const events = [...spreadEvents(cap, 15, 1, 29)];
    const proposals = [...spreadProposals(cap, 8, 1, 29)];

    const intel = intelReport([
      { value: cap, keepRate: 0.8, advisoryRevertRate: 0.05 },
    ]);

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: intel,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    expect(health.rationale).toBeDefined();
    expect(health.rationale).toContain("15 resolutions");
    expect(health.rationale).toContain("1 agents");
    expect(health.rationale).toContain("8 proposals");
    expect(health.rationale).toContain("keep rate 0.80");
    expect(health.rationale).toContain("revert rate 0.05");
    expect(health.rationale).toContain("resolution trend rising");
    expect(health.rationale).toContain("proposal trend rising");
    expect(health.rationale).toContain("→ active");
  });

  // -----------------------------------------------------------------------
  // Edge case: intelligence report with bucket having undefined rates
  // -----------------------------------------------------------------------

  it("handles intelligence report bucket with all rates undefined", () => {
    const cap = "undefined-rates";

    const agentCards = [agentCard("agent-1", [cap])];

    const events = [...spreadEvents(cap, 12, 1, 29)];
    const proposals = [...spreadProposals(cap, 6, 1, 29)];

    const intel = intelReport([
      { value: cap }, // no keepRate, no advisoryRevertRate, no actualRevertRate
    ]);

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: intel,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    expect(health.keepRate).toBeNull();
    expect(health.revertRate).toBeNull();
    // Without rates, falls through to active (resolution=12 >= 10, proposals=6 >= 5, trends not falling)
    expect(health.lifecycleState).toBe("active");
  });

  // -----------------------------------------------------------------------
  // Edge case: mature requires all conditions
  // -----------------------------------------------------------------------

  it("high resolution count but proposal count too low for mature → active instead", () => {
    const cap = "almost-mature";

    const agentCards = [agentCard("agent-1", [cap])];

    // 60 resolutions (meets mature threshold) but only 10 proposals (below 20)
    const events = [
      ...spreadEvents(cap, 30, 1, 28),
      ...spreadEvents(cap, 30, 31, 59),
    ];

    const proposals = [
      ...spreadProposals(cap, 5, 1, 28),
      ...spreadProposals(cap, 5, 31, 59),
    ];

    const intel = intelReport([{ value: cap, keepRate: 0.9, advisoryRevertRate: 0.02 }]);

    const results = analyzer.analyze({
      agentCards,
      intelligenceReport: intel,
      proposals,
      capabilityEvents: events,
    });

    const health = results[0];
    // resolution=60 >= 50, keepRate=0.9 >= 0.75, revertRate=0.02 < 0.1,
    // proposalCount=10 < 20 → mature check fails
    // Falls to active: resolution=60 >= 10, keepRate=0.9 >= 0.6, revertRate=0.02 < 0.15,
    // proposalCount=10 >= 5, trends stable → active
    expect(health.lifecycleState).toBe("active");
  });
});
