// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * P5.5/P5.6 Pair Layer (ruling #543) — composition-root bridge tests.
 *
 * Asserts the locked architectural boundary:
 *   - The pair layer is a read-only bridge from P5.5 pair evidence to A7
 *     signal construction.
 *   - It MUST NOT derive survivor identity, absorbed identity, merge
 *     direction, or consolidation mutation.
 *   - It MUST NOT introduce a heuristic decision field (asymmetry,
 *     coverageAsDecision, etc.) on the emitted signal.
 *   - The pair recommendation is EVIDENCE for proposal construction,
 *     not an authorization to consolidate.
 *
 * Required axes:
 *   1. Empty inputs → empty signals.
 *   2. Single overlap pair (consolidationCandidate=true) → emits one
 *      signal with identitySupplier values.
 *   3. identitySupplier returns null → overlap is skipped.
 *   4. identitySupplier carries survivorCapabilityId + absorbedCapabilityIds
 *      verbatim into signal (no transformation).
 *   5. Multiple overlapping pairs → multiple signals emitted.
 *   6. CRITICAL SENTINEL: emitted signal MUST NOT contain `asymmetry`
 *      as a survivorship decision field; it carries pair evidence
 *      only (`score`, `evidenceIds`).
 *   7. CRITICAL SENTINEL: signalToCandidate round-trip preserves
 *      caller-supplied survivorCapabilityId + absorbedCapabilityIds
 *      unchanged.
 *   8. CRITICAL SENTINEL: validator rejects `absorbedCapabilityIds: []`.
 *
 * @module tests/capability/evolution/p5-pair-layer
 */

import { describe, it, expect } from "vitest";
import { CapabilityOverlapAnalyzer } from "../../../src/adaptation/capability-overlap-analyzer.js";
import type { CapabilityOverlap } from "../../../src/adaptation/capability-evolution-types.js";
import {
  A7ProposalGenerator,
  validateConsolidationOpportunitySignal,
  type CapabilityEvolutionSignal,
  type ProposalSignalSource,
} from "../../../src/capability/evolution/a7-proposals.js";
import { ProposalSignalChannel } from "../../../src/capability/evolution/proposal-signal-channel.js";
import {
  CompositeProposalSignalSource,
  OverlapProposalSignalSource,
  type OverlapIdentitySupplier,
  type OverlapProposalSignalSourceInputs,
} from "../../../src/capability/evolution/overlap-signal-source.js";

// ---------------------------------------------------------------------------
// Helpers (mirror tests/adaptation/capability-overlap-analyzer.vitest.ts)
// ---------------------------------------------------------------------------

interface AgentCard { id: string; capabilities: string[] }
interface Proposal {
  target: { kind: string; capability?: string };
  payload?: { capability?: string };
}
interface CapEvent { payload: { capability: string } }

function agentCard(id: string, caps: string[]): AgentCard {
  return { id, capabilities: caps };
}

function proposalFor(cap: string): Proposal {
  return { target: { kind: "capability", capability: cap } };
}

/**
 * Build a proposal that references BOTH `capA` and `capB` — one via
 * `target.capability`, one via `payload.capability`. The analyzer
 * builds a per-proposal capability set from both fields, so the
 * proposal counts as "having both" capabilities.
 */
function proposalWithBoth(capA: string, capB: string): Proposal {
  return {
    target: { kind: "capability", capability: capA },
    payload: { capability: capB },
  };
}

function capEvent(cap: string): CapEvent {
  return { payload: { capability: cap } };
}

/**
 * Build canonical inputs that produce a known `consolidationCandidate`
 * overlap between `capA` and `capB`. Two agents, both referencing both
 * capabilities, plus three proposals each linking both, plus balanced events.
 *
 * overlapScore = 0.4*1.0 + 0.3*1.0 + 0.3*0.1 = 0.73 (>0.7 → candidate).
 */
function buildCandidateInputs(
  capA: string,
  capB: string,
): OverlapProposalSignalSourceInputs {
  return {
    agentCards: [
      agentCard("agent-1", [capA, capB]),
      agentCard("agent-2", [capA, capB]),
    ],
    proposals: [
      proposalWithBoth(capA, capB),
      proposalWithBoth(capA, capB),
      proposalWithBoth(capA, capB),
    ],
    capabilityEvents: [
      ...Array.from({ length: 10 }, () => capEvent(capA)),
      ...Array.from({ length: 10 }, () => capEvent(capB)),
    ],
    registeredCapabilities: [capA, capB],
  };
}

