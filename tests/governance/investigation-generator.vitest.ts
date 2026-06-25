/**
 * P9.6 — InvestigationGenerator tests.
 *
 * @module
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvestigationStore } from "../../src/governance/investigation-store.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import { generateInvestigations } from "../../src/governance/investigation-generator.js";
import type { GovernanceDriftReport, GovernanceIntegrityReport } from "../../src/governance/governance-types.js";

function makeDriftReport(overrides: Partial<GovernanceDriftReport> = {}): GovernanceDriftReport {
  return {
    id: "drift-report-001",
    subject: "Drift Report",
    outcome: "computed",
    confidence: 1,
    reasons: [],
    generatedAt: new Date().toISOString(),
    reportType: "governance_drift",
    findings: [
      {
        driftType: "chain_coverage_drop",
        detectedAt: new Date().toISOString(),
        severity: "high",
        confidence: 0.6,
        evidenceRefs: ["ev-001"],
        description: "Evidence chain coverage dropped to 55%",
        recommendation: "Investigate chain coverage",
      },
    ],
    ...overrides,
  };
}

function makeIntegrityReport(overrides: Partial<GovernanceIntegrityReport> = {}): GovernanceIntegrityReport {
  return {
    id: "integrity-report-001",
    subject: "Integrity Report",
    outcome: "computed",
    confidence: 1,
    reasons: [],
    generatedAt: new Date().toISOString(),
    reportType: "governance_integrity",
    metrics: {
      totalReviews: 50,
      reviewsWithProvenance: 10,
      reviewsWithExplanations: 20,
      reviewsLinkedToOutcomes: 5,
      untraceableFindings: 3,
      provenanceRate: 20,
      explanationRate: 40,
      outcomeLinkRate: 10,
    },
    ...overrides,
  };
}

let storeDir: string;
let invStore: InvestigationStore;
let govStore: GovernanceStore;
const generatedAt = "2026-06-24T12:00:00.000Z";

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "investigation-generator-"));
  invStore = new InvestigationStore(join(storeDir, ".alix", "governance"));
  govStore = new GovernanceStore(join(storeDir, ".alix", "governance"));
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

describe("generateInvestigations", () => {
  it("generates chain_restoration investigation from drift finding with chain_coverage_drop", async () => {
    const drift = makeDriftReport();
    await govStore.append("drift", drift);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    expect(result.length).toBe(1);
    expect(result[0].kind).toBe("chain_restoration");
    expect(result[0].severity).toBe("high");
    expect(result[0].source).toBe("drift");
    expect(result[0].sourceArtifactId).toBe("drift-report-001");
  });

  it("generates governance_integrity investigation from drift finding with other driftType", async () => {
    const drift = makeDriftReport({
      findings: [{
        driftType: "lens_drift",
        detectedAt: new Date().toISOString(),
        severity: "critical",
        confidence: 0.8,
        evidenceRefs: ["ev-002"],
        description: "Lens drift detected",
        recommendation: "Investigate lens drift",
      }],
    });
    await govStore.append("drift", drift);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    expect(result.length).toBe(1);
    expect(result[0].kind).toBe("governance_integrity");
    expect(result[0].severity).toBe("critical");
  });

  it("skips drift findings with low/medium severity", async () => {
    const drift = makeDriftReport({
      findings: [{
        driftType: "chain_coverage_drop",
        detectedAt: new Date().toISOString(),
        severity: "low",
        confidence: 0.3,
        evidenceRefs: ["ev-003"],
        description: "Minor coverage drop",
        recommendation: "Monitor",
      }],
    });
    await govStore.append("drift", drift);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });
    expect(result.length).toBe(0);
  });

  it("generates chain_restoration from integrity provenanceRate below 60%", async () => {
    const integrity = makeIntegrityReport();
    await govStore.append("integrity", integrity);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    const chainRecs = result.filter((r) => r.kind === "chain_restoration" && r.source === "integrity");
    expect(chainRecs.length).toBeGreaterThanOrEqual(1);
    expect(chainRecs[0].severity).toBe("high");
  });

  it("generates governance_integrity from integrity explanationRate and outcomeLinkRate below 60%", async () => {
    const integrity = makeIntegrityReport();
    await govStore.append("integrity", integrity);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    const integRecs = result.filter((r) => r.kind === "governance_integrity" && r.source === "integrity");
    expect(integRecs.length).toBe(2);
  });

  it("skips integrity metrics at or above 60%", async () => {
    const integrity = makeIntegrityReport({
      metrics: {
        totalReviews: 50,
        reviewsWithProvenance: 40,
        reviewsWithExplanations: 35,
        reviewsLinkedToOutcomes: 30,
        untraceableFindings: 0,
        provenanceRate: 80,
        explanationRate: 70,
        outcomeLinkRate: 60,
      },
    });
    await govStore.append("integrity", integrity);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });
    const fromIntegrity = result.filter((r) => r.source === "integrity");
    expect(fromIntegrity.length).toBe(0);
  });

  it("writes generated investigations to InvestigationStore", async () => {
    const drift = makeDriftReport();
    await govStore.append("drift", drift);

    await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    const stored = await invStore.list();
    expect(stored.length).toBeGreaterThan(0);
  });

  it("returns empty array when no artifacts exist in governance store", async () => {
    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });
    expect(result).toEqual([]);
  });
});
