import { describe, it, expect } from "vitest";
import { CapabilityEvolutionProposalGenerator } from "../../src/adaptation/capability-evolution-proposal-generator.js";
import type { CapabilityEvolutionReport } from "../../src/adaptation/capability-evolution-types.js";

function makeMinimalReport(
  overrides?: Partial<CapabilityEvolutionReport>,
): CapabilityEvolutionReport {
  return {
    generatedAt: "2026-06-20T12:00:00.000Z",
    totalCapabilities: 0,
    healthAnalysis: [],
    gapAnalysis: [],
    overlapAnalysis: [],
    driftAnalysis: [],
    lifecycleDistribution: {
      emerging: 0,
      active: 0,
      mature: 0,
      stagnant: 0,
      declining: 0,
      deprecated: 0,
    },
    executiveSummary: "Test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// gap finding -> proposal
// ---------------------------------------------------------------------------

describe("CapabilityEvolutionProposalGenerator", () => {
  it("generates proposal from gap finding with signal >= 2", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      gapAnalysis: [
        {
          suggestedCapability: "ml-training",
          evidence: ["5 unresolved requests"],
          signalStrength: 2,
          confidence: "medium",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(1);
    // Assert on deterministic fields only — proposal IDs evolve over time
    expect(result.proposals[0].action).toBe("create_improvement_issue");
    expect(result.proposals[0].target).toEqual({
      kind: "issue",
      title: 'Investigate adding capability for "ml-training"',
    });
    expect(result.proposals[0].sourceConfidence).toBe(0.90);
    expect(result.proposals[0].provenance).toBe("auto");
    expect(result.proposals[0].payload.dedupeKey).toBe(
      "capability-gap:ml-training",
    );
    expect(result.proposals[0].payload.findingType).toBe("gap");
    expect(result.proposals[0].payload.sourceReportTimestamp).toBe(
      "2026-06-20T12:00:00.000Z",
    );
  });

  // -----------------------------------------------------------------------
  // gap below signal strength threshold -> skip
  // -----------------------------------------------------------------------

  it("skips gap with signalStrength below minGapSignalStrength", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      gapAnalysis: [
        {
          suggestedCapability: "weak-gap",
          evidence: ["1 unresolved request"],
          signalStrength: 1,
          confidence: "low",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  // -----------------------------------------------------------------------
  // overlap consolidationCandidate -> proposal
  // -----------------------------------------------------------------------

  it("generates proposal from overlap consolidation candidate", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      overlapAnalysis: [
        {
          capabilityA: "code-generation",
          capabilityB: "template-rendering",
          overlapScore: 0.85,
          coverageAtoB: 0.7,
          coverageBtoA: 0.6,
          asymmetry: 0.1,
          sharedSignalCount: 3,
          consolidationCandidate: true,
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(1);
    expect(result.proposals[0].action).toBe("create_improvement_issue");
    expect(result.proposals[0].provenance).toBe("auto");
    expect(result.proposals[0].sourceConfidence).toBe(0.75);
    expect(result.proposals[0].payload.findingType).toBe("overlap");
    // dedupeKey normalizes order: lexicographic sort of capability names
    expect(result.proposals[0].payload.dedupeKey).toBe(
      "capability-overlap:code-generation:template-rendering",
    );
    expect(result.proposals[0].payload.overlapScore).toBe(0.85);
    expect(result.proposals[0].payload.sourceReportTimestamp).toBe(
      "2026-06-20T12:00:00.000Z",
    );
  });

  // -----------------------------------------------------------------------
  // overlap dedupeKey is symmetric
  // -----------------------------------------------------------------------

  it("produces same dedupeKey regardless of overlap pair ordering", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const reportA = makeMinimalReport({
      overlapAnalysis: [
        {
          capabilityA: "ml",
          capabilityB: "vision",
          overlapScore: 0.8,
          coverageAtoB: 0.5,
          coverageBtoA: 0.5,
          asymmetry: 0,
          sharedSignalCount: 2,
          consolidationCandidate: true,
        },
      ],
    });
    const reportB = makeMinimalReport({
      overlapAnalysis: [
        {
          capabilityA: "vision",
          capabilityB: "ml",
          overlapScore: 0.8,
          coverageAtoB: 0.5,
          coverageBtoA: 0.5,
          asymmetry: 0,
          sharedSignalCount: 2,
          consolidationCandidate: true,
        },
      ],
    });
    const resultA = await gen.generateFromCapabilityEvolution(reportA);
    const resultB = await gen.generateFromCapabilityEvolution(reportB);
    expect(resultA.proposals[0].payload.dedupeKey).toBe(
      "capability-overlap:ml:vision",
    );
    expect(resultB.proposals[0].payload.dedupeKey).toBe(
      "capability-overlap:ml:vision",
    );
  });

  // -----------------------------------------------------------------------
  // declining capability -> proposal
  // -----------------------------------------------------------------------

  it("generates proposal from declining health analysis", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      healthAnalysis: [
        {
          capability: "code-review",
          agentCount: 2,
          resolutionCount: 20,
          resolutionCountRecent: 1,
          resolutionCountPrior: 8,
          proposalCountRecent: 0,
          proposalCountPrior: 5,
          demandScore: 0.3,
          keepRate: 0.5,
          revertRate: 0.4,
          proposalCount: 10,
          lifecycleState: "declining",
          rationale: "Drop in recent resolutions and high revert rate",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(1);
    expect(result.proposals[0].action).toBe("create_improvement_issue");
    expect(result.proposals[0].provenance).toBe("auto");
    expect(result.proposals[0].sourceConfidence).toBe(0.85);
    expect(result.proposals[0].payload.findingType).toBe("declining");
    expect(result.proposals[0].payload.dedupeKey).toBe(
      "capability-health:declining:code-review",
    );
    expect(result.proposals[0].payload.lifecycleState).toBe("declining");
    expect(result.proposals[0].payload.revertRate).toBe(0.4);
  });

  // -----------------------------------------------------------------------
  // declining below minCapabilityUsage -> skip
  // -----------------------------------------------------------------------

  it("skips declining health with resolutionCount below minCapabilityUsage", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      healthAnalysis: [
        {
          capability: "rarely-used",
          agentCount: 1,
          resolutionCount: 2,
          resolutionCountRecent: 1,
          resolutionCountPrior: 1,
          proposalCountRecent: 0,
          proposalCountPrior: 0,
          demandScore: 0.1,
          keepRate: null,
          revertRate: null,
          proposalCount: 1,
          lifecycleState: "declining",
          rationale: "Low resolution count",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  // -----------------------------------------------------------------------
  // drift splitCandidate -> proposal
  // -----------------------------------------------------------------------

  it("generates proposal from drift split candidate", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      driftAnalysis: [
        {
          capability: "code-generation",
          originalScope: "Generate code",
          currentScope: "Generate + refactor + lint code",
          driftMagnitude: 0.65,
          splitCandidate: true,
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(1);
    expect(result.proposals[0].action).toBe("create_improvement_issue");
    expect(result.proposals[0].provenance).toBe("auto");
    expect(result.proposals[0].sourceConfidence).toBe(0.80);
    expect(result.proposals[0].payload.findingType).toBe("drift");
    expect(result.proposals[0].payload.dedupeKey).toBe(
      "capability-drift:code-generation",
    );
    expect(result.proposals[0].payload.driftMagnitude).toBe(0.65);
  });

  // -----------------------------------------------------------------------
  // drift below minDriftMagnitude -> skip
  // -----------------------------------------------------------------------

  it("skips drift with driftMagnitude below minDriftMagnitude", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      driftAnalysis: [
        {
          capability: "small-drift",
          originalScope: "Task A",
          currentScope: "Task A + small B",
          driftMagnitude: 0.3,
          splitCandidate: true,
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  // -----------------------------------------------------------------------
  // deprecated capability -> proposal
  // -----------------------------------------------------------------------

  it("generates proposal from deprecated health analysis", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      healthAnalysis: [
        {
          capability: "legacy-foo",
          agentCount: 1,
          resolutionCount: 3,
          resolutionCountRecent: 0,
          resolutionCountPrior: 3,
          proposalCountRecent: 0,
          proposalCountPrior: 2,
          demandScore: 0,
          keepRate: 0.3,
          revertRate: 0.6,
          proposalCount: 5,
          lifecycleState: "deprecated",
          rationale: "No recent resolutions, high revert rate",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(1);
    expect(result.proposals[0].action).toBe("create_improvement_issue");
    expect(result.proposals[0].provenance).toBe("auto");
    expect(result.proposals[0].sourceConfidence).toBe(0.70);
    expect(result.proposals[0].payload.findingType).toBe("deprecated");
    expect(result.proposals[0].payload.dedupeKey).toBe(
      "capability-health:deprecated:legacy-foo",
    );
    expect(result.proposals[0].payload.lifecycleState).toBe("deprecated");
  });

  // -----------------------------------------------------------------------
  // stagnant capability -> proposal
  // -----------------------------------------------------------------------

  it("generates proposal from stagnant health analysis", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      healthAnalysis: [
        {
          capability: "old-parser",
          agentCount: 2,
          resolutionCount: 10,
          resolutionCountRecent: 0,
          resolutionCountPrior: 8,
          proposalCountRecent: 0,
          proposalCountPrior: 3,
          demandScore: 0.1,
          keepRate: 0.7,
          revertRate: 0.1,
          proposalCount: 8,
          lifecycleState: "stagnant",
          rationale: "No activity in recent window",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(1);
    expect(result.proposals[0].action).toBe("create_improvement_issue");
    expect(result.proposals[0].provenance).toBe("auto");
    expect(result.proposals[0].sourceConfidence).toBe(0.65);
    expect(result.proposals[0].payload.findingType).toBe("stagnant");
    expect(result.proposals[0].payload.dedupeKey).toBe(
      "capability-health:stagnant:old-parser",
    );
    expect(result.proposals[0].payload.lifecycleState).toBe("stagnant");
  });

  // -----------------------------------------------------------------------
  // deduplication by dedupeKey
  // -----------------------------------------------------------------------

  it("skips duplicate dedupeKey already pending", async () => {
    const store = {
      list: async () => [
        {
          id: "prop-2026-06-19-001",
          action: "create_improvement_issue",
          status: "pending",
          payload: { dedupeKey: "capability-gap:ml-training" },
        },
      ],
      save: async () => {},
    };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      gapAnalysis: [
        {
          suggestedCapability: "ml-training",
          evidence: ["more unresolved requests"],
          signalStrength: 3,
          confidence: "high",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  // -----------------------------------------------------------------------
  // top-N truncation
  // -----------------------------------------------------------------------

  it("caps proposals at maxProposalsPerRun", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    // 6 gaps with varying signal strength — all eligible
    const gaps = Array.from({ length: 6 }, (_, i) => ({
      suggestedCapability: `cap-${i}`,
      evidence: [`evidence ${i}`],
      signalStrength: 2 + i,
      confidence: "medium" as const,
    }));
    const report = makeMinimalReport({ gapAnalysis: gaps });
    const result = await gen.generateFromCapabilityEvolution(report, {
      maxProposalsPerRun: 3,
    });
    expect(result.generated).toBe(3);
    expect(result.skipped).toBe(3);
    expect(result.proposals).toHaveLength(3);
    // Should be highest signalStrength first (priority 0, then sort by strength desc)
    expect(result.proposals[0].payload.signalStrength).toBe(7);
    expect(result.proposals[1].payload.signalStrength).toBe(6);
    expect(result.proposals[2].payload.signalStrength).toBe(5);
  });

  // -----------------------------------------------------------------------
  // finds type-specific payload fields
  // -----------------------------------------------------------------------

  it("includes finding-specific payload fields per finding type", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      gapAnalysis: [
        {
          suggestedCapability: "nlp",
          evidence: ["gap evidence"],
          signalStrength: 3,
          confidence: "high",
        },
      ],
      healthAnalysis: [
        {
          capability: "decliner",
          agentCount: 1,
          resolutionCount: 10,
          resolutionCountRecent: 2,
          resolutionCountPrior: 8,
          proposalCountRecent: 1,
          proposalCountPrior: 4,
          demandScore: 0.2,
          keepRate: 0.4,
          revertRate: 0.5,
          proposalCount: 5,
          lifecycleState: "declining",
          rationale: "declining fast",
        },
      ],
      driftAnalysis: [
        {
          capability: "drifter",
          originalScope: "A",
          currentScope: "A + B",
          driftMagnitude: 0.7,
          splitCandidate: true,
        },
      ],
      overlapAnalysis: [
        {
          capabilityA: "overlap-a",
          capabilityB: "overlap-b",
          overlapScore: 0.75,
          coverageAtoB: 0.6,
          coverageBtoA: 0.55,
          asymmetry: 0.05,
          sharedSignalCount: 2,
          consolidationCandidate: true,
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(4);

    // gap payload fields
    const gapProp = result.proposals.find(
      (p) => p.payload.findingType === "gap",
    )!;
    expect(gapProp.payload.signalStrength).toBe(3);
    expect(gapProp.payload.confidence).toBe("high");
    expect(gapProp.payload.evidence).toEqual(["gap evidence"]);

    // decliner payload fields
    const declProp = result.proposals.find(
      (p) => p.payload.findingType === "declining",
    )!;
    expect(declProp.payload.lifecycleState).toBe("declining");
    expect(declProp.payload.revertRate).toBe(0.5);
    expect(declProp.payload.resolutionCount).toBe(10);

    // drift payload fields
    const driftProp = result.proposals.find(
      (p) => p.payload.findingType === "drift",
    )!;
    expect(driftProp.payload.driftMagnitude).toBe(0.7);
    expect(driftProp.payload.originalScope).toBe("A");
    expect(driftProp.payload.currentScope).toBe("A + B");

    // overlap payload fields
    const overlapProp = result.proposals.find(
      (p) => p.payload.findingType === "overlap",
    )!;
    expect(overlapProp.payload.overlapScore).toBe(0.75);
    expect(overlapProp.payload.capabilityA).toBe("overlap-a");
    expect(overlapProp.payload.capabilityB).toBe("overlap-b");
    expect(overlapProp.payload.coverageAtoB).toBe(0.6);
    expect(overlapProp.payload.coverageBtoA).toBe(0.55);
  });

  // -----------------------------------------------------------------------
  // evidence event recorded
  // -----------------------------------------------------------------------

  it("records evidence event for each generated proposal", async () => {
    const recorded: Array<{ id: string; payload: Record<string, unknown> }> =
      [];
    const store = { list: async () => [], save: async () => {} };
    const writer = {
      recordAdaptationProposed: async (
        id: string,
        payload: Record<string, unknown>,
      ) => {
        recorded.push({ id, payload });
        return null;
      },
    };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      gapAnalysis: [
        {
          suggestedCapability: "evt-gap",
          evidence: ["e1"],
          signalStrength: 2,
          confidence: "medium",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].id).toBe(result.proposals[0].id);
    expect(recorded[0].payload.provenance).toBe("auto");
    expect(recorded[0].payload.action).toBe("create_improvement_issue");
  });

  // -----------------------------------------------------------------------
  // evidence failure does not abort
  // -----------------------------------------------------------------------

  it("does not abort when evidence recording fails", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = {
      recordAdaptationProposed: async () => {
        throw new Error("evidence write failed");
      },
    };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    const report = makeMinimalReport({
      gapAnalysis: [
        {
          suggestedCapability: "resilient-gap",
          evidence: ["e1"],
          signalStrength: 2,
          confidence: "medium",
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    // Proposal should still be generated even if evidence write fails
    expect(result.generated).toBe(1);
    expect(result.proposals).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // priority ordering
  // -----------------------------------------------------------------------

  it("sorts candidates by priority then sortKey descending", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(
      store as any,
      writer as any,
    );
    // Input findings in deliberately shuffled order to stress-test the sort
    // comparator (stable sort would make ascending input order match expected
    // output even if the comparator were broken).
    const report = makeMinimalReport({
      // Stagnant (priority 5, lowest) — placed first in input
      healthAnalysis: [
        {
          capability: "stagnant-cap",
          agentCount: 2,
          resolutionCount: 10,
          resolutionCountRecent: 0,
          resolutionCountPrior: 8,
          proposalCountRecent: 0,
          proposalCountPrior: 3,
          demandScore: 0.1,
          keepRate: 0.7,
          revertRate: 0.1,
          proposalCount: 8,
          lifecycleState: "stagnant",
          rationale: "r",
        },
        // Deprecated (priority 4)
        {
          capability: "deprecated-cap",
          agentCount: 1,
          resolutionCount: 3,
          resolutionCountRecent: 0,
          resolutionCountPrior: 3,
          proposalCountRecent: 0,
          proposalCountPrior: 2,
          demandScore: 0,
          keepRate: 0.3,
          revertRate: 0.6,
          proposalCount: 5,
          lifecycleState: "deprecated",
          rationale: "r",
        },
        // Declining (priority 1, second-highest)
        {
          capability: "decliner",
          agentCount: 1,
          resolutionCount: 10,
          resolutionCountRecent: 2,
          resolutionCountPrior: 8,
          proposalCountRecent: 1,
          proposalCountPrior: 4,
          demandScore: 0.2,
          keepRate: 0.4,
          revertRate: 0.5,
          proposalCount: 5,
          lifecycleState: "declining",
          rationale: "r",
        },
      ],
      // Gap (priority 0, highest) — placed in the middle of input
      gapAnalysis: [
        {
          suggestedCapability: "gap-1",
          evidence: ["e"],
          signalStrength: 2,
          confidence: "low",
        },
      ],
      // Drift (priority 2)
      driftAnalysis: [
        {
          capability: "drifter",
          originalScope: "A",
          currentScope: "B",
          driftMagnitude: 0.7,
          splitCandidate: true,
        },
      ],
      // Overlap (priority 3) — placed last in input
      overlapAnalysis: [
        {
          capabilityA: "a1",
          capabilityB: "a2",
          overlapScore: 0.8,
          coverageAtoB: 0.5,
          coverageBtoA: 0.5,
          asymmetry: 0,
          sharedSignalCount: 2,
          consolidationCandidate: true,
        },
      ],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    // Expected order by priority tier: gap(0) > declining(1) > drift(2) > overlap(3) > deprecated(4) > stagnant(5)
    expect(result.proposals[0].payload.findingType).toBe("gap");
    expect(result.proposals[1].payload.findingType).toBe("declining");
    expect(result.proposals[2].payload.findingType).toBe("drift");
    expect(result.proposals[3].payload.findingType).toBe("overlap");
    expect(result.proposals[4].payload.findingType).toBe("deprecated");
    expect(result.proposals[5].payload.findingType).toBe("stagnant");
  });
});
