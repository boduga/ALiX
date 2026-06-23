/**
 * P9.1b — RecommendationGenerator tests.
 *
 * 5 tests:
 *  1. generateLensRecommendations — one demote + one keep, 1 rec category=lens_adjustment
 *  2. generateDriftRecommendations — high + low severity, returns 1 rec (high only)
 *  3. generateIntegrityRecommendations — provenanceRate=40, returns 1 rec category=chain_restoration
 *  4. generateHealthRecommendations — explanationCompleteness=25, 1 rec category=policy_coverage
 *  5. (bonus) generateRecommendations end-to-end — appends 1 of each P9.0 artifact
 *     to a fresh store, calls generateRecommendations({ windowDays: 30 }), verifies
 *     the resulting artifact contains recommendations from all 4 sources and is
 *     stored under "recommendations".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GovernanceStore } from "../../src/governance/governance-store.js";
import {
  generateLensRecommendations,
  generateDriftRecommendations,
  generateIntegrityRecommendations,
  generateHealthRecommendations,
  generateRecommendations,
} from "../../src/governance/governance-recommendation-generator.js";
import type {
  GovernanceDriftReport,
  GovernanceHealthReport,
  GovernanceIntegrityReport,
  LensLifecycleReview,
} from "../../src/governance/governance-types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-recommendation-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recentISO(minutesAgo = 0): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function makeLensReview(overrides: Partial<{
  id: string;
  generatedAt: string;
  lensReviews: LensLifecycleReview["lensReviews"];
}> = {}): LensLifecycleReview {
  return {
    id: overrides.id ?? "lens_review:test-001",
    subject: "Lens Lifecycle Review",
    outcome: "computed",
    confidence: 1,
    reasons: ["test fixture"],
    generatedAt: overrides.generatedAt ?? recentISO(),
    reportType: "lens_lifecycle",
    lensReviews: overrides.lensReviews ?? [],
  };
}

function makeDriftReport(overrides: Partial<{
  id: string;
  generatedAt: string;
  findings: GovernanceDriftReport["findings"];
}> = {}): GovernanceDriftReport {
  return {
    id: overrides.id ?? "gov-drift:test-001",
    subject: "Governance Drift Report",
    outcome: "informational",
    confidence: 1,
    reasons: ["test fixture"],
    generatedAt: overrides.generatedAt ?? recentISO(),
    reportType: "governance_drift",
    findings: overrides.findings ?? [],
  };
}

function makeIntegrityReport(overrides: Partial<{
  id: string;
  generatedAt: string;
  metrics: GovernanceIntegrityReport["metrics"];
}> = {}): GovernanceIntegrityReport {
  return {
    id: overrides.id ?? "gov-integrity:test-001",
    subject: "Governance Integrity Report",
    outcome: "informational",
    confidence: 1,
    reasons: ["test fixture"],
    generatedAt: overrides.generatedAt ?? recentISO(),
    reportType: "governance_integrity",
    metrics: overrides.metrics ?? {
      totalReviews: 0,
      reviewsWithProvenance: 0,
      reviewsWithExplanations: 0,
      reviewsLinkedToOutcomes: 0,
      untraceableFindings: 0,
      provenanceRate: 100,
      explanationRate: 100,
      outcomeLinkRate: 100,
    },
  };
}

function makeHealthReport(overrides: Partial<{
  id: string;
  generatedAt: string;
  sourceMetrics: GovernanceHealthReport["sourceMetrics"];
  totalReviews: number;
  totalProposals: number;
  lensEffectiveness: GovernanceHealthReport["lensEffectiveness"];
  policyCoverage: number;
}> = {}): GovernanceHealthReport {
  return {
    id: overrides.id ?? "gov_health:test-001",
    subject: "Governance Health",
    outcome: "computed",
    confidence: 1,
    reasons: ["test fixture"],
    generatedAt: overrides.generatedAt ?? recentISO(),
    reportType: "governance_health",
    totalReviews: overrides.totalReviews ?? 0,
    totalProposals: overrides.totalProposals ?? 0,
    lensEffectiveness: overrides.lensEffectiveness ?? {},
    policyCoverage: overrides.policyCoverage ?? 0,
    sourceMetrics: overrides.sourceMetrics ?? {
      dashboardIntegrityScore: 80,
      explanationCompleteness: 80,
      evidenceChainUsage: 80,
      incompleteChainLayers: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. generateLensRecommendations
// ---------------------------------------------------------------------------

describe("generateLensRecommendations", () => {
  it("emits one recommendation per demote entry, skips keep", () => {
    const review = makeLensReview({
      lensReviews: [
        {
          lens: "red_team",
          predictiveValue: 0.3,
          reviewsAnalyzed: 25,
          falseAlarms: 2,
          missedFailures: 1,
          recommendation: "demote",
          reason: "Low predictive value",
        },
        {
          lens: "historian",
          predictiveValue: 0.8,
          reviewsAnalyzed: 50,
          falseAlarms: 0,
          missedFailures: 0,
          recommendation: "keep",
          reason: "Stable performance",
        },
      ],
    });

    const recs = generateLensRecommendations([review]);

    expect(recs).toHaveLength(1);
    expect(recs[0].source).toBe("lens-review");
    expect(recs[0].category).toBe("lens_adjustment");
    expect(recs[0].sourceArtifactId).toBe(review.id);
    expect(recs[0].priority).toBe("medium");
    expect(recs[0].status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// 2. generateDriftRecommendations
// ---------------------------------------------------------------------------

describe("generateDriftRecommendations", () => {
  it("emits recommendations only for high or critical severity findings", () => {
    const report = makeDriftReport({
      findings: [
        {
          driftType: "lens_drift",
          detectedAt: recentISO(),
          severity: "high",
          confidence: 0.8,
          evidenceRefs: ["sig-1"],
          description: "Lens red_team has degraded predictive value",
          recommendation: "Retire red_team",
        },
        {
          driftType: "policy_drift",
          detectedAt: recentISO(),
          severity: "low",
          confidence: 0.5,
          evidenceRefs: ["sig-2"],
          description: "Minor policy drift detected",
          recommendation: "Monitor",
        },
      ],
    });

    const recs = generateDriftRecommendations([report]);

    expect(recs).toHaveLength(1);
    expect(recs[0].source).toBe("drift");
    expect(recs[0].priority).toBe("high");
    expect(recs[0].category).toBe("governance_integrity");
    expect(recs[0].sourceArtifactId).toBe(report.id);
  });
});

// ---------------------------------------------------------------------------
// 3. generateIntegrityRecommendations
// ---------------------------------------------------------------------------

describe("generateIntegrityRecommendations", () => {
  it("emits one recommendation for low provenance rate", () => {
    const report = makeIntegrityReport({
      metrics: {
        totalReviews: 10,
        reviewsWithProvenance: 4,
        reviewsWithExplanations: 8,
        reviewsLinkedToOutcomes: 9,
        untraceableFindings: 1,
        provenanceRate: 40,
        explanationRate: 80,
        outcomeLinkRate: 90,
      },
    });

    const recs = generateIntegrityRecommendations([report]);

    expect(recs).toHaveLength(1);
    expect(recs[0].source).toBe("integrity");
    expect(recs[0].category).toBe("chain_restoration");
    expect(recs[0].priority).toBe("medium"); // 40 ≤ rate < 60
    expect(recs[0].sourceArtifactId).toBe(report.id);
  });
});

// ---------------------------------------------------------------------------
// 4. generateHealthRecommendations
// ---------------------------------------------------------------------------

describe("generateHealthRecommendations", () => {
  it("emits one recommendation for weakest layer when below 50%", () => {
    const report = makeHealthReport({
      sourceMetrics: {
        dashboardIntegrityScore: 80,
        explanationCompleteness: 25,
        evidenceChainUsage: 80,
        incompleteChainLayers: 0,
      },
    });

    const recs = generateHealthRecommendations([report]);

    expect(recs).toHaveLength(1);
    expect(recs[0].source).toBe("health");
    expect(recs[0].category).toBe("policy_coverage");
    expect(recs[0].priority).toBe("high"); // < 30
    expect(recs[0].sourceArtifactId).toBe(report.id);
  });
});

// ---------------------------------------------------------------------------
// 5. generateRecommendations — end-to-end
// ---------------------------------------------------------------------------

describe("generateRecommendations", () => {
  it("appends 4 sources to a fresh store and produces a stored artifact", async () => {
    const store = new GovernanceStore(join(tempRoot, ".alix", "governance"));

    // Seed one artifact per source type with at least one matching trigger.
    const lensReview = makeLensReview({
      generatedAt: recentISO(),
      lensReviews: [
        {
          lens: "red_team",
          predictiveValue: 0.3,
          reviewsAnalyzed: 25,
          falseAlarms: 2,
          missedFailures: 1,
          recommendation: "demote",
          reason: "Low predictive value",
        },
      ],
    });
    const drift = makeDriftReport({
      generatedAt: recentISO(),
      findings: [
        {
          driftType: "confidence_drift",
          detectedAt: recentISO(),
          severity: "high",
          confidence: 0.8,
          evidenceRefs: ["sig-1"],
          description: "Overconfidence ratio 80%",
          recommendation: "Review calibration thresholds",
        },
      ],
    });
    const integrity = makeIntegrityReport({
      generatedAt: recentISO(),
      metrics: {
        totalReviews: 10,
        reviewsWithProvenance: 4,
        reviewsWithExplanations: 8,
        reviewsLinkedToOutcomes: 9,
        untraceableFindings: 1,
        provenanceRate: 40,
        explanationRate: 80,
        outcomeLinkRate: 90,
      },
    });
    const health = makeHealthReport({
      generatedAt: recentISO(),
      sourceMetrics: {
        dashboardIntegrityScore: 80,
        explanationCompleteness: 25,
        evidenceChainUsage: 80,
        incompleteChainLayers: 0,
      },
    });

    await store.append("lensReviews", lensReview);
    await store.append("drift", drift);
    await store.append("integrity", integrity);
    await store.append("health", health);

    const artifact = await generateRecommendations({
      windowDays: 30,
      store,
    });

    // The aggregated artifact should contain one recommendation per source.
    const sources = new Set(artifact.recommendations.map((r) => r.source));
    expect(sources.has("lens-review")).toBe(true);
    expect(sources.has("drift")).toBe(true);
    expect(sources.has("integrity")).toBe(true);
    expect(sources.has("health")).toBe(true);
    expect(artifact.reportType).toBe("governance_recommendation");

    // The artifact should be persisted under "recommendations".
    const stored = await store.list("recommendations");
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(artifact.id);
    expect(stored[0].reportType).toBe("governance_recommendation");
  });
});
