/**
 * P5.5.4 — CapabilityOverlapAnalyzer tests.
 *
 * Covers all 7 behavioral requirements:
 *   (a) Two capabilities on all the same agents → high overlap.
 *   (b) Two capabilities on completely different agents → no overlap (below threshold).
 *   (c) Asymmetric: A always with B, but B often without A → directionality correct.
 *   (d) Proposal overlap contributes to score.
 *   (e) Empty agent cards → empty result.
 *   (f) Single capability → empty result (no pairs).
 *   (g) minOverlapScore filtering.
 */

import { describe, it, expect } from "vitest";
import { CapabilityOverlapAnalyzer } from "../../src/adaptation/capability-overlap-analyzer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a simple agent card. */
function agentCard(
  id: string,
  capabilities: string[],
): { id: string; capabilities: string[] } {
  return { id, capabilities };
}

/** Create a capability event. */
function capEvent(capability: string): {
  payload: { capability: string };
} {
  return { payload: { capability } };
}

/** Create a proposal targeting a capability via target. */
function proposalFor(
  capability: string,
): {
  target: { kind: string; capability: string };
  payload?: Record<string, unknown>;
} {
  return { target: { kind: "capability", capability } };
}

/** Create a proposal referencing a capability via payload. */
function proposalForPayload(
  capability: string,
): {
  target: { kind: string };
  payload: { capability: string };
} {
  return { target: { kind: "agent_card" }, payload: { capability } };
}

