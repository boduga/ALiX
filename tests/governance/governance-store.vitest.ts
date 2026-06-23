import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GovernanceStore } from "../../src/governance/governance-store.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-store-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("GovernanceStore", () => {
  it("appends and lists health records", async () => {
    const store = new GovernanceStore();
    await store.append("health", {
      id: "health-1",
      subject: "Health",
      outcome: "computed",
      confidence: 0.9,
      reasons: [],
      generatedAt: "2026-06-23T00:00:00.000Z",
      reportType: "governance_health",
      totalReviews: 10,
      totalProposals: 5,
      lensEffectiveness: { red_team: 0.72 },
      policyCoverage: 85,
      sourceMetrics: {
        dashboardIntegrityScore: 92,
        explanationCompleteness: 83.3,
        evidenceChainUsage: 81,
        incompleteChainLayers: 0,
      },
      evidenceRefs: [],
    } as any);
    const records = await store.list("health");
    expect(records.length).toBe(1);
    expect(records[0].totalReviews).toBe(10);
  });

  it("appends and lists drift records", async () => {
    const store = new GovernanceStore();
    await store.append("drift", {
      id: "drift-1",
      subject: "Drift",
      outcome: "computed",
      confidence: 0.85,
      reasons: ["confidence ratio > 0.6"],
      generatedAt: "2026-06-23T00:00:00.000Z",
      reportType: "governance_drift",
      findings: [
        {
          driftType: "confidence_drift",
          detectedAt: "2026-06-23T00:00:00.000Z",
          severity: "high",
          confidence: 0.85,
          evidenceRefs: ["signal-1"],
          description: "Overconfidence ratio 0.72 exceeds threshold 0.6",
          recommendation: "Investigate confidence calibration for red_team lens",
        },
      ],
      evidenceRefs: ["signal-1"],
    } as any);
    const records = await store.list("drift");
    expect(records.length).toBe(1);
    expect(records[0].findings).toHaveLength(1);
    expect(records[0].findings[0].driftType).toBe("confidence_drift");
  });

  it("appends and lists integrity records", async () => {
    const store = new GovernanceStore();
    await store.append("integrity", {
      id: "integrity-1",
      subject: "Integrity",
      outcome: "computed",
      confidence: 0.95,
      reasons: ["integrity scan complete"],
      generatedAt: "2026-06-23T00:00:00.000Z",
      reportType: "governance_integrity",
      metrics: {
        totalReviews: 50,
        reviewsWithProvenance: 45,
        reviewsWithExplanations: 48,
        reviewsLinkedToOutcomes: 40,
        untraceableFindings: 2,
        provenanceRate: 0.9,
        explanationRate: 0.96,
        outcomeLinkRate: 0.8,
      },
      evidenceRefs: [],
    } as any);
    const records = await store.list("integrity");
    expect(records.length).toBe(1);
    expect(records[0].metrics.totalReviews).toBe(50);
    expect(records[0].metrics.provenanceRate).toBe(0.9);
  });

  it("returns empty list for missing file", async () => {
    const store = new GovernanceStore();
    expect(await store.list("health")).toEqual([]);
  });

  it("getTypeForId resolves health-xxx to health", () => {
    const store = new GovernanceStore();
    expect(store.getTypeForId("health-1")).toBe("health");
  });

  it("getTypeForId resolves drift-xxx to drift", () => {
    const store = new GovernanceStore();
    expect(store.getTypeForId("drift-1")).toBe("drift");
  });

  it("getTypeForId returns null for unknown prefix", () => {
    const store = new GovernanceStore();
    expect(store.getTypeForId("unknown-1")).toBeNull();
  });
});
