/**
 * dataset.ts — Journal × labels → calibration dataset (J4 task 27).
 *
 * Joins observed decisions with their ground-truth labels, and exports the
 * result as a portable artifact. Everything that cannot be calibrated is
 * counted in `skipped` rather than silently dropped, so an empty dataset is
 * always explainable.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DecisionJournalRecord } from "../journal.js";
import type { DecisionType, RiskContext } from "../contracts.js";
import type { DecisionJournalStore } from "../journal.js";
import type { OutcomeLabelStore } from "./label-store.js";
import {
  indexLabelsByDecisionId,
  type DecisionOutcomeLabel,
} from "./labels.js";

/** Native result primitive, which determines how a sample is calibrated. */
export type CalibrationSampleKind = "choice" | "score" | "noul";

export type CalibrationSample = {
  decisionId: string;
  decision: DecisionType;
  engineId: string;
  engineVersion?: string;
  thresholdProfile?: string;
  /** Which native result the decision produced. */
  kind: CalibrationSampleKind;
  /** Choice/Score confidence, when the engine emitted one. */
  confidence?: number;
  /** Noul probability. */
  probability?: number;
  /** Score rubric rating (the native score of a `score` result). */
  score?: number;
  /** Ground truth. */
  correct: boolean;
  /** Risk context captured at decision time. */
  risk?: RiskContext;
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

function nativeFields(outcome: DecisionJournalRecord["outcome"]): {
  kind: CalibrationSampleKind;
  confidence?: number;
  probability?: number;
  score?: number;
} {
  switch (outcome.kind) {
    case "choice":
      return {
        kind: "choice",
        ...(outcome.confidence !== undefined ? { confidence: outcome.confidence } : {}),
      };
    case "score":
      return {
        kind: "score",
        score: outcome.score,
        ...(outcome.confidence !== undefined ? { confidence: outcome.confidence } : {}),
      };
    case "noul":
      return { kind: "noul", probability: outcome.probability };
    case "failure":
      // Callers must filter failures before calling; kept exhaustive for types.
      return { kind: "choice" };
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
      ...nativeFields(record.outcome),
      correct: label.label === "correct",
      ...(record.risk !== undefined ? { risk: record.risk } : {}),
    });
  }

  return { samples, skipped };
}

export type CalibrationExport = CalibrationDataset & {
  exportedAt: number;
  filters: { decision?: DecisionType; engineId?: string };
};

/**
 * Query both stores and produce a portable calibration artifact. When
 * `outPath` is given the artifact is written as JSON (parent dirs created).
 */
export async function exportCalibrationDataset(
  deps: { journal: Pick<DecisionJournalStore, "readAll">; labels: OutcomeLabelStore },
  opts?: {
    decision?: DecisionType;
    engineId?: string;
    outPath?: string;
    now?: number;
  },
): Promise<CalibrationExport> {
  const records = deps.journal.readAll();
  const { labels } = await deps.labels.readAll();
  const dataset = buildCalibrationDataset(records, labels, {
    ...(opts?.decision !== undefined ? { decision: opts.decision } : {}),
    ...(opts?.engineId !== undefined ? { engineId: opts.engineId } : {}),
  });
  const artifact: CalibrationExport = {
    ...dataset,
    exportedAt: opts?.now ?? Date.now(),
    filters: {
      ...(opts?.decision !== undefined ? { decision: opts.decision } : {}),
      ...(opts?.engineId !== undefined ? { engineId: opts.engineId } : {}),
    },
  };
  if (opts?.outPath !== undefined) {
    await mkdir(join(opts.outPath, ".."), { recursive: true });
    await writeFile(opts.outPath, JSON.stringify(artifact, null, 2), "utf8");
  }
  return artifact;
}
