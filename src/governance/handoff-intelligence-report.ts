/**
 * P22.4 — Handoff Intelligence Report.
 *
 * Composes P22.1–P22.3 into a single read-only report.
 * No filesystem, audit, CLI, or execution imports.
 */

import type { HandoffIntelligenceRef } from "./handoff-intelligence-types.js";
import type { HumanExecutionEvidenceRef } from "./human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "./human-execution-closure-types.js";
import { aggregateClosureOutcomes } from "./handoff-outcome-aggregate.js";
import { detectHandoffQualitySignals } from "./handoff-quality-signals.js";
import { calibrateReadiness } from "./handoff-readiness-calibration.js";
import type { HandoffOutcomeAggregate } from "./handoff-intelligence-types.js";
import type { HandoffQualitySignal } from "./handoff-quality-signals.js";
import type { ReadinessCalibrationSignal } from "./handoff-readiness-calibration.js";

export const INTELLIGENCE_SCHEMA_VERSION = "p22.4-1";

export interface HandoffIntelligenceReport {
  schemaVersion: string;
  windowStart: string;
  windowEnd: string;
  outcomeAggregate: HandoffOutcomeAggregate;
  qualitySignals: HandoffQualitySignal[];
  readinessCalibration: ReadinessCalibrationSignal[];
  summary: {
    totalQualitySignals: number;
    totalCalibrationSignals: number;
    overconfidentCount: number;
    underconfidentCount: number;
    accurateCount: number;
    criticalSignals: number;
    warningSignals: number;
    infoSignals: number;
  };
}

export function buildHandoffIntelligenceReport(
  handoffRefs: HandoffIntelligenceRef[],
  evidenceRefs: HumanExecutionEvidenceRef[],
  closureReviews: HumanExecutionClosureReview[],
  options: {
    since?: string;
    until?: string;
    now?: string;
    slowClosureDays?: number;
  } = {},
): HandoffIntelligenceReport {
  const now = options.now ?? new Date().toISOString();
  const windowEnd = options.until ?? now;
  const windowStart =
    options.since ??
    new Date(Date.parse(windowEnd) - 7 * 24 * 60 * 60 * 1000).toISOString();

  const outcomeAggregate = aggregateClosureOutcomes(
    handoffRefs, evidenceRefs, closureReviews, windowStart, windowEnd,
  );

  const qualitySignals = detectHandoffQualitySignals(
    handoffRefs, evidenceRefs, closureReviews,
    { slowClosureDays: options.slowClosureDays, detectedAt: now },
  );

  const readinessCalibration = calibrateReadiness(handoffRefs, closureReviews);

  const overconfidentCount = readinessCalibration.filter((c) => c.calibration === "overconfident").length;
  const underconfidentCount = readinessCalibration.filter((c) => c.calibration === "underconfident").length;
  const accurateCount = readinessCalibration.filter((c) => c.calibration === "accurate").length;

  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    windowStart,
    windowEnd,
    outcomeAggregate,
    qualitySignals,
    readinessCalibration,
    summary: {
      totalQualitySignals: qualitySignals.length,
      totalCalibrationSignals: readinessCalibration.length,
      overconfidentCount,
      underconfidentCount,
      accurateCount,
      criticalSignals: qualitySignals.filter((s) => s.severity === "critical").length,
      warningSignals: qualitySignals.filter((s) => s.severity === "warning").length,
      infoSignals: qualitySignals.filter((s) => s.severity === "info").length,
    },
  };
}