/** Create a proposal referencing two capabilities (one via target, one via payload). */
function proposalWithBoth(
  targetCap: string,
  payloadCap: string,
): {
  target: { kind: string; capability: string };
  payload: { capability: string };
} {
  return {
    target: { kind: "capability", capability: targetCap },
    payload: { capability: payloadCap },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CapabilityOverlapAnalyzer", () => {
  const analyzer = new CapabilityOverlapAnalyzer();

  // -----------------------------------------------------------------------
  // (a) Two capabilities on all the same agents → high overlap
  // -----------------------------------------------------------------------

  it("(a) same agents for both capabilities → high overlap score", () => {
    const capA = "code-gen";
    const capB = "code-review";

    const agentCards = [
      agentCard("agent-1", [capA, capB]),
      agentCard("agent-2", [capA, capB]),
      agentCard("agent-3", [capA, capB]),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals: [],
    });

    expect(results).toHaveLength(1);

    const overlap = results[0];
    expect(overlap.capabilityA).toBe(capA);
    expect(overlap.capabilityB).toBe(capB);

    // agentsWithBoth = 3, agentsWithAtLeastOne = 3 → 1.0
    expect(overlap.overlapScore).toBeCloseTo(0.4); // 0.4 * 1.0 only
    expect(overlap.coverageAtoB).toBeCloseTo(1.0);
    expect(overlap.coverageBtoA).toBeCloseTo(1.0);
    expect(overlap.asymmetry).toBeCloseTo(0);
    expect(overlap.sharedSignalCount).toBe(1); // only agent signal
    expect(overlap.consolidationCandidate).toBe(false); // 0.4 ≤ 0.7
  });

  // -----------------------------------------------------------------------
  // (b) Two capabilities on completely different agents → no overlap
  // -----------------------------------------------------------------------

  it("(b) disjoint agent sets → overlap below threshold, excluded", () => {
    const capA = "code-gen";
    const capB = "code-review";

    const agentCards = [
      agentCard("agent-1", [capA]),
      agentCard("agent-2", [capB]),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals: [],
    });

    // overlapScore = 0 → below default minOverlapScore of 0.3
    expect(results).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // (c) Asymmetric: A always with B, but B often without A
  // -----------------------------------------------------------------------

  it("(c) asymmetric coverage → directionality correct", () => {
    const capA = "code-gen"; // always paired with code-review
    const capB = "code-review"; // appears alone as well

    // 3 agents have both, 1 agent has B only. So A=3, B=4.
    const agentCards = [
      agentCard("agent-1", [capA, capB]),
      agentCard("agent-2", [capA, capB]),
      agentCard("agent-3", [capA, capB]),
      agentCard("agent-4", [capB]),
    ];

    // Add events to push the score above the default threshold
    const events = [
      ...Array.from({ length: 10 }, () => capEvent(capA)),
      ...Array.from({ length: 10 }, () => capEvent(capB)),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals: [],
      capabilityEvents: events,
    });

    expect(results).toHaveLength(1);

    const overlap = results[0];

    // agentsWithBoth=3, agentsWithAtLeastOne=4 → sharedAgentProportion = 0.75
    // sharedResolutionPattern = min(10,10)*0.2/20 = 0.1
    // overlapScore = 0.4*0.75 + 0.3*0 + 0.3*0.1 = 0.30 + 0.03 = 0.33
    expect(overlap.overlapScore).toBeCloseTo(0.33);

    // coverageAtoB = 3/3 = 1.0 (every agent with A also has B)
    expect(overlap.coverageAtoB).toBeCloseTo(1.0);

    // coverageBtoA = 3/4 = 0.75 (only 3 of 4 agents with B also have A)
    expect(overlap.coverageBtoA).toBeCloseTo(0.75);

    // asymmetry = 1.0 - 0.75 = 0.25 (> 0 → A depends on B more)
    expect(overlap.asymmetry).toBeCloseTo(0.25);
  });

  // -----------------------------------------------------------------------
  // (d) Proposal overlap contributes to score
  // -----------------------------------------------------------------------

  it("(d) proposals referencing both capabilities → score includes proposal signal", () => {
    const capA = "code-gen";
    const capB = "code-review";

    // Agents are disjoint (no agent overlap signal)
    const agentCards = [
      agentCard("agent-1", [capA]),
      agentCard("agent-2", [capB]),
    ];

    // One proposal references both capabilities: target=capA, payload=capB
    const proposals = [proposalWithBoth(capA, capB)];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals,
    });

    expect(results).toHaveLength(1);

    const overlap = results[0];

    // proposalsWithBoth=1, proposalsWithAtLeastOne=1 → sharedProposalProportion = 1.0
    // overlapScore = 0.4*0 + 0.3*1.0 + 0.3*0 = 0.3
    expect(overlap.overlapScore).toBeCloseTo(0.3);

    // No agent overlap → directional coverage is 0
    expect(overlap.coverageAtoB).toBeCloseTo(0);
    expect(overlap.coverageBtoA).toBeCloseTo(0);

    // Only proposal signal
    expect(overlap.sharedSignalCount).toBe(1);
  });

  it("(d2) proposal matched via payload.capability alone", () => {
    const capA = "code-gen";
    const capB = "code-review";

    const agentCards = [
      agentCard("agent-1", [capA, capB]),
      agentCard("agent-2", [capA, capB]),
    ];

    // Proposals reference caps via payload only
    const proposals = [
      proposalForPayload(capA),
      proposalForPayload(capB),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals,
    });

    expect(results).toHaveLength(1);

    // proposalsWithAtLeastOne=2, proposalsWithBoth=0 (separate proposals)
    // sharedAgentProportion = 1.0, sharedProposalProportion = 0
    // overlapScore = 0.4
    expect(results[0].overlapScore).toBeCloseTo(0.4);
  });

  // -----------------------------------------------------------------------
  // (e) Empty agent cards → empty result
  // -----------------------------------------------------------------------

  it("(e) empty agent cards → empty result", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-gen", "code-review"],
      agentCards: [],
      proposals: [],
    });

    expect(results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // (f) Single capability → empty result (no pairs)
  // -----------------------------------------------------------------------

  it("(f) single capability → empty result", () => {
    const results = analyzer.analyze({
      registeredCapabilities: ["code-gen"],
      agentCards: [agentCard("agent-1", ["code-gen"])],
      proposals: [],
    });

    expect(results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // (g) minOverlapScore filtering
  // -----------------------------------------------------------------------

  it("(g) custom minOverlapScore filters out lower-scoring pairs", () => {
    const capA = "code-gen";
    const capB = "code-review";

    // Both on all agents → overlapScore = 0.4
    const agentCards = [
      agentCard("agent-1", [capA, capB]),
      agentCard("agent-2", [capA, capB]),
    ];

    // Default min (0.3): pair included
    const resultsDefault = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals: [],
    });
    expect(resultsDefault).toHaveLength(1);

    // Higher min (0.5): pair excluded because 0.4 < 0.5
    const resultsFiltered = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals: [],
      minOverlapScore: 0.5,
    });
    expect(resultsFiltered).toHaveLength(0);
  });

  it("(g2) minOverlapScore of zero includes all pairs", () => {
    const capA = "code-gen";
    const capB = "code-review";
    const capC = "testing";

    const agentCards = [
      agentCard("agent-1", [capA]),
      agentCard("agent-2", [capB]),
      agentCard("agent-3", [capC]),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB, capC],
      agentCards,
      proposals: [],
      minOverlapScore: 0,
    });

    // All 3 pairs included (even with score 0)
    expect(results).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // Edge case: consolidationCandidate when score > 0.7
  // -----------------------------------------------------------------------

  it("identifies consolidation candidates when overlapScore > 0.7", () => {
    const capA = "code-gen";
    const capB = "code-review";

    // All agents have both → sharedAgentProportion = 1.0
    const agentCards = [
      agentCard("agent-1", [capA, capB]),
      agentCard("agent-2", [capA, capB]),
    ];

    // Proposals all reference both capabilities
    const proposals = [
      proposalWithBoth(capA, capB),
      proposalWithBoth(capA, capB),
      proposalWithBoth(capA, capB),
    ];

    // Events for both
    const events = [
      ...Array.from({ length: 10 }, () => capEvent(capA)),
      ...Array.from({ length: 10 }, () => capEvent(capB)),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals,
      capabilityEvents: events,
    });

    expect(results).toHaveLength(1);

    const overlap = results[0];

    // sharedAgentProportion = 1.0
    // sharedProposalProportion = 3/3 = 1.0
    // sharedResolutionPattern = min(10,10)*0.2/20 = 0.1
    // overlapScore = 0.4 + 0.3 + 0.03 = 0.73
    expect(overlap.overlapScore).toBeCloseTo(0.73, 1);
    expect(overlap.consolidationCandidate).toBe(true);
    expect(overlap.sharedSignalCount).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Edge case: resolution pattern only signal
  // -----------------------------------------------------------------------

  it("capability events contribute to score even without agent/proposal overlap", () => {
    const capA = "code-gen";
    const capB = "code-review";

    // Single agent has only capA, but events exist for both
    const agentCards = [agentCard("agent-1", [capA])];

    const events = [
      ...Array.from({ length: 20 }, () => capEvent(capA)),
      ...Array.from({ length: 20 }, () => capEvent(capB)),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals: [],
      capabilityEvents: events,
    });

    // sharedAgentProportion = 0/1 = 0 (no agent has both)
    // sharedProposalProportion = 0
    // sharedResolutionPattern = min(20,20)*0.2/40 = 0.1
    // overlapScore = 0.4*0 + 0.3*0 + 0.3*0.1 = 0.03
    // 0.03 < 0.3 → excluded
    expect(results).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Edge case: empty capabilities list
  // -----------------------------------------------------------------------

  it("empty registeredCapabilities → empty result", () => {
    const results = analyzer.analyze({
      registeredCapabilities: [],
      agentCards: [agentCard("agent-1", ["code-gen"])],
      proposals: [],
    });

    expect(results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Edge case: proposals with non-capability target.kind are ignored
  // -----------------------------------------------------------------------

  it("ignores proposals with target.kind !== 'capability'", () => {
    const capA = "code-gen";
    const capB = "code-review";

    const agentCards = [
      agentCard("agent-1", [capA, capB]),
    ];

    // Proposal with target.kind="agent_card" but payload.capability matches
    const proposals = [
      { target: { kind: "agent_card" }, payload: { capability: capA } },
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB],
      agentCards,
      proposals,
    });

    expect(results).toHaveLength(1);
    // Only agent overlap contributes (payload cap is still counted)
    // sharedAgentProportion = 1.0, sharedProposalProportion = 0 (only A, not both)
    expect(results[0].overlapScore).toBeCloseTo(0.4);
  });

  // -----------------------------------------------------------------------
  // Edge case: three capabilities → all pairs analyzed
  // -----------------------------------------------------------------------

  it("analyzes all unordered pairs for 3+ capabilities", () => {
    const capA = "code-gen";
    const capB = "code-review";
    const capC = "testing";

    // A+B on agent-1, B+C on agent-2, A alone on agent-3
    const agentCards = [
      agentCard("agent-1", [capA, capB]),
      agentCard("agent-2", [capB, capC]),
      agentCard("agent-3", [capA]),
    ];

    // A-B: agentsWithBoth=1, agentsWithAtLeastOne=3 → 0.333, overlap=0.133
    // B-C: agentsWithBoth=1, agentsWithAtLeastOne=2 → 0.500, overlap=0.200
    // A-C: agentsWithBoth=0 → 0, overlap=0
    // Only B-C is above threshold? No: 0.133 < 0.3, 0.200 < 0.3, 0 < 0.3
    // None above threshold with default min.

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB, capC],
      agentCards,
      proposals: [],
    });

    expect(results).toHaveLength(0);
  });
});
