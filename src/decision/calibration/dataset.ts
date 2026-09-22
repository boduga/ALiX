/**
 * dataset.ts — Journal × labels → calibration dataset (J4 task 27).
 *
 * Joins observed decisions with their ground-truth labels. Everything that
 * cannot be calibrated is counted in `skipped` rather than silently dropped,
 * so an empty dataset is always explainable.
 */

import type { DecisionJournalRecord } from "../journal.js";
import type { DecisionType } from "../contracts.js";
import {
  indexLabelsByDecisionId,
  type DecisionOutcomeLabel,
  type RiskContext,
} from "./labels.js";

export type CalibrationSample = {
  decisionId: string;
  decision: DecisionType;
  engineId: string;
  engineVersion?: string;
  thresholdProfile?: string;
  /** Native confidence (choice/score). Absent for Noul and for engines that emit none. */
  confidence?: number;
  /** Native probability (noul). */
  probability?: number;
  /** Ground truth. */
  correct: boolean;
  risk?: RiskContext;
  latencyMs: number;
  remote: boolean;
};

export type CalibrationSkipReasons = {
  unlabeled: number;
  unknownLabel: number;
  failureOutcome: number;
  duplicateDecisionId: number;
};

export type CalibrationDataset = {
  samples: CalibrationSample[];
  skipped: CalibrationSkipReasons;
};

function nativeScore(outcome: DecisionJournalRecord["outcome"]): {
  confidence?: number;
  probability?: number;
} {
  switch (outcome.kind) {
    case "choice":
      return outcome.confidence !== undefined ? { confidence: outcome.confidence } : {};
    case "score":
      return outcome.confidence !== undefined ? { confidence: outcome.confidence } : {};
    case "noul":
      return { probability: outcome.probability };
    case "failure":
      return {};
  }
}

/**
 * Join records with labels. Labels are keyed by decisionId (latest wins).
 * Failure outcomes and unlabeled/unknown records are counted, not calibrated.
 */
export function buildCalibrationDataset(
  records: readonly DecisionJournalRecord[],
  labels: readonly DecisionOutcomeLabel[],
  opts?: { decision?: DecisionType; engineId?: string },
): CalibrationDataset {
  const byId = indexLabelsByDecisionId(labels);
  const skipped: CalibrationSkipReasons = {
    unlabeled: 0,
    unknownLabel: 0,
    failureOutcome: 0,
    duplicateDecisionId: 0,
  };
  const samples: CalibrationSample[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    if (opts?.decision !== undefined && record.decision !== opts.decision) continue;
    if (opts?.engineId !== undefined && record.engineId !== opts.engineId) continue;

    if (record.outcome.kind === "failure") {
      skipped.failureOutcome += 1;
      continue;
    }
    const label = byId.get(record.decisionId);
    if (!label) {
      skipped.unlabeled += 1;
      continue;
    }
    if (label.label === "unknown") {
      skipped.unknownLabel += 1;
      continue;
    }
    if (seen.has(record.decisionId)) {
      skipped.duplicateDecisionId += 1;
      continue;
    }
    seen.add(record.decisionId);

    samples.push({
      decisionId: record.decisionId,
      decision: record.decision,
      engineId: record.engineId,
      ...(record.engineVersion !== undefined ? { engineVersion: record.engineVersion } : {}),
      ...(record.thresholdProfile !== undefined ? { thresholdProfile: record.thresholdProfile } : {}),
      ...nativeScore(record.outcome),
      correct: label.label === "correct",
      ...(label.risk !== undefined ? { risk: label.risk } : {}),
      latencyMs: record.latencyMs,
      remote: record.remote,
    });
  }

  return { samples, skipped };
}
