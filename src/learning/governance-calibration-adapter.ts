/**
 * P8.5a.2c — Governance calibration adapter (P8.3).
 *
 * Pure: joins GovernanceReviewStore × OutcomeStore by proposalId, derives
 * `LensObservation[]` from each review's `lensScores × outcome`, feeds
 * `LensCalibrationBuilder` then `GovernanceCalibrationBuilder`, returns
 * `AdapterResult`. Never writes `LearningStore` — orchestrator sole writer.
 *
 * `concernsRaised` is INFERRED (1 for warning verdicts
 * "agree_with_concerns" | "challenge", 0 otherwise) — fidelity is "low".
 * A future P9+ telemetry phase can replace this with real per-lens counts
 * (e.g. each lensScore carries an explicit `concernsRaised` field).
 *
 * Join rule:
 *   proposalId = review.proposalId → OutcomeRecord.subjectId
 *
 * Adapter Purity Invariant: no mutation-surface imports. Sentinel-enforced.
 *
 * @module
 */

import type { GovernanceReview } from "../adaptation/governance-review-types.js";
import type { GovernanceVerdict, LensScore } from "../adaptation/governance-review-types.js";
import type { GovernanceReviewStore } from "../adaptation/governance-review-store.js";
import type { OutcomeStore } from "../adaptation/outcome-store.js";
import type { OutcomeValue } from "../adaptation/outcome-types.js";
import { LensCalibrationBuilder } from "../adaptation/lens-calibration-builder.js";
import type { LensObservation } from "../adaptation/lens-calibration-builder.js";
import { GovernanceCalibrationBuilder } from "./governance-calibration-builder.js";
import type {
  AdapterResult,
  CalibrationAdapter,
} from "./adapter-diagnostics.js";

export interface GovernanceAdapterOptions {
  /** Default 30 — observation window in days for both stores' `queryByWindow`. */
  windowDays?: number;
  /** Injected for determinism in tests; orchestrator passes run's shared ts. */
  generatedAt?: string;
}

const DEFAULT_WINDOW_DAYS = 30;

/**
 * Does this verdict represent a lens that raised a concern?
 * `agree_with_concerns` and `challenge` both indicate the lens saw
 * something worth flagging. `agree` and `insufficient_information` do not.
 *
 * Module-private to this adapter — mirrors the same-name helper in
 * `LensCalibrationBuilder`, which is also module-private. We re-define
 * locally per plan (no cross-file coupling beyond what's typed).
 */
function isWarningVerdict(v: GovernanceVerdict): boolean {
  return v === "agree_with_concerns" || v === "challenge";
}

/**
 * Adapter turns `(GovernanceReview × OutcomeRecord)` pairs into the input
 * shape `GovernanceCalibrationBuilder` expects, then returns the result
 * wrapped in `AdapterResult` diagnostics.
 *
 * One `LensObservation` is emitted per `lensScores` entry in a review whose
 * proposal has an outcome on record. Reviews without a matching outcome
 * are counted as `excludedReasons.noOutcome` and skipped.
 */
export class GovernanceCalibrationAdapter implements CalibrationAdapter {
  constructor(
    private readonly reviewStore: GovernanceReviewStore,
    private readonly outcomeStore: OutcomeStore,
    private readonly lensBuilder: LensCalibrationBuilder = new LensCalibrationBuilder(),
    private readonly govBuilder: GovernanceCalibrationBuilder = new GovernanceCalibrationBuilder(),
  ) {}

  async calibrate(opts?: GovernanceAdapterOptions): Promise<AdapterResult> {
    const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS;
    const generatedAt = opts?.generatedAt ?? new Date().toISOString();

    const reviews = await this.reviewStore.queryByWindow(windowDays);
    const outcomes = await this.outcomeStore.queryByWindow(windowDays);

    // Build outcomeByProposal for O(1) join lookup.
    const outcomeByProposal = new Map<string, OutcomeValue>();
    for (const o of outcomes) {
      outcomeByProposal.set(o.subjectId, o.outcome);
    }

    const observations: LensObservation[] = [];
    let excludedNoOutcome = 0;

    for (const review of reviews as GovernanceReview[]) {
      const outcome = outcomeByProposal.get(review.proposalId);
      if (outcome === undefined) {
        excludedNoOutcome += 1;
        continue;
      }
      for (const ls of review.lensScores as LensScore[]) {
        observations.push({
          lens: ls.lens,
          verdict: ls.recommendedVerdict,
          outcome,
          concernsRaised: isWarningVerdict(ls.recommendedVerdict) ? 1 : 0, // LOW_FIDELITY inference
        });
      }
    }

    const lensReport = this.lensBuilder.build(observations, { windowDays, generatedAt });
    const sourceReportId = `governance-calibration-window-${windowDays}`;
    const built = this.govBuilder.calibrate(lensReport, sourceReportId, generatedAt);

    return {
      signals: built.signals,
      profiles: built.profiles,
      diagnostics: {
        adapter: "governance",
        sourceRecordsRead: reviews.length,
        processed: observations.length,
        excludedReasons: excludedNoOutcome > 0 ? { noOutcome: excludedNoOutcome } : {},
        fidelity: "low",
        notes: [
          "concernsRaised inferred from recommendedVerdict (1=warning, 0=otherwise)",
        ],
      },
    };
  }
}