import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AutomaticProposalGenerator,
  DEFAULT_MIN_REFLECTION_CONFIDENCE,
  type GenerateOptions,
  type GenerateResult,
} from "../../src/adaptation/auto-proposal-generator.js";
import type { ProposalStore } from "../../src/adaptation/proposal-store.js";
import type { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { ReflectionReport } from "../../src/reflection/reflection-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";
import { RecommendationToProposal } from "../../src/adaptation/recommendation-to-proposal.js";

/**
 * Architectural-boundary sentinel test.
 *
 * The generator is the proposal-creation layer. It MUST NOT cross the
 * governance boundary: it must never import ApprovalGate, AgentCardApplier,
 * SkillApplier, or any other applier. If a future change does so, this test
 * fails immediately so we never silently couple proposal creation to
 * approval or application.
 *
 * We read the file as text and assert no import statement contains the
 * forbidden substrings. This is intentionally a string check (not a runtime
 * import) so the test cannot be silenced by renaming a module path.
 */
describe("AutomaticProposalGenerator — architectural boundary", () => {
  const generatorPath = join(
    process.cwd(),
    "src/adaptation/auto-proposal-generator.ts",
  );

  function readImports(): string {
    return readFileSync(generatorPath, "utf-8");
  }

  it("the generator source file exists", () => {
    expect(existsSync(generatorPath)).toBe(true);
  });

  it("does not import approval-gate", () => {
    const src = readImports();
    // Match any import statement whose source contains "approval-gate".
    // We allow the file path to be referenced in comments / JSDoc, but not
    // imported. Regex covers: import ... from "...approval-gate...";
    const importLine = /^\s*import[\s\S]*?from\s+["'][^"']*approval-gate[^"']*["'];?/m;
    expect(src).not.toMatch(importLine);
  });

  it("does not import any applier (agent-card, skill, or appliers/ path)", () => {
    const src = readImports();
    const applierImport = /^\s*import[\s\S]*?from\s+["'][^"']*(appliers\/|AgentCardApplier|SkillApplier)[^"']*["'];?/m;
    expect(src).not.toMatch(applierImport);
  });

  it("does not reference ApprovalGate by class name in any import", () => {
    const src = readImports();
    // Match any import statement that mentions "ApprovalGate" anywhere —
    // either as a named import, a default import, or as part of an aliased
    // import (e.g. `import { ApprovalGate as Gate } from "./approval.js"`).
    // The previous version only scanned the source path, which an aliased
    // import path could bypass. This version scans the whole clause so the
    // class name is detected regardless of how the module is renamed.
    const approvalGateClass =
      /(^\s*import\b[\s\S]*?ApprovalGate[\s\S]*?from\s+["'][^"']*["'];?)/m;
    expect(src).not.toMatch(approvalGateClass);
  });
});

// ---------------------------------------------------------------------------
// Construction & surface
// ---------------------------------------------------------------------------

function makeReflectionReport(
  overrides: Partial<ReflectionReport> = {},
): ReflectionReport {
  return {
    generatedAt: "2026-06-19T00:00:00.000Z",
    observations: [],
    recommendations: [],
    metrics: {
      workflowsCompleted: 0,
      workflowsBlocked: 0,
      workflowsAborted: 0,
      capabilitiesRequested: 0,
      unresolvedCapabilities: 0,
      reviewApprovalRate: 0,
    },
    summary: { totalObservations: 0, totalRecommendations: 0, highSeverityCount: 0 },
    ...overrides,
  };
}

function makeEffectivenessReport(
  overrides: Partial<ProposalEffectivenessReport> = {},
): ProposalEffectivenessReport {
  return {
    proposalId: "prop-test-1",
    proposalCreatedAt: "2026-06-18T00:00:00.000Z",
    windowDays: 7,
    recommendation: "keep",
    metrics: [],
    ...overrides,
  } as unknown as ProposalEffectivenessReport;
}

class FakeProposalStore {
  saved: unknown[] = [];
  async save(p: unknown): Promise<void> {
    this.saved.push(p);
  }
  async load(): Promise<unknown> {
    return null;
  }
  async list(): Promise<unknown[]> {
    return [];
  }
  async update(): Promise<unknown> {
    return {};
  }
}

// `saved` is a test-only field; cast to the public ProposalStore type which
// doesn't declare it. The runtime methods are sufficient for the stub-phase.
function asStore(fake: FakeProposalStore): ProposalStore {
  return fake as unknown as ProposalStore;
}

function makeFakeWriter(): EvidenceEventWriter {
  // We never call its methods in the stub-phase tests, so an empty stub
  // double is sufficient. Using a real instance would require wiring an
  // EvidenceStore; for stub-phase, the call surface is unused.
  return {
    recordAdaptationProposed: vi.fn().mockResolvedValue(null),
  } as unknown as EvidenceEventWriter;
}

describe("AutomaticProposalGenerator — construction & surface", () => {
  it("exports DEFAULT_MIN_REFLECTION_CONFIDENCE = 0.7", () => {
    expect(DEFAULT_MIN_REFLECTION_CONFIDENCE).toBe(0.7);
  });

  it("can be constructed with a ProposalStore and EvidenceEventWriter", () => {
    const store = new FakeProposalStore();
    const writer = makeFakeWriter();
    const gen = new AutomaticProposalGenerator(asStore(store), writer);
    expect(gen).toBeInstanceOf(AutomaticProposalGenerator);
  });
});

// ---------------------------------------------------------------------------
// Task 3 (P5.2c.3): generateFromReflection behavior — governance filters,
// provenance, evidence emission.
// ---------------------------------------------------------------------------

describe("AutomaticProposalGenerator — generateFromReflection", () => {
  let store: FakeProposalStore;
  let writer: EvidenceEventWriter;
  let gen: AutomaticProposalGenerator;

  beforeEach(() => {
    store = new FakeProposalStore();
    writer = makeFakeWriter();
    gen = new AutomaticProposalGenerator(asStore(store), writer);
  });

  it("skips a recommendation with confidence below 0.7 (default threshold)", async () => {
    const report = makeReflectionReport({
      recommendations: [
        {
          type: "capability_gap",
          confidence: 0.5,
          title: "low",
          evidence: ["e1"],
          recommendedAction: "do thing",
        },
      ],
    });

    const result = await gen.generateFromReflection(report);

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.proposals).toEqual([]);
    expect(store.saved).toEqual([]);
    expect(
      (writer.recordAdaptationProposed as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual([]);
  });

  it("respects a custom minConfidence option", async () => {
    const report = makeReflectionReport({
      recommendations: [
        {
          type: "capability_gap",
          confidence: 0.75,
          title: "mid",
          evidence: ["e1"],
          recommendedAction: "do thing",
        },
      ],
    });

    const result = await gen.generateFromReflection(report, { minConfidence: 0.9 });

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(store.saved).toEqual([]);
  });

  it("skips a routing_adjustment recommendation (user-deferred)", async () => {
    const report = makeReflectionReport({
      recommendations: [
        {
          type: "routing_adjustment",
          confidence: 0.95,
          title: "defer",
          evidence: ["e1"],
          recommendedAction: "tweak routing",
        },
      ],
    });

    const result = await gen.generateFromReflection(report);

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(store.saved).toEqual([]);
    expect(
      (writer.recordAdaptationProposed as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual([]);
  });

  it("produces a pending, provenance=auto proposal for a high-confidence capability_gap and emits exactly one adaptation_proposed evidence with provenance=auto", async () => {
    const report = makeReflectionReport({
      recommendations: [
        {
          type: "capability_gap",
          confidence: 0.9,
          title: "missing capability",
          evidence: ["ev-1", "ev-2"],
          recommendedAction: "create agent card",
        },
      ],
    });

    const result = await gen.generateFromReflection(report);

    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.proposals).toHaveLength(1);

    const proposal = result.proposals[0]!;
    expect(proposal.status).toBe("pending");
    expect(proposal.provenance).toBe("auto");
    expect(proposal.action).toBe("create_agent_card");
    expect(proposal.sourceRecommendationType).toBe("capability_gap");
    expect(proposal.sourceConfidence).toBe(0.9);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toEqual(proposal);

    const writerMock = writer.recordAdaptationProposed as ReturnType<typeof vi.fn>;
    expect(writerMock).toHaveBeenCalledTimes(1);
    const [callProposalId, callPayload] = writerMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(callProposalId).toBe(proposal.id);
    expect(callPayload).toMatchObject({
      createdAt: proposal.createdAt,
      action: proposal.action,
      sourceRecommendationType: "capability_gap",
      sourceConfidence: 0.9,
      provenance: "auto",
    });
  });

  it("skips an unknown recommendation type (null from convert) without saving or emitting evidence", async () => {
    // RecommendationType is a closed union of 5 strings, all of which the
    // converter handles. We simulate an "unknown type" by monkey-patching
    // the static convert to return null, mirroring a future extension that
    // adds a new RecommendationType the converter hasn't learned yet.
    const convertSpy = vi
      .spyOn(RecommendationToProposal, "convert")
      .mockReturnValue(null);

    const report = makeReflectionReport({
      recommendations: [
        {
          type: "capability_gap",
          confidence: 0.99,
          title: "will be nulled",
          evidence: ["e1"],
          recommendedAction: "noop",
        },
      ],
    });

    const result = await gen.generateFromReflection(report);

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.proposals).toEqual([]);
    expect(store.saved).toEqual([]);
    expect(
      (writer.recordAdaptationProposed as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual([]);

    convertSpy.mockRestore();
  });

  it("mixes generated and skipped recommendations across multiple types", async () => {
    const report = makeReflectionReport({
      recommendations: [
        // kept
        { type: "capability_gap", confidence: 0.9, title: "kept1", evidence: ["e"], recommendedAction: "x" },
        // skipped: low confidence
        { type: "skill_revision", confidence: 0.4, title: "low", evidence: ["e"], recommendedAction: "x" },
        // skipped: routing_adjustment
        { type: "routing_adjustment", confidence: 0.99, title: "defer", evidence: ["e"], recommendedAction: "x" },
        // kept
        { type: "agent_card_update", confidence: 0.8, title: "kept2", evidence: ["e"], recommendedAction: "x" },
      ],
    });

    const result = await gen.generateFromReflection(report);

    expect(result.generated).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.proposals.map((p) => p.action).sort()).toEqual([
      "create_agent_card",
      "update_agent_card",
    ]);
    for (const p of result.proposals) {
      expect(p.provenance).toBe("auto");
      expect(p.status).toBe("pending");
    }
    expect(store.saved).toHaveLength(2);
    expect(
      (writer.recordAdaptationProposed as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Stub-phase behaviour: effectiveness method still throws (Task 4 will replace).
// generateFromReflection no longer throws — see Task 3 tests above.
// ---------------------------------------------------------------------------

describe("AutomaticProposalGenerator — effectiveness stub", () => {
  it("generateFromEffectiveness throws 'not yet implemented'", async () => {
    const store = new FakeProposalStore();
    const writer = makeFakeWriter();
    const gen = new AutomaticProposalGenerator(asStore(store), writer);
    await expect(
      gen.generateFromEffectiveness(makeEffectivenessReport()),
    ).rejects.toThrow("not yet implemented");
  });
});

// ---------------------------------------------------------------------------
// generateFromAllEffectiveness — fully implemented (loops + sums).
// ---------------------------------------------------------------------------

describe("AutomaticProposalGenerator — generateFromAllEffectiveness", () => {
  it("sums generated/skipped/proposals across multiple reports", async () => {
    // Build a fake store/writer, then a generator whose
    // generateFromEffectiveness is overridden so we can assert the loop
    // without depending on the stub-throw behaviour. We use a subclass
    // override to simulate the future full implementation.
    const store = new FakeProposalStore();
    const writer = makeFakeWriter();

    const fake = new (class extends AutomaticProposalGenerator {
      callCount = 0;
      async generateFromEffectiveness(
        _r: ProposalEffectivenessReport,
        _opts: GenerateOptions = {},
      ): Promise<GenerateResult> {
        this.callCount += 1;
        // Vary the result so the sum test is meaningful.
        if (this.callCount === 1) return { generated: 2, skipped: 1, proposals: ["a", "b"] as unknown as never[] };
        if (this.callCount === 2) return { generated: 0, skipped: 3, proposals: [] };
        return { generated: 1, skipped: 0, proposals: ["c"] as unknown as never[] };
      }
    })(asStore(store), writer);

    const result = await fake.generateFromAllEffectiveness([
      makeEffectivenessReport(),
      makeEffectivenessReport(),
      makeEffectivenessReport(),
    ]);

    expect(result.generated).toBe(3);
    expect(result.skipped).toBe(4);
    expect(result.proposals).toEqual(["a", "b", "c"]);
  });

  it("returns zeros for an empty input array", async () => {
    const store = new FakeProposalStore();
    const writer = makeFakeWriter();
    const gen = new AutomaticProposalGenerator(asStore(store), writer);

    const result = await gen.generateFromAllEffectiveness([]);

    expect(result).toEqual({ generated: 0, skipped: 0, proposals: [] });
  });
});

// ---------------------------------------------------------------------------
// Sanity: constructor does not require approval/applier dependencies.
// (This complements the file-text sentinel — together they pin the boundary
// from both directions: the file can't import forbidden modules, and the
// constructor signature can't accept them.)
// ---------------------------------------------------------------------------

describe("AutomaticProposalGenerator — constructor parameter shape", () => {
  it("accepts only two positional parameters (store, writer)", () => {
    // The runtime type check is satisfied by the .length property of the
    // constructor. We pin it here so a future refactor that widens the
    // constructor fails the test.
    expect(AutomaticProposalGenerator.length).toBe(2);
  });
});

// Suppress unused-import warning for mkdtempSync/rmSync — these are reserved
// for downstream tasks that may want to assert on-disk behaviour, but kept
// here so the test file remains self-contained for the boundary sentinel.
void mkdtempSync;
void rmSync;
void tmpdir;
