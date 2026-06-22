/**
 * P8.4 — RoutingCalibrationBuilder.
 *
 * Observational only in P8. Produces routing observations and proposal
 * shapes from available execution data — not a full quality/cost optimizer.
 *
 * The telemetry needed for rigorous routing calibration (per-model-call
 * outcome, latency, cost) is not yet reliably captured. This builder
 * therefore:
 *   - Accepts pre-aggregated RoutingObservation inputs (the caller assembles
 *     them from whatever telemetry exists)
 *   - Emits signals only when there is sufficient COMPARATIVE data
 *   - Returns empty for sparse/missing data — an empty routing section in
 *     a learning report means "insufficient data to observe patterns"
 *
 * Pure computation — no I/O, no store access, no side effects.
 *
 * @module
 */

import type { LearningSignal, CalibrationProfile } from "./learning-types.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Aggregated routing observation: outcome metrics for a single
 * (taskType, provider, model) combination.
 *
 * The caller assembles these from execution telemetry. Fields beyond
 * `taskType`/`provider`/`outcome`/`count` are optional because telemetry
 * may not reliably capture them yet — the builder only uses the fields
 * that are present.
 */
export interface RoutingObservation {
  /** Task type this observation covers (e.g., "planning", "governance"). */
  taskType: string;
  /** Provider used (e.g., "anthropic", "openai"). */
  provider: string;
  /** Model used (optional; allows finer granularity). */
  model?: string;
  /** Total runs for this combination with known outcomes. */
  count: number;
  /** Number of runs where outcome was "success". */
  successCount: number;
  /** Average latency in milliseconds (optional telemetry). */
  avgLatencyMs?: number;
  /** Average cost per run (optional telemetry). */
  avgCost?: number;
  /** Average total tokens per run (optional telemetry). */
  avgTokens?: number;
}

