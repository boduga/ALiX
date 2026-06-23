/**
 * P9.0d — GovernanceDriftDetector.
 *
 * Pure read-only detector that consumes P8 outputs (LearningStore querySignals,
 * queryProfiles, buildDashboardReport) to detect three categories of governance
 * drift: confidence, chain coverage, and lens degradation.
 *
 * Does NOT read GovernanceReviewStore directly for lens drift — P8 adapters
 * are the canonical source for calibrated lens observations.
 *
 * CORE INVARIANT: This module NEVER writes to any store. It returns a
 * GovernanceDriftReport. The report is later written to GovernanceStore
 * by the CLI (Task 6).
 *
 * @module
 */

import { join } from "node:path";
import { LearningStore } from "../learning/learning-store.js";
import { buildDashboardReport } from "../learning/learning-dashboard.js";
import type { GovernanceDriftReport, DriftFinding } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNING_DIR = join(".alix", "learning");

const DEFAULT_WINDOW_DAYS = 90;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// detectGovernanceDrift
// ---------------------------------------------------------------------------

export async function detectGovernanceDrift(opts: {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}): Promise<GovernanceDriftReport> {
  const cwd = opts.cwd;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const generatedAt = opts.generatedAt ?? now();

  const findings: DriftFinding[] = [];

  const learningStore = new LearningStore(join(cwd, LEARNING_DIR));

  // ---- 1. Confidence drift ------------------------------------------------
  // Consumes LearningStore.querySignals filtered to overconfidence/underconfidence.
  const confidenceSignals = await learningStore.querySignals({
    windowDays,
    signalTypes: ["overconfidence", "underconfidence"],
  });

  const overCount = confidenceSignals.filter(
    (s) => s.signalType === "overconfidence",
  ).length;
  const underCount = confidenceSignals.filter(
    (s) => s.signalType === "underconfidence",
  ).length;
  const totalConfidence = overCount + underCount;

  if (totalConfidence > 10) {
    const ratio = overCount / totalConfidence;
    if (ratio > 0.6) {
      // Severity scaled by ratio
      let severity: DriftFinding["severity"];
      if (ratio > 0.9) severity = "critical";
      else if (ratio > 0.75) severity = "high";
      else severity = "medium";

      // Confidence based on sample size
      let confidence: number;
      if (totalConfidence >= 50) confidence = 0.9;
      else if (totalConfidence >= 20) confidence = 0.7;
      else confidence = 0.5;

      findings.push({
        driftType: "confidence_drift",
        detectedAt: generatedAt,
        severity,
        confidence: Math.round(confidence * 100) / 100,
        evidenceRefs: confidenceSignals.slice(0, 5).map((s) => s.id),
        description:
          `Overconfidence ratio ${Math.round(ratio * 1000) / 10}% ` +
          `(${overCount}/${totalConfidence} signals). ` +
          `The model consistently overestimates confidence relative to actual outcomes.`,
        recommendation:
          "Review calibration thresholds. Consider increasing the confidence " +
          "discount multiplier for affected recommendation paths.",
      });
    }
  }

  // ---- 2. Chain coverage drop ---------------------------------------------
  // Consumes buildDashboardReport.explanationIntegrity.evidenceChainUsage.
  const dashboard = await buildDashboardReport({ cwd, windowDays });

  if (dashboard.proposalsScanned > 0) {
    const evidenceChainUsage = dashboard.explanationIntegrity.evidenceChainUsage;

    if (evidenceChainUsage < 60) {
      const severity: DriftFinding["severity"] =
        evidenceChainUsage < 40 ? "high" : "medium";

      findings.push({
        driftType: "chain_coverage_drop",
        detectedAt: generatedAt,
        severity,
        confidence: 0.7,
        evidenceRefs: [],
        description:
          `Evidence chain usage dropped to ${evidenceChainUsage}% ` +
          `across ${dashboard.proposalsScanned} proposals (threshold: 60%). ` +
          `Chain-based provenance is eroding.`,
        recommendation:
          "Investigate why proposals are bypassing evidence chain provenance. " +
          "Verify chain extraction pipeline and ensure new proposals write chain artifacts.",
      });
    }
  }

  // ---- 3. Lens drift ------------------------------------------------------
  // Consumes LearningStore.queryProfiles — P8 adapters are canonical for
  // calibrated lens observations. Does NOT read GovernanceReviewStore directly.
  const profiles = await learningStore.queryProfiles({ windowDays });
  const lensProfiles = profiles.filter(
    (p) => p.target === "governance_lens_weight",
  );

  // Group by targetName, keeping most recent profile per lens.
  lensProfiles.sort(
    (a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
  );
  const seenLenses = new Set<string>();
  for (const profile of lensProfiles) {
    if (seenLenses.has(profile.targetName)) continue;
    seenLenses.add(profile.targetName);

    // Predictive value = profile.confidence (consistent with health-builder).
    const predictiveValue = profile.confidence;
    if (predictiveValue < 0.4) {
      const severity: DriftFinding["severity"] =
        predictiveValue < 0.2 ? "high" : "medium";

      findings.push({
        driftType: "lens_drift",
        detectedAt: generatedAt,
        severity,
        confidence: 0.7,
        evidenceRefs: [profile.id],
        description:
          `Lens "${profile.targetName}" has degraded predictive value ` +
          `(${Math.round(predictiveValue * 1000) / 10}%). ` +
          `P8 adapters calibrated this lens at this low value based on ` +
          `observed governance review patterns.`,
        recommendation:
          `Consider retiring or retraining the "${profile.targetName}" lens. ` +
          `Historical false-alarm or miss patterns may have eroded its predictive power.`,
      });
    }
  }

  // ---- 4. Assemble report -------------------------------------------------
  return {
    id: `gov-drift-${generatedAt}`,
    subject: `Governance Drift Report — ${windowDays}d window`,
    outcome: "informational",
    confidence: 1,
    reasons: [
      `Analyzed ${totalConfidence} confidence signals, ` +
        `${dashboard.proposalsScanned} proposals, ` +
        `${lensProfiles.length} lens profiles across ${windowDays}d window`,
    ],
    generatedAt,
    reportType: "governance_drift",
    findings,
  };
}
