/**
 * P8.5a.2b — Risk calibration adapter (P8.2).
 *
 * Pure: joins RiskScoreStore × OutcomeStore by proposalId, converts
 * `RiskScore.dimensions: Record<RiskDimension, number>` to `DimensionScore[]`,
 * feeds the pure `RiskCalibrationBuilder`, returns `AdapterResult`. Never
 * writes to `LearningStore` — the orchestrator is the sole writer.
 *
 * Adapter Purity Invariant: file imports NO mutation surface
 * (LearningStore / ProposalStore / ApprovalGate / appliers /
 * AutomaticProposalGenerator / ApprovalRecommendationStore).
 * Sentinel-enforced.
 *
 * @module
 */

import type { RiskScore } from "../adaptation/risk-score-types.js";
import { RISK_DIMENSIONS } from "../adaptation/risk-score-types.js";
import type { RiskScoreStore } from "../adaptation/risk-score-store.js";
import type { OutcomeRecord } from "../adaptation/outcome-types.js";
import type { OutcomeStore } from "../adaptation/outcome-store.js";
import { RiskCalibrationBuilder } from "./risk-calibration-builder.js";
import type {
  RiskOutcomeObservation,
  DimensionScore,
} from "./risk-calibration-builder.js";
import type {
  AdapterResult,
  CalibrationAdapter,
} from "./adapter-diagnostics.js";

export interface RiskAdapterOptions {
  /** Default 30 — observation window in days for both stores' `queryByWindow`. */
  windowDays?: number;
  /** Injected for determinism in tests; orchestrator passes run's shared ts. */
  generatedAt?: string;
}

const DEFAULT_WINDOW_DAYS = 30;

/**
 * Adapter that turns `(RiskScore × OutcomeRecord)` pairs into the input
 * shape the pure `RiskCalibrationBuilder` expects, then returns its result
 * wrapped in `AdapterResult` diagnostics.
 *
 * Join rule:
 *   proposalId = `risk.id.replace(/^risk-/, "")` (mirrors
 *   `risk-score-builder.ts` which writes `id: "risk-${proposalId}"`).
 *   The matching `OutcomeRecord` is the most recent one with
 *   `subjectId === proposalId`. If none exists, the risk score is excluded
 *   (counted in `excludedReasons.noOutcome`) and skipped.
 */
export class RiskCalibrationAdapter implements CalibrationAdapter {
  constructor(
    private readonly riskStore: RiskScoreStore,
    private readonly outcomeStore: OutcomeStore,
    private readonly builder: RiskCalibrationBuilder = new RiskCalibrationBuilder(),
  ) {}

  async calibrate(opts?: RiskAdapterOptions): Promise<AdapterResult> {
    const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS;
    const generatedAt =
      opts?.generatedAt ?? new Date().toISOString();

    // Thread the run-shared `generatedAt` through both window queries so
    // tests with fixed historical timestamps don't drift past the
    // wall-clock 30-day window. Without this, the join silently pairs
    // in-window RiskScores with out-of-window OutcomeRecords (or vice
    // versa) and calibration results fluctuate with the wall clock.
    const riskScores = await this.riskStore.queryByWindow(windowDays, generatedAt);
    const allOutcomes = await this.outcomeStore.queryByWindow(windowDays, generatedAt);

    // Group outcomes by subjectId (the proposalId link) for O(1) lookup.
    const outcomesByProposal = new Map<string, OutcomeRecord[]>();
    for (const outcome of allOutcomes) {
      const list = outcomesByProposal.get(outcome.subjectId) ?? [];
      list.push(outcome);
      outcomesByProposal.set(outcome.subjectId, list);
    }

    const observations: RiskOutcomeObservation[] = [];
    let excludedNoOutcome = 0;

    for (const risk of riskScores) {
      const proposalId = risk.id.replace(/^risk-/, "");
      const matches = outcomesByProposal.get(proposalId);
      if (!matches || matches.length === 0) {
        excludedNoOutcome += 1;
        continue;
      }

      // Most recent outcome (by generatedAt desc) wins; ties: first seen.
      const latest = [...matches].sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      )[0]!;

      const dimensions: DimensionScore[] = RISK_DIMENSIONS.map((d) => ({
        dimension: d,
        score: risk.dimensions[d],
      }));

      observations.push({
        proposalId,
        dimensions,
        outcome: latest.outcome,
      });
    }

    const sourceReportId = `risk-calibration-window-${windowDays}`;
    const built = this.builder.calibrate(
      observations,
      sourceReportId,
      generatedAt,
    );

    return {
      signals: built.signals,
      profiles: built.profiles,
      diagnostics: {
        adapter: "risk",
        sourceRecordsRead: riskScores.length,
        processed: observations.length,
        excludedReasons:
          excludedNoOutcome > 0 ? { noOutcome: excludedNoOutcome } : {},
        fidelity: "high",
      },
    };
  }
}

// Type-only re-export of RiskScore so test fixtures can import from this
// module without reaching into `adaptation/`. Keeps the public surface
// narrow for adapter consumers.
export type { RiskScore };