/**
 * Identity supplier that promotes `capA` to survivor and `capB` to absorbed.
 * Verbatim — no transformation.
 */
function supplierIdentityAtoB(
  overlap: CapabilityOverlap,
): { survivorCapabilityId: string; absorbedCapabilityIds: readonly string[] } | null {
  // Mirror the locked #540 ruling: caller decides direction. Here, the
  // decision rule is "A survives, B is absorbed" — but this is a TEST
  // stub, not a production heuristic. The pair layer itself does not
  // encode any preference.
  return {
    survivorCapabilityId: overlap.capabilityA,
    absorbedCapabilityIds: [overlap.capabilityB],
  };
}

// ---------------------------------------------------------------------------
// Axis 1: Empty inputs → empty signals
// ---------------------------------------------------------------------------

describe("OverlapProposalSignalSource — pair layer (ruling #543)", () => {
  it("axis 1: empty inputs → empty signals", async () => {
    const source = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => ({
        agentCards: [],
        proposals: [],
        capabilityEvents: [],
        registeredCapabilities: [],
      }),
      identitySupplier: supplierIdentityAtoB,
    });
    const signals = await source.signals();
    expect(signals).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Axis 2: Single overlap pair → emits one signal with identitySupplier values
  // -----------------------------------------------------------------------

  it("axis 2: single overlap pair with consolidationCandidate=true → emits one signal carrying identitySupplier values", async () => {
    const source = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => buildCandidateInputs("cap.A", "cap.B"),
      identitySupplier: supplierIdentityAtoB,
    });
    const signals = await source.signals();
    expect(signals).toHaveLength(1);
    const sig = signals[0];
    expect(sig.kind).toBe("consolidation_opportunity");
    if (sig.kind !== "consolidation_opportunity") return;
    expect(sig.survivorCapabilityId).toBe("cap.A");
    expect(sig.absorbedCapabilityIds).toEqual(["cap.B"]);
  });

  // -----------------------------------------------------------------------
  // Axis 3: identitySupplier returns null → overlap is skipped
  // -----------------------------------------------------------------------

  it("axis 3: identitySupplier returns null → overlap is skipped (no signal emitted)", async () => {
    const source = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => buildCandidateInputs("cap.X", "cap.Y"),
      identitySupplier: () => null,
    });
    const signals = await source.signals();
    expect(signals).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Axis 4: identitySupplier carries survivor+absorbed verbatim into signal
  // -----------------------------------------------------------------------

  it("axis 4: identitySupplier carries survivorCapabilityId + absorbedCapabilityIds verbatim into signal (no transformation)", async () => {
    const SUPPLIED_ABSORBED = [
      "cap.t1@1.0.0",
      "cap.t2@2.3.4",
      "cap.t3@0.9.0",
    ];
    const supplier: OverlapIdentitySupplier = (overlap) => ({
      survivorCapabilityId: `survivor-of-${overlap.capabilityA}`,
      absorbedCapabilityIds: SUPPLIED_ABSORBED,
    });
    const source = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => buildCandidateInputs("cap.A", "cap.B"),
      identitySupplier: supplier,
    });
    const signals = await source.signals();
    expect(signals).toHaveLength(1);
    const sig = signals[0];
    if (sig.kind !== "consolidation_opportunity") {
      throw new Error("expected consolidation_opportunity");
    }
    expect(sig.survivorCapabilityId).toBe("survivor-of-cap.A");
    expect(sig.absorbedCapabilityIds).toEqual(SUPPLIED_ABSORBED);
    // Verbatim — the layer did NOT add to, remove from, or reorder absorbed set.
    expect(sig.absorbedCapabilityIds).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // Axis 5: Multiple overlapping pairs → multiple signals emitted
  // -----------------------------------------------------------------------

  it("axis 5: multiple overlapping pairs → multiple signals emitted", async () => {
    // Two ISOLATED pairs: (A,B) and (C,D). Each pair has its own agent
    // group and its own proposal group, so the analyzer scores each pair
    // above the 0.7 threshold WITHOUT cross-contamination.
    const inputs: OverlapProposalSignalSourceInputs = {
      agentCards: [
        agentCard("agent-1", ["cap.A", "cap.B"]),
        agentCard("agent-2", ["cap.A", "cap.B"]),
        agentCard("agent-3", ["cap.C", "cap.D"]),
        agentCard("agent-4", ["cap.C", "cap.D"]),
      ],
      proposals: [
        proposalWithBoth("cap.A", "cap.B"),
        proposalWithBoth("cap.A", "cap.B"),
        proposalWithBoth("cap.A", "cap.B"),
        proposalWithBoth("cap.C", "cap.D"),
        proposalWithBoth("cap.C", "cap.D"),
        proposalWithBoth("cap.C", "cap.D"),
      ],
      capabilityEvents: [
        ...Array.from({ length: 10 }, () => capEvent("cap.A")),
        ...Array.from({ length: 10 }, () => capEvent("cap.B")),
        ...Array.from({ length: 10 }, () => capEvent("cap.C")),
        ...Array.from({ length: 10 }, () => capEvent("cap.D")),
      ],
      registeredCapabilities: ["cap.A", "cap.B", "cap.C", "cap.D"],
    };
    const seenPairs = new Set<string>();
    const supplier: OverlapIdentitySupplier = (overlap) => {
      const key = `${overlap.capabilityA}::${overlap.capabilityB}`;
      seenPairs.add(key);
      return {
        survivorCapabilityId: overlap.capabilityA,
        absorbedCapabilityIds: [overlap.capabilityB],
      };
    };
    const source = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => inputs,
      identitySupplier: supplier,
    });
    const signals = await source.signals();
    // 4 capabilities → 6 unordered pairs. Only 2 of those score > 0.7.
    expect(signals).toHaveLength(2);
    expect(seenPairs.size).toBe(2);
    for (const sig of signals) {
      if (sig.kind !== "consolidation_opportunity") {
        throw new Error("expected consolidation_opportunity");
      }
      expect(sig.absorbedCapabilityIds).toHaveLength(1);
    }
  });

  // -----------------------------------------------------------------------
  // Axis 6: CRITICAL SENTINEL — signal MUST NOT carry asymmetry as a
  //         survivorship decision field. Pair evidence only.
  // -----------------------------------------------------------------------

  it("axis 6: SENTINEL — emitted signal carries pair evidence (score, evidenceIds) but NOT any heuristic decision field", async () => {
    const source = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => buildCandidateInputs("cap.A", "cap.B"),
      identitySupplier: supplierIdentityAtoB,
    });
    const [sig] = await source.signals();
    if (!sig) throw new Error("expected one signal");
    expect(sig.kind).toBe("consolidation_opportunity");

    // Top-level keys are exactly the locked A7 signal contract.
    const topLevelKeys = Object.keys(sig).sort();
    expect(topLevelKeys).toEqual([
      "absorbedCapabilityIds",
      "evidenceIds",
      "kind",
      "score",
      "survivorCapabilityId",
    ]);

    // No "asymmetry" — it's a pair-evidence primitive, not a survivorship
    // decision field; the layer MUST NOT project it into the signal body.
    expect(topLevelKeys).not.toContain("asymmetry");
    expect(topLevelKeys).not.toContain("coverageAtoB");
    expect(topLevelKeys).not.toContain("coverageBtoA");
    expect(topLevelKeys).not.toContain("mergeDirection");
    expect(topLevelKeys).not.toContain("consolidationDecision");

    // score is the analyzer's overlapScore (pair evidence, not a decision).
    if (sig.kind !== "consolidation_opportunity") return;
    expect(sig.score).toBeGreaterThan(0.7);
    expect(sig.score).toBeLessThanOrEqual(1.0);

    // evidenceIds carries pair provenance strings.
    expect(Array.isArray(sig.evidenceIds)).toBe(true);
    expect(sig.evidenceIds.length).toBeGreaterThan(0);
    const evidenceBlob = sig.evidenceIds.join("|");
    expect(evidenceBlob).toContain("cap.A");
    expect(evidenceBlob).toContain("cap.B");
  });

  // -----------------------------------------------------------------------
  // Axis 7: CRITICAL SENTINEL — signalToCandidate round-trip preserves
  //         operator-supplied survivor + absorbed unchanged.
  // -----------------------------------------------------------------------

  it("axis 7: SENTINEL — A7's signalToCandidate preserves operator-supplied survivorCapabilityId + absorbedCapabilityIds unchanged", async () => {
    const SUPPLIED_ABSORBED = ["cap.absorbed1@1.0.0", "cap.absorbed2@2.0.0"];
    const SUPPLIED_SURVIVOR = "cap.survivor@3.0.0";

    const overlapSource = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => buildCandidateInputs("cap.A", "cap.B"),
      identitySupplier: () => ({
        survivorCapabilityId: SUPPLIED_SURVIVOR,
        absorbedCapabilityIds: SUPPLIED_ABSORBED,
      }),
    });

    // Wrap into a one-shot ProposalSignalSource that A7 reads from.
    const a7Source: ProposalSignalSource = {
      signals: async () => overlapSource.signals(),
    };

    const gen = new A7ProposalGenerator({ signalSource: a7Source });
    const candidates = await gen.generate();
    expect(candidates).toHaveLength(1);
    const [c] = candidates;
    expect(c.sourcePatternId).toBe("consolidation_opportunity");
    expect(c.target.kind).toBe("capability");
    expect(c.target.id).toBe(SUPPLIED_SURVIVOR);

    // Verbatim — A7 must NOT reorder, prune, or expand the absorbed set.
    expect(c.absorbedCapabilityIds).toEqual(SUPPLIED_ABSORBED);
    expect(c.absorbedCapabilityIds).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Axis 8: CRITICAL SENTINEL — validator rejects empty absorbed set
  // -----------------------------------------------------------------------

  it("axis 8: SENTINEL — validator rejects consolidation_opportunity with empty absorbedCapabilityIds", async () => {
    const source = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => buildCandidateInputs("cap.A", "cap.B"),
      // Caller-bug: returns empty absorbed set. The pair layer is the
      // pipeline that emits this signal; downstream A7 must reject it
      // before any candidate construction.
      identitySupplier: () => ({
        survivorCapabilityId: "cap.A",
        absorbedCapabilityIds: [],
      }),
    });
    const [sig] = await source.signals();
    if (!sig) throw new Error("expected one signal");
    expect(sig.kind).toBe("consolidation_opportunity");

    // The validator (locked ruling #534) is the gate.
    let thrown: Error | null = null;
    try {
      validateConsolidationOpportunitySignal(sig);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("absorbedCapabilityIds must be a non-empty array");
  });
});

