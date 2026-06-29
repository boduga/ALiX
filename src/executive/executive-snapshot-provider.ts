/**
 * P10.9.1 — Executive Snapshot Provider.
 *
 * Pure assembly layer for plan-scoped snapshots. Depends ONLY on an
 * injected `ExecutiveObservationProvider` — never on stores directly.
 * Per ADR-0005 and the layered architecture: the snapshot provider
 * composes observations; storage happens one layer down in
 * ExecutiveSnapshotStore.
 *
 * Why two methods (`captureBaseline` + `captureCurrent`), not one
 * `capture(kind)`: the immutability contract differs between baseline
 * (write-once, throws on duplicate) and current (replaceable). Splitting
 * into two methods makes that explicit at the call site. Future kinds
 * (`captureForecast`, `captureSimulation`) extend the interface without
 * breaking existing callers.
 *
 * @module
 */

import type {
  ExecutiveObservationProvider,
  ExecutiveObservation,
} from "./executive-observation-provider.js";
import {
  createDefaultObservationProvider,
} from "./executive-observation-provider.js";
import type {
  ExecutivePlanSnapshot,
  ExecutiveSnapshotCaptureSource,
  ExecutiveSnapshotCaptureReason,
  ExecutiveSnapshotMetadata,
} from "./executive-snapshot-store.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The snapshot assembly layer's interface. Pure assembly: depends only
 * on the observation abstraction. Storage and I/O are delegated one
 * layer down to `ExecutiveSnapshotStore`.
 */
export interface ExecutiveSnapshotProvider {
  /**
   * Captures an immutable baseline snapshot for a plan at execution
   * start. Called ONCE per plan lifetime — saving twice throws
   * `BaselineAlreadyCapturedError` at the store level.
   */
  captureBaseline(planId: string): Promise<ExecutivePlanSnapshot>;

  /**
   * Captures a replaceable current snapshot, typically before
   * evaluation. Called multiple times per plan lifetime.
   */
  captureCurrent(planId: string): Promise<ExecutivePlanSnapshot>;
}

/** Constructor inputs for the default snapshot provider. */
export interface DefaultExecutiveSnapshotProviderOptions {
  /** Single seam for sourcing observed references. */
  readonly observationProvider: ExecutiveObservationProvider;
  /** ALiX version stamped on every snapshot (for cross-version audit). */
  readonly alixVersion: string;
  /** Executive engine version stamped on every snapshot. */
  readonly executiveEngineVersion: string;
  /**
   * Optional clock injection. Defaults to `() => new Date().toISOString()`.
   * Used by tests to capture deterministic timestamps.
   */
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Default implementation
// ---------------------------------------------------------------------------

/**
 * Default snapshot provider. Pure assembly — never reaches into stores.
 * Stamps metadata (`alixVersion`, `executiveEngineVersion`, `createdBy`,
 * `reason`) on every snapshot per ADR-0005 type contract.
 */
export class DefaultExecutiveSnapshotProvider implements ExecutiveSnapshotProvider {
  private readonly now: () => string;

  constructor(
    private readonly options: DefaultExecutiveSnapshotProviderOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async captureBaseline(planId: string): Promise<ExecutivePlanSnapshot> {
    return this.capture(planId, "baseline", "ExecutionEngine", "execution-start");
  }

  async captureCurrent(planId: string): Promise<ExecutivePlanSnapshot> {
    return this.capture(planId, "current", "EvaluationHandler", "evaluation");
  }

  // -----------------------------------------------------------------------
  // Internal: shared assembly
  // -----------------------------------------------------------------------

  private async capture(
    planId: string,
    kind: "baseline" | "current",
    createdBy: ExecutiveSnapshotCaptureSource,
    reason: ExecutiveSnapshotCaptureReason,
  ): Promise<ExecutivePlanSnapshot> {
    const observation = await this.options.observationProvider.collect(planId);
    const capturedAt = this.now();

    const metadata: ExecutiveSnapshotMetadata = {
      snapshotVersion: 1,
      alixVersion: this.options.alixVersion,
      executiveEngineVersion: this.options.executiveEngineVersion,
      createdBy,
      reason,
    };

    return {
      metadata,
      planId,
      capturedAt,
      captureKind: kind,
      rawSubsystemState: this.toRawSubsystemState(observation),
      id: `${planId}-${kind}`,
    };
  }

  /**
   * Project the observation's optional report refs into the snapshot's
   * rawSubsystemState. The optional fields are forwarded as-is; the
   * `outcomeReportIds` array is forwarded as a fresh readonly tuple so
   * downstream JSON serialization stays stable.
   */
  private toRawSubsystemState(obs: ExecutiveObservation): ExecutivePlanSnapshot["rawSubsystemState"] {
    return {
      trendSnapshotId: obs.trendSnapshotId,
      outcomeReportIds: obs.recentOutcomeReportIds,
      recommendationReportId: obs.latestRecommendationReportId,
      effectivenessReportId: obs.latestEffectivenessReportId,
      correlationReportId: obs.latestCorrelationReportId,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a default snapshot provider from a base executive directory
 * (e.g., `.alix/executive`). Wires a default observation provider under
 * the hood so callers can construct a fully-functional snapshot
 * provider without manual store wiring.
 *
 * Mirrors the `createAutomaticOutcomeEvaluator(executiveDir)` factory
 * pattern (P10.4c).
 */
export function createDefaultSnapshotProvider(
  executiveDir: string,
  options?: {
    alixVersion?: string;
    executiveEngineVersion?: string;
  },
): DefaultExecutiveSnapshotProvider {
  return new DefaultExecutiveSnapshotProvider({
    observationProvider: createDefaultObservationProvider(executiveDir),
    alixVersion: options?.alixVersion ?? "0.0.0",
    executiveEngineVersion: options?.executiveEngineVersion ?? "1.0",
  });
}