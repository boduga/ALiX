/**
 * P9.6 — Investigation compatibility adapter tests.
 *
 * @module
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvestigationStore } from "../../src/governance/investigation-store.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import { listCompatibleInvestigations } from "../../src/governance/investigation-compat.js";
import type { InvestigationRecommendation } from "../../src/governance/investigation-types.js";
import type { Recommendation } from "../../src/governance/governance-types.js";

function makeNativeInv(id: string, overrides: Partial<InvestigationRecommendation> = {}): InvestigationRecommendation {
  return {
    id,
    kind: "chain_restoration",
    status: "open",
    severity: "high",
    source: "drift",
    sourceArtifactId: "drift-001",
    evidenceRefs: [],
    title: "Native test inv",
    description: "Test",
    operatorGuidance: "Investigate",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLegacyRec(id: string, overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id,
    source: "drift",
    sourceArtifactId: "legacy-drift-001",
    priority: "high",
    confidence: 0.7,
    status: "open",
    category: "chain_restoration",
    title: "Legacy test rec",
    description: "Legacy desc",
    evidenceRefs: [],
    operatorGuidance: "Investigate legacy",
    expectedBenefit: "Fix coverage",
    risks: ["None"],
    metadata: { category: "chain_restoration", targetArtifactId: "art-001", currentRate: 50, targetRate: 80 },
    ...overrides,
  };
}

let storeDir: string;
let invStore: InvestigationStore;
let govStore: GovernanceStore;

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "investigation-compat-"));
  invStore = new InvestigationStore(join(storeDir, ".alix", "governance"));
  govStore = new GovernanceStore(join(storeDir, ".alix", "governance"));
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

describe("listCompatibleInvestigations", () => {
  it("returns empty array when no native or legacy records exist", async () => {
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results).toEqual([]);
  });

  it("returns native investigations when no legacy records exist", async () => {
    await invStore.save(makeNativeInv("inv-001"));
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("inv-001");
    expect(results[0].legacySource).toBeUndefined();
  });

  it("wraps legacy chain_restoration recommendations with correct kind and metadata", async () => {
    await govStore.append("recommendations", {
      id: "rec-report-001",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-001", {
          category: "chain_restoration",
          metadata: { category: "chain_restoration", targetArtifactId: "art-001", currentRate: 50, targetRate: 80 },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("legacy-investigation-legacy-rec-001");
    expect(results[0].kind).toBe("chain_restoration");
    expect(results[0].legacySource).toBeDefined();
    expect(results[0].legacySource!.store).toBe("governance");
    expect(results[0].legacySource!.recommendationId).toBe("legacy-rec-001");
  });

  it("wraps legacy governance_integrity recommendations correctly", async () => {
    await govStore.append("recommendations", {
      id: "rec-report-002",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-002", {
          category: "governance_integrity",
          metadata: { category: "governance_integrity", issue: "Pipeline issue", recommendationId: "legacy-rec-002" },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("legacy-investigation-legacy-rec-002");
    expect(results[0].kind).toBe("governance_integrity");
  });

  it("dedupes legacy records when a native investigation exists with same sourceArtifactId and kind", async () => {
    await invStore.save(makeNativeInv("inv-native-001", {
      sourceArtifactId: "drift-report-abc",
      kind: "chain_restoration",
    }));
    await govStore.append("recommendations", {
      id: "rec-report-003",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-003", {
          sourceArtifactId: "drift-report-abc",
          category: "chain_restoration",
          metadata: { category: "chain_restoration", targetArtifactId: "art-001", currentRate: 50, targetRate: 80 },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("inv-native-001");
  });

  it("does not dedupe when kinds differ despite same sourceArtifactId", async () => {
    await invStore.save(makeNativeInv("inv-native-002", {
      sourceArtifactId: "drift-report-xyz",
      kind: "chain_restoration",
    }));
    await govStore.append("recommendations", {
      id: "rec-report-004",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-004", {
          sourceArtifactId: "drift-report-xyz",
          category: "governance_integrity",
          metadata: { category: "governance_integrity", issue: "Issue", recommendationId: "legacy-rec-004" },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(2);
  });

  it("merges native and legacy records sorted by createdAt desc", async () => {
    const early = new Date("2026-01-01").toISOString();
    const late = new Date("2026-06-01").toISOString();
    await invStore.save(makeNativeInv("inv-native-003", { createdAt: early }));
    await govStore.append("recommendations", {
      id: "rec-report-005",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: late,
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-005", {
          sourceArtifactId: "drift-report-pqr",
          category: "chain_restoration",
          metadata: { category: "chain_restoration", targetArtifactId: "art-001", currentRate: 50, targetRate: 80 },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(2);
    // Latest first
    expect(results[0].id).toBe("legacy-investigation-legacy-rec-005");
    expect(results[1].id).toBe("inv-native-003");
  });

  it("skips legacy recommendations with non-investigation categories", async () => {
    await govStore.append("recommendations", {
      id: "rec-report-006",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-006", {
          category: "lens_adjustment",
          metadata: { category: "lens_adjustment", operation: "demote", lens: "test-lens", currentPV: 0.5, reviewsAnalyzed: 10 },
        }),
        makeLegacyRec("legacy-rec-007", {
          category: "confidence_calibration",
          metadata: { category: "confidence_calibration", target: "test", currentCalibration: 0.6, suggestedCalibration: 0.8 },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(0);
  });

  it("handles corrupt governance store lines gracefully", async () => {
    const govDir = join(storeDir, ".alix", "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, "recommendations.jsonl"), "not-json\n", "utf-8");
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results).toEqual([]);
  });
});