export interface RoutingCalibrationResult {
  signals: LearningSignal[];
  profiles: CalibrationProfile[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Minimum observations per combination before it's considered. */
const DEFAULT_MIN_COUNT = 5;

/** Minimum quality difference (success rate) to flag a model as good/poor. */
const DEFAULT_QUALITY_DELTA = 0.15;

/** Minimum cost difference (fraction) to flag efficiency. */
const DEFAULT_COST_DELTA = 0.25;

/** Latency threshold (ms) above which a concern is raised. */
const DEFAULT_LATENCY_MS = 5000;

/** Label for this observation cell, used in signal summaries. */
function cellLabel(obs: RoutingObservation): string {
  return obs.model ? `${obs.provider}/${obs.model}` : obs.provider;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class RoutingCalibrationBuilder {
  private readonly minCount: number;
  private readonly qualityDelta: number;
  private readonly costDelta: number;
  private readonly latencyMs: number;

  constructor(opts?: {
    minCount?: number;
    qualityDelta?: number;
    costDelta?: number;
    latencyMs?: number;
  }) {
    this.minCount = opts?.minCount ?? DEFAULT_MIN_COUNT;
    this.qualityDelta = opts?.qualityDelta ?? DEFAULT_QUALITY_DELTA;
    this.costDelta = opts?.costDelta ?? DEFAULT_COST_DELTA;
    this.latencyMs = opts?.latencyMs ?? DEFAULT_LATENCY_MS;
  }

  /**
   * Analyze routing observations and produce observational signals.
   *
   * Signals are only emitted when there is sufficient COMPARATIVE data —
   * i.e. multiple combinations serving the same task type with enough
   * samples. A single combination or sparse data produces no signals.
   *
   * @param observations  Pre-aggregated routing observations.
   * @param sourceReportId  Source identifier for signal provenance.
   * @param generatedAt    ISO timestamp for output artifacts.
   */
  calibrate(
    observations: RoutingObservation[],
    sourceReportId: string,
    generatedAt: string,
  ): RoutingCalibrationResult {
    const signals: LearningSignal[] = [];
    const profiles: CalibrationProfile[] = [];

    // Group by taskType — routing comparisons only make sense within a task type
    const byTaskType = new Map<string, RoutingObservation[]>();
    for (const obs of observations) {
      if (obs.count < this.minCount) continue;
      const list = byTaskType.get(obs.taskType) ?? [];
      list.push(obs);
      byTaskType.set(obs.taskType, list);
    }

    for (const [taskType, cells] of byTaskType) {
      // Need at least 2 comparable cells to make a routing observation
      if (cells.length < 2) continue;

      const qualityScores = cells.map((c) => c.successCount / c.count);
      const avgQuality =
        qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;

      // Optional cost aggregation (only if all cells report cost)
      const costCells = cells.filter((c) => typeof c.avgCost === "number");
      const avgCost =
        costCells.length === cells.length
          ? costCells.reduce((a, b) => a + (b.avgCost ?? 0), 0) / cells.length
          : null;

      for (const cell of cells) {
        const cellQ = cell.successCount / cell.count;
        const label = cellLabel(cell);

        // ----- Quality signals -----
        if (cellQ >= avgQuality + this.qualityDelta) {
          signals.push(
            this.makeSignal(
              "routing_quality_good",
              taskType,
              label,
              `Model ${label} produces higher-quality outcomes for ${taskType} (${(cellQ * 100).toFixed(0)}% vs ${(avgQuality * 100).toFixed(0)}% average)`,
              cellQ - avgQuality,
              cell.count,
              sourceReportId,
              generatedAt,
            ),
          );
          profiles.push(
            this.makeProfile(
              taskType,
              label,
              "increase",
              cellQ - avgQuality,
              generatedAt,
            ),
          );
        } else if (cellQ <= avgQuality - this.qualityDelta) {
          signals.push(
            this.makeSignal(
              "routing_quality_poor",
              taskType,
              label,
              `Model ${label} produces lower-quality outcomes for ${taskType} (${(cellQ * 100).toFixed(0)}% vs ${(avgQuality * 100).toFixed(0)}% average)`,
              avgQuality - cellQ,
              cell.count,
              sourceReportId,
              generatedAt,
            ),
          );
          profiles.push(
            this.makeProfile(
              taskType,
              label,
              "decrease",
              avgQuality - cellQ,
              generatedAt,
            ),
          );
        }

        // ----- Cost efficiency signals (only when cost data is reliable) -----
        if (avgCost !== null && typeof cell.avgCost === "number") {
          if (cell.avgCost <= avgCost * (1 - this.costDelta) && cellQ >= avgQuality) {
            signals.push(
              this.makeSignal(
                "routing_cost_efficient",
                taskType,
                label,
                `Model ${label} is cost-efficient for ${taskType} ($${cell.avgCost.toFixed(4)} vs $${avgCost.toFixed(4)} average, similar quality)`,
                1 - cell.avgCost / avgCost,
                cell.count,
                sourceReportId,
                generatedAt,
              ),
            );
          } else if (
            cell.avgCost >= avgCost * (1 + this.costDelta) &&
            cellQ <= avgQuality
          ) {
            signals.push(
              this.makeSignal(
                "routing_cost_inefficient",
                taskType,
                label,
                `Model ${label} costs more for ${taskType} without better quality ($${cell.avgCost.toFixed(4)} vs $${avgCost.toFixed(4)} average)`,
                cell.avgCost / avgCost - 1,
                cell.count,
                sourceReportId,
                generatedAt,
              ),
            );
          }
        }

        // ----- Latency signals (only when latency data is present) -----
        if (typeof cell.avgLatencyMs === "number" && cell.avgLatencyMs >= this.latencyMs) {
          signals.push(
            this.makeSignal(
              "routing_latency_concern",
              taskType,
              label,
              `Model ${label} has high latency for ${taskType} (p95 ~${cell.avgLatencyMs}ms)`,
              Math.min(1, cell.avgLatencyMs / (this.latencyMs * 2)),
              cell.count,
              sourceReportId,
              generatedAt,
            ),
          );
        }
      }
    }

    return { signals, profiles };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private signalConfidence(count: number): number {
    if (count >= 100) return 0.85;
    if (count >= 30) return 0.7;
    return 0.5;
  }

  private makeSignal(
    signalType: LearningSignal["signalType"],
    taskType: string,
    label: string,
    summary: string,
    strength: number,
    count: number,
    sourceReportId: string,
    generatedAt: string,
  ): LearningSignal {
    return {
      id: `ls-route-${taskType}_${label.replace(/[^a-z0-9]/gi, "_")}_${signalType}_${Date.now()}`,
      subject: `Routing ${signalType.replace(/_/g, " ")} — ${label} for ${taskType}`,
      outcome: "signal_detected",
      confidence: this.signalConfidence(count),
      reasons: [`Sample size: ${count} runs for ${taskType}`],
      generatedAt,
      sourceReportId,
      signalType,
      strength,
      summary,
      evidenceRefs: [],
    };
  }

  private makeProfile(
    taskType: string,
    label: string,
    direction: "increase" | "decrease",
    delta: number,
    generatedAt: string,
  ): CalibrationProfile {
    const clamped = parseFloat(
      Math.max(0.3, Math.min(1.5, direction === "increase" ? 1 + delta : 1 - delta)).toFixed(2),
    );
    return {
      id: `cp-route-${taskType}_${label.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}`,
      subject: `${direction === "increase" ? "Increase" : "Decrease"} routing preference for ${label} (${taskType})`,
      outcome: "suggested",
      confidence: 0.7,
      reasons: [`Quality delta: ${(delta * 100).toFixed(0)}pp`],
      generatedAt,
      target: "routing_model_preference",
      targetName: `${label}__${taskType}`,
      previousValue: 1.0,
      suggestedValue: clamped,
      reason: `Observational: ${direction} preference based on outcome comparison`,
      evidenceRefs: [],
      sourceSignalIds: [],
    };
  }
}
