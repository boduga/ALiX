/**
 * P22.3 — Readiness Calibration.
 *
 * Advisory-only comparison of P19 readiness projections against P21 closure
 * outcomes. Produces calibration signals — never mutates policies, thresholds,
 * or assessments.
 */

import type { HandoffIntelligenceRef } from "./handoff-intelligence-types.js";
import type { HumanExecutionClosureReview } from "./human-execution-closure-types.js";
import type { ExecutionReadinessLevel } from "./execution-readiness.js";

export type CalibrationLabel = "overconfident" | "underconfident" | "accurate";

export interface ReadinessCalibrationSignal {
  handoffId: string;
  planId: string;
  readinessLevel: ExecutionReadinessLevel;
  closureDecision: string;
  calibration: CalibrationLabel;
  evidenceComplete: boolean;
  evidenceCount: number;
}

function calibrateOne(
  readinessLevel: ExecutionReadinessLevel,
  closureDecision: string,
): CalibrationLabel {
  switch (readinessLevel) {
    case "dry_run_capable":
    case "reversible":
      switch (closureDecision) {
        case "accepted": return "accurate";
        case "rejected": return "overconfident";
        case "incomplete": return "overconfident";
        case "needs_follow_up": return "overconfident";
        default: return "accurate";
      }

    case "manual_only":
      switch (closureDecision) {
        case "accepted": return "underconfident";
        case "rejected": return "accurate";
        case "incomplete": return "accurate";
        case "needs_follow_up": return "accurate";
        default: return "accurate";
      }

    case "external_side_effecting":
    case "irreversible":
      // These levels should not reach manual execution handoff.
      // If they did, any closure is unexpected — flag as overconfident.
      return "overconfident";

    default:
      // Unknown readiness level — excluded
      return "accurate";
  }
}

export function calibrateReadiness(
  handoffRefs: HandoffIntelligenceRef[],
  closureReviews: HumanExecutionClosureReview[],
): ReadinessCalibrationSignal[] {
  // Index reviews by handoffId (sorted)
  const revByHandoff = new Map<string, HumanExecutionClosureReview[]>();
  for (const rev of closureReviews) {
    const list = revByHandoff.get(rev.handoffId) ?? [];
    list.push(rev);
    revByHandoff.set(rev.handoffId, list);
  }

  // Sort each list deterministically
  for (const [id, list] of revByHandoff) {
    revByHandoff.set(
      id,
      list.sort(
        (a, b) =>
          a.reviewedAt.localeCompare(b.reviewedAt) ||
          a.closureReviewId.localeCompare(b.closureReviewId),
      ),
    );
  }

  const signals: ReadinessCalibrationSignal[] = [];

  for (const ref of handoffRefs) {
    const reviews = revByHandoff.get(ref.handoffId);

    // Skip handoffs without any closure review
    if (!reviews || reviews.length === 0) continue;

    const latestReview = reviews[reviews.length - 1]!;
    const calibration = calibrateOne(ref.readinessLevel, latestReview.decision);

    const evidenceCount = latestReview.evidenceIds.length;
    const evidenceComplete = evidenceCount > 0;

    signals.push({
      handoffId: ref.handoffId,
      planId: ref.planId,
      readinessLevel: ref.readinessLevel,
      closureDecision: latestReview.decision,
      calibration,
      evidenceComplete,
      evidenceCount,
    });
  }

  // Deterministic sort: calibration priority (overconfident first) → handoffId
  const calibrationOrder: Record<CalibrationLabel, number> = {
    overconfident: 0,
    underconfident: 1,
    accurate: 2,
  };
  signals.sort((a, b) => {
    const cp = calibrationOrder[a.calibration] - calibrationOrder[b.calibration];
    if (cp !== 0) return cp;
    return a.handoffId.localeCompare(b.handoffId);
  });

  return signals;
}
