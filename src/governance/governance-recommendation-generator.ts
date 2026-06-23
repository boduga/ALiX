/**
 * P9.1b — RecommendationGenerator.
 *
 * Pure read-only generator that consumes P9.0 analysis artifacts from
 * GovernanceStore and emits a single GovernanceRecommendation advisory
 * artifact. Four source adapters, each transforming a P9.0 artifact
 * type into zero or more Recommendation records.
 *
 * Core invariants:
 *  - Read-only with respect to P9.0 artifacts and P8 stores.
 *  - Writes only to GovernanceStore ("recommendations").
 *  - No calls to createProposal / approve / apply / governance_change.
 *  - Does NOT import any adaptation/ mutation modules.
 *
 * @module
 */

import { GovernanceStore } from "./governance-store.js";
import type {
  GovernanceDriftReport,
  GovernanceHealthReport,
  GovernanceIntegrityReport,
  GovernanceRecommendation,
  LensLifecycleReview,
  Recommendation,
} from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 30;

const TITLE_MAX = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function shortId(prefix: string, generatedAt: string): string {
  // Use a stable slice of the generatedAt to keep IDs deterministic
  // for a given run, with a random suffix for uniqueness within a window.
  const stamp = generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 1000) / 1000;
}

function meanConfidence(recs: Recommendation[]): number {
  if (recs.length === 0) return 1;
  const sum = recs.reduce((acc, r) => acc + (Number.isFinite(r.confidence) ? r.confidence : 0), 0);
  return Math.round((sum / recs.length) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// 1. LensRecommendations
// ---------------------------------------------------------------------------

/**
 * For each LensLifecycleReview, emit one Recommendation per demote/retire
 * lens entry. Keep/promote are not flagged.
 */
export function generateLensRecommendations(
  reviews: LensLifecycleReview[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const review of reviews) {
    for (const entry of review.lensReviews) {
      if (entry.recommendation !== "demote" && entry.recommendation !== "retire") {
        continue;
      }
      const priority: Recommendation["priority"] =
        entry.recommendation === "retire" ? "high" : "medium";
      const denom = entry.recommendation === "retire" ? 30 : 20;
      const confidence = clamp01(entry.reviewsAnalyzed / denom);

      const title = `${entry.recommendation} ${entry.lens}: PV ${entry.predictiveValue}, ${entry.reviewsAnalyzed} reviews`;

      recs.push({
        id: shortId("rec_lens", review.generatedAt),
        source: "lens-review",
        sourceArtifactId: review.id,
        priority,
        confidence,
        status: "open",
        category: "lens_adjustment",
        title,
        description: `Lens "${entry.lens}" lifecycle recommendation: ${entry.recommendation}. ${entry.reason}`,
        evidenceRefs: [review.id],
        operatorGuidance:
          entry.recommendation === "retire"
            ? `Consider retiring the "${entry.lens}" lens. Review the historical evidence before any governance change.`
            : `Consider demoting the "${entry.lens}" lens. Review the historical evidence before any governance change.`,
        expectedBenefit:
          entry.recommendation === "retire"
            ? "Removes a low-signal lens from the governance surface, reducing review noise."
            : "Reduces false-alarm load on operators without removing the lens entirely.",
        risks: [
          "Removing or demoting a lens may reduce coverage of the failure mode it targeted.",
          "Sample size and predictive value thresholds are heuristic — confirm with current operator review load.",
        ],
      });
    }
  }
  return recs;
}

// ---------------------------------------------------------------------------
// 2. DriftRecommendations
// ---------------------------------------------------------------------------

/**
 * For each GovernanceDriftReport, emit one Recommendation per finding with
 * severity "high" or "critical". Low/medium findings are not flagged.
 */
export function generateDriftRecommendations(
  reports: GovernanceDriftReport[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const report of reports) {
    for (const finding of report.findings) {
      if (finding.severity !== "high" && finding.severity !== "critical") {
        continue;
      }

      let category: Recommendation["category"];
      if (finding.driftType === "confidence_drift") {
        category = "confidence_calibration";
      } else if (finding.driftType === "chain_coverage_drop") {
        category = "chain_restoration";
      } else {
        category = "governance_integrity";
      }

      recs.push({
        id: shortId("rec_drift", report.generatedAt),
        source: "drift",
        sourceArtifactId: report.id,
        priority: finding.severity,
        confidence: clamp01(finding.confidence),
        status: "open",
        category,
        title: truncate(finding.description, TITLE_MAX),
        description: finding.description,
        operatorGuidance: "Review finding and consider remediation",
        evidenceRefs: [...finding.evidenceRefs],
        expectedBenefit:
          "Restores calibration or coverage that has degraded below the configured threshold.",
        risks: [
          "Remediation may require touching calibration or evidence-chain pipelines.",
          "Operator review is required before any governance change.",
        ],
      });
    }
  }
  return recs;
}

// ---------------------------------------------------------------------------
// 3. IntegrityRecommendations
// ---------------------------------------------------------------------------

interface IntegrityMetric {
  key: "provenanceRate" | "explanationRate" | "outcomeLinkRate";
  label: string;
  category: Recommendation["category"];
}

const INTEGRITY_METRICS: IntegrityMetric[] = [
  { key: "provenanceRate", label: "Provenance rate", category: "chain_restoration" },
  { key: "explanationRate", label: "Explanation rate", category: "governance_integrity" },
  { key: "outcomeLinkRate", label: "Outcome link rate", category: "governance_integrity" },
];

/**
 * For each GovernanceIntegrityReport, emit one Recommendation per metric
 * whose rate is below 60%.
 */
export function generateIntegrityRecommendations(
  reports: GovernanceIntegrityReport[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const report of reports) {
    for (const m of INTEGRITY_METRICS) {
      const rate = report.metrics[m.key];
      if (!Number.isFinite(rate) || rate >= 60) continue;

      const priority: Recommendation["priority"] = rate < 40 ? "high" : "medium";
      const confidence = clamp01(1 - rate / 100);

      recs.push({
        id: shortId("rec_integrity", report.generatedAt),
        source: "integrity",
        sourceArtifactId: report.id,
        priority,
        confidence,
        status: "open",
        category: m.category,
        title: `${m.label} at ${rate}%`,
        description:
          `${m.label} is ${rate}% (threshold: 60%). ` +
          `This indicates that governance review artifacts in the analysis window are not carrying the expected ${m.label.toLowerCase()}.`,
        operatorGuidance:
          "Investigate the review pipeline to determine why this rate is below threshold before any governance change.",
        evidenceRefs: [report.id],
        expectedBenefit:
          "Improves traceability and operator confidence in governance review artifacts.",
        risks: [
          "Remediation may require changes to the explain or evidence-chain pipeline.",
          "Operator review is required before any governance change.",
        ],
      });
    }
  }
  return recs;
}

// ---------------------------------------------------------------------------
// 4. HealthRecommendations
// ---------------------------------------------------------------------------

interface HealthLayer {
  key: "dashboardIntegrityScore" | "explanationCompleteness" | "evidenceChainUsage";
  label: string;
}

const HEALTH_LAYERS: HealthLayer[] = [
  { key: "dashboardIntegrityScore", label: "dashboard integrity" },
  { key: "explanationCompleteness", label: "explanation completeness" },
  { key: "evidenceChainUsage", label: "evidence chain usage" },
];

/**
 * For each GovernanceHealthReport, find the weakest of the three source
 * metrics. If the weakest is below 50% (scaled to 0-100), emit one
 * Recommendation. Skip when all metrics are null.
 */
export function generateHealthRecommendations(
  reports: GovernanceHealthReport[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const report of reports) {
    let weakest: { layer: HealthLayer; value: number } | null = null;
    for (const layer of HEALTH_LAYERS) {
      const raw = report.sourceMetrics[layer.key];
      if (raw == null || !Number.isFinite(raw)) continue;
      if (weakest === null || raw < weakest.value) {
        weakest = { layer, value: raw };
      }
    }
    if (weakest === null) continue;
    if (weakest.value >= 50) continue;

    const priority: Recommendation["priority"] = weakest.value < 30 ? "high" : "medium";

    recs.push({
      id: shortId("rec_health", report.generatedAt),
      source: "health",
      sourceArtifactId: report.id,
      priority,
      confidence: clamp01(1 - weakest.value / 100),
      status: "open",
      category: "policy_coverage",
      title: `Governance layer at ${weakest.value}% availability`,
      description: `Weakest layer: ${weakest.layer.label} at ${weakest.value}%`,
      operatorGuidance:
        "Investigate why this layer is degraded before any governance change.",
      evidenceRefs: [report.id],
      expectedBenefit:
        "Restores coverage of a degraded governance layer above the configured threshold.",
      risks: [
        "Remediation may require changes to the dashboard, explanation, or evidence-chain pipeline.",
        "Operator review is required before any governance change.",
      ],
    });
  }
  return recs;
}

// ---------------------------------------------------------------------------
// generateRecommendations — top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Read P9.0 analysis artifacts from GovernanceStore, run the four source
 * adapters, assemble a single GovernanceRecommendation, and append it to
 * the store. Returns the assembled artifact.
 */
export async function generateRecommendations(opts: {
  cwd?: string;
  windowDays?: number;
  generatedAt?: string;
  store?: GovernanceStore;
}): Promise<GovernanceRecommendation> {
  // Note: opts.cwd is accepted for API symmetry with other P9.0
  // generators. GovernanceStore already resolves its path via the
  // default `.alix/governance/` directory; when an explicit store is
  // provided it is used as-is.
  void opts.cwd;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const generatedAt = opts.generatedAt ?? now();
  const store = opts.store ?? new GovernanceStore();

  const [lensReviews, drift, integrity, health] = await Promise.all([
    store.queryByWindow("lensReviews", windowDays),
    store.queryByWindow("drift", windowDays),
    store.queryByWindow("integrity", windowDays),
    store.queryByWindow("health", windowDays),
  ]);

  const recommendations: Recommendation[] = [
    ...generateLensRecommendations(lensReviews),
    ...generateDriftRecommendations(drift),
    ...generateIntegrityRecommendations(integrity),
    ...generateHealthRecommendations(health),
  ];

  const artifact: GovernanceRecommendation = {
    id: shortId("recommendation", generatedAt),
    subject: "Governance Recommendations",
    outcome: "computed",
    confidence: meanConfidence(recommendations),
    reasons: ["P9.1 advisory layer"],
    generatedAt,
    reportType: "governance_recommendation",
    recommendations,
  };

  await store.append("recommendations", artifact);

  return artifact;
}
