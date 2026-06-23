/**
 * P9.0b — GovernanceHealthBuilder.
 *
 * Pure read-only builder that produces a GovernanceHealthReport from P8 stores.
 * Consumes the dashboard aggregator, GovernanceReviewStore, OutcomeStore, and
 * LearningStore. Never writes or mutates.
 *
 * Core invariant: totalProposals comes from OutcomeStore (unique subjectIds)
 * only — proposals that never reach an outcome are outside the governed surface.
 *
 * @module
 */

import { join } from "node:path";
import { buildDashboardReport } from "../learning/learning-dashboard.js";
import { GovernanceReviewStore } from "../adaptation/governance-review-store.js";
import { OutcomeStore } from "../adaptation/outcome-store.js";
import { LearningStore } from "../learning/learning-store.js";
import type { GovernanceHealthReport } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}:${rand}`;
}

// ---------------------------------------------------------------------------
// buildGovernanceHealth
// ---------------------------------------------------------------------------

export async function buildGovernanceHealth(opts: {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}): Promise<GovernanceHealthReport> {
  const cwd = opts.cwd;
  const windowDays = opts.windowDays ?? 90;
  const generatedAt = opts.generatedAt ?? now();

  // 1. Dashboard aggregator → integrity score + explanation metrics
  const dashboard = await buildDashboardReport({
    cwd,
    windowDays,
    generatedAt,
  });

  const avgCompleteness = dashboard.explanationIntegrity.averageCompleteness;
  const evidenceChainUsage = dashboard.explanationIntegrity.evidenceChainUsage;
  const incompleteChainLayers = dashboard.explanationIntegrity.incompleteChainCount;

  // 2. GovernanceReviewStore → totalReviews inside window
  const GOV_REVIEWS_DIR = join(cwd, ".alix", "governance-reviews");
  const reviewStore = new GovernanceReviewStore(GOV_REVIEWS_DIR);
  const windowReviews = await reviewStore.queryByWindow(windowDays);
  const totalReviews = windowReviews.length;

  // 3. OutcomeStore → totalProposals (unique subjectIds only)
  const OUTCOMES_DIR = join(cwd, ".alix", "adaptation", "outcomes");
  const outcomeStore = new OutcomeStore(OUTCOMES_DIR);
  const allOutcomes = await outcomeStore.list().catch(() => []);
  const uniqueSubjectIds = new Set(allOutcomes.map((o) => o.subjectId));
  const totalProposals = uniqueSubjectIds.size;

  // 4. LearningStore → per-lens predictiveValue from calibration profiles
  const LEARNING_DIR = join(cwd, ".alix", "learning");
  const learningStore = new LearningStore(LEARNING_DIR);
  const profiles = await learningStore.queryProfiles({ windowDays }).catch(() => []);

  // Build lensEffectiveness: group governance_lens_weight profiles by targetName,
  // using the most recent profile's confidence as the predictive value.
  const lensEffectiveness: Record<string, number> = {};
  const lensProfiles = profiles.filter(
    (p) => p.target === "governance_lens_weight",
  );
  // Sort newest first so the first per lens is the most recent
  lensProfiles.sort(
    (a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
  );
  const seenLenses = new Set<string>();
  for (const p of lensProfiles) {
    if (!seenLenses.has(p.targetName)) {
      seenLenses.add(p.targetName);
      lensEffectiveness[p.targetName] = Math.round(p.confidence * 1000) / 10;
    }
  }

  // 5. policyCoverage: average availability of outcome + recommendation + risk + governance layers
  const governingLayers = ["outcome", "recommendation", "risk", "governance"];
  const layerAvail = dashboard.explanationIntegrity.layerAvailability;
  let policyCoverage = 0;
  let coverageCount = 0;
  for (const layer of governingLayers) {
    if (layerAvail[layer] !== undefined) {
      policyCoverage += layerAvail[layer];
      coverageCount++;
    }
  }
  if (coverageCount > 0) {
    policyCoverage = Math.round((policyCoverage / coverageCount) * 10) / 10;
  }

  // 6. Assemble the report
  const report: GovernanceHealthReport = {
    id: shortId("gov_health"),
    subject: "Governance Health",
    outcome: "computed",
    confidence: 1,
    reasons: [
      "Objective measurements from P8 stores: dashboard aggregation, governance reviews, outcomes, and calibration profiles",
    ],
    generatedAt,
    reportType: "governance_health",
    totalReviews,
    totalProposals,
    lensEffectiveness,
    policyCoverage,
    sourceMetrics: {
      dashboardIntegrityScore: dashboard.dashboardIntegrityScore,
      explanationCompleteness:
        dashboard.proposalsScanned > 0
          ? Math.round(avgCompleteness * 10) / 10
          : null,
      evidenceChainUsage:
        dashboard.proposalsScanned > 0
          ? Math.round(evidenceChainUsage * 10) / 10
          : null,
      incompleteChainLayers,
    },
  };

  return report;
}
