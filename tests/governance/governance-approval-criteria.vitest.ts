/**
 * P9.3 — Tests for GovernanceApprovalCriteria pure read-only validation module.
 *
 * Tests cover all 6 criteria individually in isolation, plus integration
 * scenarios. Each test seeds the necessary stores (EvidenceChainStore,
 * GovernanceStore), calls runGovernanceCriteria, and asserts the result.
 *
 * @module
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceChainStore } from "../../src/learning/evidence-chain-store.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import type { AdaptationProposal, ProposalTarget } from "../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Mock: assembleProposalExplanation — one top-level mock for the whole file.
// Tests that need the assembler control its return value via
// setAssemblerCompleteness() before calling runGovernanceCriteria.
//
// The mock returns a minimal ProposalExplanation shape — only the
// explanationIntegrity.completenessPercent field is read by the criteria
// module, so the remaining fields are stubs.
// ---------------------------------------------------------------------------

let assemblerReturnValue: { completenessPercent: number; _shouldReject: boolean } = {
  completenessPercent: 85,
  _shouldReject: false,
};

vi.mock("../../src/explain/proposal-explanation-assembler.js", () => ({
  assembleProposalExplanation: vi.fn(() => {
    if (assemblerReturnValue._shouldReject) return Promise.reject(new Error("mock failure"));
    return Promise.resolve({
      explanationIntegrity: { completenessPercent: assemblerReturnValue.completenessPercent },
    });
  }),
}));

function setAssemblerCompleteness(v: number | "reject") {
  if (v === "reject") {
    assemblerReturnValue._shouldReject = true;
  } else {
    assemblerReturnValue._shouldReject = false;
    assemblerReturnValue.completenessPercent = v;
  }
}

// The criteria module must be imported dynamically *after* the mock so
// that it picks up the mocked assembler. Do NOT add a static import.
async function importCriteria() {
  return import("../../src/governance/governance-approval-criteria.js");
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const RECOMMENDATION_ID = "rec-001";

function makeGovernanceProposal(
  overrides: Partial<AdaptationProposal> = {},
): AdaptationProposal {
  return {
    id: "prop-gov-001",
    createdAt: "2026-06-23T00:00:00.000Z",
    status: "pending",
    action: "governance_change",
    target: {
      kind: "governance",
      recommendationId: RECOMMENDATION_ID,
    } as ProposalTarget,
    payload: {
      kind: "confidence_calibration",
      target: "red_team",
      currentCalibration: 0.7,
      suggestedCalibration: 0.75,
    },
    sourceRecommendationType: "governance",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test governance proposal",
    ...overrides,
  };
}

function makeChainLink(recommendationId: string) {
  return {
    rootArtifactId: "prop-gov-001",
    rootArtifactType: "adaptation_proposal" as const,
    depth: 1,
    outcome: "recorded",
    confidence: 1,
    reasons: ["test"],
    subject: "evidence chain for prop-gov-001",
    generatedAt: new Date().toISOString(),
    links: [
      {
        sourceArtifactId: "prop-gov-001",
        sourceArtifactType: "adaptation_proposal" as const,
        targetArtifactId: recommendationId,
        targetArtifactType: "recommendation" as const,
        relationship: "proposal_from_recommendation" as const,
        recordedAt: new Date().toISOString(),
      },
    ],
    id: "chain-001",
  };
}

function makeGovernanceRecommendation(innerOverrides: Record<string, unknown> = {}) {
  return {
    id: "gov-rec-report-001",
    subject: "governance recommendation report",
    outcome: "recommended",
    confidence: 0.9,
    reasons: ["test"],
    generatedAt: new Date().toISOString(),
    reportType: "governance_recommendation" as const,
    recommendations: [
      {
        id: RECOMMENDATION_ID,
        source: "health" as const,
        sourceArtifactId: "health-001",
        priority: "high" as const,
        confidence: 0.85,
        status: "open" as const,
        category: "confidence_calibration" as const,
        title: "Calibrate red_team confidence",
        description: "Adjust calibration from 0.7 to 0.75",
        evidenceRefs: ["health-001"],
        operatorGuidance: "Review and approve",
        expectedBenefit: "Better confidence alignment",
        risks: ["Minimal"],
        metadata: {
          category: "confidence_calibration" as const,
          target: "red_team",
          currentCalibration: 0.7,
          suggestedCalibration: 0.75,
        },
        ...innerOverrides,
      },
    ],
  };
}

describe("runGovernanceCriteria", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tempDirs = [];
    vi.clearAllMocks();
    // Reset assembler to default passing value.
    setAssemblerCompleteness(85);
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "criteria-test-"));
    tempDirs.push(dir);
    return dir;
  }

  // -----------------------------------------------------------------------
  // Helper: seed a valid chain
  // -----------------------------------------------------------------------

  async function seedValidChain(cwd: string, recommendationId = RECOMMENDATION_ID) {
    const chainStore = new EvidenceChainStore(join(cwd, ".alix", "learning"));
    await chainStore.appendChain(
      makeChainLink(recommendationId) as Parameters<EvidenceChainStore["appendChain"]>[0],
    );
  }

  // -----------------------------------------------------------------------
  // Helper: seed a valid recommendation in GovernanceStore
  // -----------------------------------------------------------------------

  async function seedValidRecommendation(
    cwd: string,
    innerOverrides: Record<string, unknown> = {},
  ) {
    const govStore = new GovernanceStore(join(cwd, ".alix", "governance"));
    await govStore.append(
      "recommendations",
      makeGovernanceRecommendation(innerOverrides) as Parameters<GovernanceStore["append"]>[1],
    );
  }

  // =======================================================================
  // Test 1: rejects orphaned governance proposal
  // =======================================================================

  it("rejects orphaned governance proposal", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal({
      systemState: { orphaned: true, reason: "test" },
    });

    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(false);
    expect(result.failedCriterion).toContain("orphaned");
  });

  // =======================================================================
  // Test 2: rejects proposal with no proposal_from_recommendation edge
  // =======================================================================

  it("rejects proposal with no proposal_from_recommendation edge", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal();

    // No chain seeded — getChainForRoot returns []
    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(false);
    expect(result.failedCriterion).toContain("no proposal_from_recommendation edge");
  });

  // =======================================================================
  // Test 3: rejects proposal whose source recommendation does not exist
  // =======================================================================

  it("rejects proposal whose source recommendation does not exist", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal();

    // Seed the chain BUT don't seed the recommendation in GovernanceStore
    await seedValidChain(cwd);

    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(false);
    expect(result.failedCriterion).toContain("source recommendation not found");
  });

  // =======================================================================
  // Test 4: rejects proposal whose source recommendation has confidence
  //         below threshold
  // =======================================================================

  it("rejects proposal whose source recommendation has confidence below threshold", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal();

    await seedValidChain(cwd);
    // Recommendation with confidence 0.3 (below 0.6 threshold)
    await seedValidRecommendation(cwd, { confidence: 0.3 });

    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(false);
    expect(result.failedCriterion).toContain("below threshold");
  });

  // =======================================================================
  // Test 5: rejects proposal whose source recommendation status is not open
  // =======================================================================

  it("rejects proposal whose source recommendation status is not open", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal();

    await seedValidChain(cwd);
    // Recommendation with status "dismissed"
    await seedValidRecommendation(cwd, { status: "dismissed" });

    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(false);
    expect(result.failedCriterion).toContain("expected \"open\"");
  });

  // =======================================================================
  // Test 6: rejects proposal whose explanation integrity is below threshold
  // =======================================================================

  it("rejects proposal whose explanation integrity is below threshold", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal();

    await seedValidChain(cwd);
    await seedValidRecommendation(cwd);

    // Set assembled completeness below the 60% threshold
    setAssemblerCompleteness(30);

    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(false);
    expect(result.failedCriterion).toContain("below threshold");
    expect(result.integrityScore).toBe(30);
  });

  // =======================================================================
  // Test 7: passes for a fully valid governance proposal
  // =======================================================================

  it("passes for a fully valid governance proposal", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal();

    await seedValidChain(cwd);
    await seedValidRecommendation(cwd);

    // Default assembler value is 85 (above threshold) — set in afterEach
    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(true);
    expect(result.integrityScore).toBe(85);
  });

  // =======================================================================
  // Test 8: returns integrityScore and details on pass
  // =======================================================================

  it("returns integrityScore and details on pass", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal();

    await seedValidChain(cwd);
    await seedValidRecommendation(cwd);

    // Default assembler value is 85 (above threshold) — set in afterEach
    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(true);
    expect(result.integrityScore).toBe(85);
    expect(result.details).toBeDefined();
    expect(result.details!.recommendationId).toBe(RECOMMENDATION_ID);
    expect(result.details!.recommendationConfidence).toBe(0.85);
    expect(result.details!.recommendationStatus).toBe("open");
    expect(result.details!.proposalAction).toBe("governance_change");
  });

  // =======================================================================
  // Test 9: rejects proposal with missing recommendationId in target
  // =======================================================================

  it("rejects proposal with missing recommendationId in target", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal({
      target: { kind: "governance" } as ProposalTarget,
    });
    // No need to seed stores — criterion 2 will fail before reaching them
    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });
    expect(result.passed).toBe(false);
    expect(result.failedCriterion).toContain("missing");
  });

  // =======================================================================
  // Test 10: rejects proposal when explanation assembly fails
  // =======================================================================

  it("rejects proposal when explanation assembly fails", async () => {
    const cwd = makeTempDir();
    const proposal = makeGovernanceProposal();

    // Seed enough for criteria 1-5 to pass
    await seedValidChain(cwd);
    await seedValidRecommendation(cwd);

    // Make assembler reject
    setAssemblerCompleteness("reject");

    const { runGovernanceCriteria } = await importCriteria();
    const result = await runGovernanceCriteria({ proposal, cwd });

    expect(result.passed).toBe(false);
    expect(result.failedCriterion).toBe("explanation assembly failed");
    expect(result.integrityScore).toBe(0);
  });
});