// ---------------------------------------------------------------------------
// CompositeProposalSignalSource — composition-root helper
// ---------------------------------------------------------------------------

describe("CompositeProposalSignalSource — composition-root helper", () => {
  class StaticSource implements ProposalSignalSource {
    constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
    async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
      return this.items;
    }
  }

  it("concatenates signals from multiple sources (order preserved by emission)", async () => {
    const a = new StaticSource([
      { kind: "gap", score: 0.5, evidenceIds: ["a1"] },
    ]);
    const b = new StaticSource([
      { kind: "deprecation_signal", capabilityId: "cap.legacy", score: 0.7, evidenceIds: ["b1"] },
    ]);
    const composite = new CompositeProposalSignalSource([a, b]);
    const signals = await composite.signals();
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.kind)).toEqual(["gap", "deprecation_signal"]);
  });

  it("empty source list → empty signals", async () => {
    const composite = new CompositeProposalSignalSource([]);
    expect(await composite.signals()).toEqual([]);
  });

  it("works with ProposalSignalChannel (A5 channel) + OverlapProposalSignalSource (pair layer)", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish({
      kind: "gap",
      score: 0.6,
      evidenceIds: ["a5-publish"],
    });
    const overlapSource = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => buildCandidateInputs("cap.A", "cap.B"),
      identitySupplier: supplierIdentityAtoB,
    });
    const composite = new CompositeProposalSignalSource([channel, overlapSource]);
    const signals = await composite.signals();
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.kind).sort()).toEqual([
      "consolidation_opportunity",
      "gap",
    ]);
  });

  it("channel.publish + overlapSource round-trip through A7 yields both candidates", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish({
      kind: "underperformer",
      capabilityId: "cap.slow",
      score: 0.5,
      evidenceIds: ["slow-ev"],
    });
    const overlapSource = new OverlapProposalSignalSource({
      analyzer: new CapabilityOverlapAnalyzer(),
      inputs: async () => buildCandidateInputs("cap.A", "cap.B"),
      identitySupplier: supplierIdentityAtoB,
    });
    const composite = new CompositeProposalSignalSource([channel, overlapSource]);
    const gen = new A7ProposalGenerator({ signalSource: composite });
    const candidates = await gen.generate();
    expect(candidates).toHaveLength(2);
    const sourcePatterns = candidates.map((c) => c.sourcePatternId).sort();
    expect(sourcePatterns).toEqual(["consolidation_opportunity", "underperformer"]);
  });
});
