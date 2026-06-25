/**
 * P9.6 — InvestigationGenerator.
 *
 * Produces InvestigationRecommendation records from governance analysis
 * artifacts (drift reports, integrity reports). Parallel to
 * governance-recommendation-generator.ts but writes to InvestigationStore
 * instead of GovernanceStore.
 *
 * Core invariants:
 *  - Reads from GovernanceStore (drift + integrity artifacts).
 *  - Writes only to InvestigationStore.
 *  - Does NOT write to GovernanceStore.
 *
 * @module
 */

import { GovernanceStore } from "./governance-store.js";
import { InvestigationStore } from "./investigation-store.js";
import type {
  InvestigationRecommendation,
  InvestigationKind,
} from "./investigation-types.js";
import type { GovernanceDriftReport, GovernanceIntegrityReport } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(prefix: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

// ---------------------------------------------------------------------------
// 1. Drift Investigations
// ---------------------------------------------------------------------------

const DRIFT_KIND_MAP: Record<string, InvestigationKind> = {
  chain_coverage_drop: "chain_restoration",
};

function clampDriftSeverity(severity: string): "low" | "medium" | "high" | "critical" {
  if (severity === "critical" || severity === "high") return severity;
  if (severity === "medium") return "medium";
  return "low";
}

/**
 * For each GovernanceDriftReport, emit one InvestigationRecommendation per
 * finding with severity "high" or "critical". Low/medium findings are skipped.
 * chain_coverage_drop → chain_restoration; everything else → governance_integrity.
 */
export function generateDriftInvestigations(
  reports: GovernanceDriftReport[],
  generatedAt: string,
): InvestigationRecommendation[] {
  const results: InvestigationRecommendation[] = [];

  for (const report of reports) {
    for (const finding of report.findings) {
      if (finding.severity !== "high" && finding.severity !== "critical") continue;

      const kind = DRIFT_KIND_MAP[finding.driftType] ?? "governance_integrity";
      const id = shortId("inv_drift", generatedAt);

      results.push({
        id,
        kind,
        status: "open",
        severity: clampDriftSeverity(finding.severity),
        source: "drift",
        sourceArtifactId: report.id,
        evidenceRefs: [...finding.evidenceRefs],
        title: finding.description.length > 60 ? finding.description.slice(0, 57) + "…" : finding.description,
        description: finding.description,
        operatorGuidance:
          kind === "chain_restoration"
            ? "Investigate why proposals are bypassing evidence chain provenance."
            : "Investigate the governance review pipeline to determine root cause.",
        createdAt: generatedAt,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. Integrity Investigations
// ---------------------------------------------------------------------------

interface IntegrityMetric {
  key: "provenanceRate" | "explanationRate" | "outcomeLinkRate";
  label: string;
  kind: InvestigationKind;
}

const INTEGRITY_METRICS: IntegrityMetric[] = [
  { key: "provenanceRate", label: "Provenance rate", kind: "chain_restoration" },
  { key: "explanationRate", label: "Explanation rate", kind: "governance_integrity" },
  { key: "outcomeLinkRate", label: "Outcome link rate", kind: "governance_integrity" },
];

function clampIntegritySeverity(rate: number): "low" | "medium" | "high" | "critical" {
  if (rate < 30) return "high";
  return "medium";
}

/**
 * For each GovernanceIntegrityReport, emit one InvestigationRecommendation
 * per metric whose rate is below 60%.
 */
export function generateIntegrityInvestigations(
  reports: GovernanceIntegrityReport[],
  generatedAt: string,
): InvestigationRecommendation[] {
  const results: InvestigationRecommendation[] = [];

  for (const report of reports) {
    for (const m of INTEGRITY_METRICS) {
      const rate = report.metrics[m.key];
      if (!Number.isFinite(rate) || rate >= 60) continue;

      const id = shortId("inv_integrity", generatedAt);

      results.push({
        id,
        kind: m.kind,
        status: "open",
        severity: clampIntegritySeverity(rate),
        source: "integrity",
        sourceArtifactId: report.id,
        evidenceRefs: [report.id],
        title: `${m.label} at ${rate}%`,
        description:
          `${m.label} is ${rate}% (threshold: 60%). ` +
          `Governance review artifacts are not carrying the expected ${m.label.toLowerCase()}.`,
        operatorGuidance:
          m.kind === "chain_restoration"
            ? "Investigate why proposals are bypassing evidence chain provenance."
            : "Investigate the review pipeline to determine why this rate is below threshold.",
        createdAt: generatedAt,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// generateInvestigations — top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Read P9.0 drift + integrity artifacts from GovernanceStore, run two
 * investigation producers, write results to InvestigationStore.
 *
 * Returns the generated InvestigationRecommendation[] array.
 */
export async function generateInvestigations(opts: {
  cwd?: string;
  windowDays?: number;
  generatedAt?: string;
  store?: GovernanceStore;
  investigationStore?: InvestigationStore;
}): Promise<InvestigationRecommendation[]> {
  void opts.cwd;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const genAt = opts.generatedAt ?? new Date().toISOString();
  const store = opts.store ?? new GovernanceStore();
  const invStore = opts.investigationStore ?? new InvestigationStore();

  const [drift, integrity] = await Promise.all([
    store.queryByWindow("drift", windowDays),
    store.queryByWindow("integrity", windowDays),
  ]);

  const investigations: InvestigationRecommendation[] = [
    ...generateDriftInvestigations(drift, genAt),
    ...generateIntegrityInvestigations(integrity, genAt),
  ];

  // Write each investigation to InvestigationStore
  for (const inv of investigations) {
    await invStore.save(inv);
  }

  return investigations;
}
