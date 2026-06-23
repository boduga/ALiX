/**
 * P9.0e — LensLifecycleReview.
 *
 * Consumes LearningStore.queryProfiles({ windowDays }) for calibration profiles.
 * P8 adapters already convert raw review data into calibrated observations;
 * the lens review consumes the calibrated layer, not raw governance artifacts.
 *
 * Thresholds (from SDS):
 *   - PV > 0.7 and reviewsAnalyzed > 20 → promote
 *   - PV < 0.4 and reviewsAnalyzed > 20 → demote
 *   - PV < 0.2 and reviewsAnalyzed > 30 → retire
 *   - falseAlarms > 10 and falseAlarmRate > 0.4 → demote
 *   - Default: keep
 *
 * Core invariant: Learning ≠ Mutation. This builder reads calibration
 * profiles only — no writes, no proposals, no store mutations.
 *
 * @module
 */

import { join } from "node:path";
import { LearningStore } from "../learning/learning-store.js";
import type { LensName } from "../adaptation/governance-review-types.js";
import type { LensLifecycleReview } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNING_DIR = join(".alix", "learning");

const ALL_LENS_NAMES: LensName[] = [
  "red_team",
  "historian",
  "policy_auditor",
  "confidence_critic",
];

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
// reviewLenses
// ---------------------------------------------------------------------------

export async function reviewLenses(opts: {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}): Promise<LensLifecycleReview> {
  const cwd = opts.cwd;
  const windowDays = opts.windowDays ?? 90;
  const generatedAt = opts.generatedAt ?? now();

  // 1. Read calibration profiles from LearningStore
  const learningStore = new LearningStore(join(cwd, LEARNING_DIR));
  const profiles = await learningStore.queryProfiles({ windowDays }).catch(() => []);

  // 2. Filter governance_lens_weight profiles only.
  //    P8 adapters produce these with targetName = lens name.
  const lensProfiles = profiles.filter(
    (p) => p.target === "governance_lens_weight",
  );

  // 3. If no profiles at all, return empty review
  if (lensProfiles.length === 0) {
    return {
      id: shortId("lens_review"),
      subject: "Lens Lifecycle Review",
      outcome: "computed",
      confidence: 1,
      reasons: [
        "No calibration profiles found for governance lenses in the analysis window",
      ],
      generatedAt,
      reportType: "lens_lifecycle",
      lensReviews: [],
    };
  }

  // 4. Compute per-lens metrics from calibration profiles
  const lensReviews = ALL_LENS_NAMES.map((lensName) => {
    const matching = lensProfiles.filter((p) => p.targetName === lensName);

    // Sort newest first
    matching.sort(
      (a, b) =>
        new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );

    // Predictive value: confidence of the most recent profile
    const predictiveValue =
      matching.length > 0
        ? Math.round(matching[0].confidence * 1000) / 1000
        : 0;

    // Reviews analyzed: total unique source signal IDs across profiles
    const reviewsAnalyzed = matching.reduce(
      (sum, p) => sum + p.sourceSignalIds.length,
      0,
    );

    // False alarms: count of profiles driven by high-false-positive signals.
    // Profiles carry sourceSignalIds that map back to signals; the count is
    // derived from the number of profiles where reason indicates false alarms.
    const falseAlarms = matching.filter(
      (p) =>
        p.reason.toLowerCase().includes("false") ||
        p.reason.toLowerCase().includes("alarm"),
    ).length;

    // Missed failures: profiles where reason indicates misses.
    const missedFailures = matching.filter(
      (p) =>
        p.reason.toLowerCase().includes("miss") ||
        p.reason.toLowerCase().includes("failure"),
    ).length;

    const falseAlarmRate =
      reviewsAnalyzed > 0 ? falseAlarms / reviewsAnalyzed : 0;

    // 5. Apply thresholds (ordered: falseAlarms → promote → retire → demote → keep)
    let recommendation: "keep" | "promote" | "demote" | "retire" = "keep";
    let reason = "";

    if (falseAlarms > 10 && falseAlarmRate > 0.4) {
      recommendation = "demote";
      reason = `Excessive false alarms (${falseAlarms}, rate: ${(falseAlarmRate * 100).toFixed(1)}%)`;
    } else if (predictiveValue > 0.7 && reviewsAnalyzed > 20) {
      recommendation = "promote";
      reason = `High predictive value (${predictiveValue}) with sufficient sample (${reviewsAnalyzed} reviews)`;
    } else if (predictiveValue < 0.2 && reviewsAnalyzed > 30) {
      recommendation = "retire";
      reason = `Very low predictive value (${predictiveValue}) after ${reviewsAnalyzed} reviews`;
    } else if (predictiveValue < 0.4 && reviewsAnalyzed > 20) {
      recommendation = "demote";
      reason = `Low predictive value (${predictiveValue}) with ${reviewsAnalyzed} reviews`;
    } else if (matching.length > 0) {
      reason = `Stable performance: PV=${predictiveValue}, ${reviewsAnalyzed} reviews analyzed`;
    } else {
      reason = `No calibration data for ${lensName} in the analysis window`;
    }

    return {
      lens: lensName,
      predictiveValue,
      reviewsAnalyzed,
      falseAlarms,
      missedFailures,
      recommendation,
      reason,
    };
  });

  return {
    id: shortId("lens_review"),
    subject: "Lens Lifecycle Review",
    outcome: "computed",
    confidence: 1,
    reasons: [
      "Lens lifecycle review based on calibration profiles from P8 adapters",
    ],
    generatedAt,
    reportType: "lens_lifecycle",
    lensReviews,
  };
}
