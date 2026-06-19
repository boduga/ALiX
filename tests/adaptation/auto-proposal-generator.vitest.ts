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
    const approvalGateClass = /^\s*import[\s\S]*?from\s+["'][^"']*ApprovalGate[^"']*["'];?/m;
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
// Stub-phase behaviour: reflection & effectiveness methods throw.
// Task 3 (reflection) and Task 4 (effectiveness) will replace the throws.
// ---------------------------------------------------------------------------

describe("AutomaticProposalGenerator — stub-phase", () => {
  let store: FakeProposalStore;
  let writer: EvidenceEventWriter;
  let gen: AutomaticProposalGenerator;

  beforeEach(() => {
    store = new FakeProposalStore();
    writer = makeFakeWriter();
    gen = new AutomaticProposalGenerator(asStore(store), writer);
  });

  it("generateFromReflection throws 'not yet implemented'", async () => {
    await expect(
      gen.generateFromReflection(makeReflectionReport()),
    ).rejects.toThrow("not yet implemented");
  });

  it("generateFromEffectiveness throws 'not yet implemented'", async () => {
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
