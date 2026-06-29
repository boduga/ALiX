/**
 * P10.9.1 — Executive Observation Provider.
 *
 * Single seam between the snapshot assembly layer and the storage /
 * report layers. This is the ONLY file in the snapshot stack that
 * imports the trend / outcome / recommendation / effectiveness /
 * correlation stores. The snapshot provider depends only on this
 * abstraction — it never reaches into stores directly.
 *
 * Future snapshot kinds (forecast, simulation, replay) extend
 * `ExecutiveObservationProvider` rather than adding new search logic
 * to the snapshot layer.
 *
 * `collect(planId)` returns a fresh observation every call. The
 * observation captures REFERENCES to source reports — never derived
 * metrics. See ADR-0005 rule #4: snapshots store observations and
 * report references, not derived analytics.
 *
 * @module
 */

import { ExecutiveTrendStore } from "./trend-store.js";
import type { ExecutiveTrendSnapshot } from "./trend-store.js";
import { OutcomeReportStore } from "./outcome-store.js";
import type { OutcomeReportMeta } from "./outcome-store.js";
import {
  RecommendationReportStore,
} from "./recommendation-report-store.js";
import type { RecommendationReportMeta } from "./recommendation-report-store.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured observation of the current executive state for a plan.
 * Captured fresh on every `collect(planId)` call — no caching. Holds
 * REFERENCES to source reports; the snapshot layer persists these as
 * raw subsystem state without re-deriving any analytics.
 */
export interface ExecutiveObservation {
  /** ISO 8601 timestamp at the moment of collection. */
  readonly collectedAt: string;
  /** Latest trend snapshot id, if any. */
  readonly trendSnapshotId?: string;
  /** Outcome report ids surfaced by OutcomeReportStore.list(), newest first. */
  readonly recentOutcomeReportIds: readonly string[];
  /** Latest recommendation report id, if any. */
  readonly latestRecommendationReportId?: string;
  /** Latest effectiveness report id, if any. */
  readonly latestEffectivenessReportId?: string;
  /** Latest subsystem correlation report id, if any. */
  readonly latestCorrelationReportId?: string;
}

/**
 * Returns the latest effectiveness report id (or undefined if none).
 * Modeled as a separate interface rather than importing the full store
 * so the observation provider does not need to take a direct dependency
 * on `EffectivenessStore` (which lives in `src/adaptation/`).
 */
export interface EffectivenessObservationSource {
  latestReportId(): Promise<string | undefined>;
}

/** Returns the latest subsystem correlation report id, if any. */
export interface CorrelationObservationSource {
  latestReportId(): Promise<string | undefined>;
}

/** Constructor inputs for the default observation provider. */
export interface DefaultExecutiveObservationProviderOptions {
  readonly trendStore: ExecutiveTrendStore;
  readonly outcomeStore: OutcomeReportStore;
  readonly recommendationStore: RecommendationReportStore;
  readonly effectivenessSource: EffectivenessObservationSource;
  readonly correlationSource: CorrelationObservationSource;
}

/**
 * Pure assembly seam. Returns a fresh observation every call. Future
 * snapshot kinds (forecast, simulation, replay) extend this interface
 * rather than adding new search logic to the snapshot layer.
 */
export interface ExecutiveObservationProvider {
  /**
   * Returns a structured observation of the current executive state for
   * the given plan. Returns a fresh observation every call (no caching).
   */
  collect(planId: string): Promise<ExecutiveObservation>;
}

// ---------------------------------------------------------------------------
// Default implementation
// ---------------------------------------------------------------------------

/**
 * Default observation provider. Wires the trend / outcome / recommendation
 * stores plus the (effectiveness, correlation) observation sources. This
 * is the ONLY file in the snapshot stack that imports these stores.
 */
export class DefaultExecutiveObservationProvider implements ExecutiveObservationProvider {
  constructor(
    private readonly options: DefaultExecutiveObservationProviderOptions,
  ) {}

  async collect(planId: string): Promise<ExecutiveObservation> {
    // P10.4c-style read pattern: load each source in parallel, fail-soft
    // per-source. A missing trend snapshot or empty outcome list is not
    // an error — the observation just omits the corresponding id.
    const collectedAt = new Date().toISOString();

    const [trend, outcomeMetas, recMetas, effectivenessId, correlationId] = await Promise.all([
      this.safeLoadTrend(),
      Promise.resolve(this.safeOutcomeList()),
      Promise.resolve(this.safeRecommendationList()),
      this.safeEffectivenessId(),
      this.safeCorrelationId(),
    ]);

    return {
      collectedAt,
      trendSnapshotId: trend?.id,
      recentOutcomeReportIds: outcomeMetas.map((m) => m.reportId),
      latestRecommendationReportId: recMetas[0]?.reportId,
      latestEffectivenessReportId: effectivenessId,
      latestCorrelationReportId: correlationId,
    };
  }

  // -----------------------------------------------------------------------
  // Fail-soft read helpers
  // -----------------------------------------------------------------------

  private async safeLoadTrend(): Promise<ExecutiveTrendSnapshot | null> {
    try {
      return await this.options.trendStore.loadLatest();
    } catch {
      return null;
    }
  }

  private safeOutcomeList(): OutcomeReportMeta[] {
    try {
      return this.options.outcomeStore.list();
    } catch {
      return [];
    }
  }

  private safeRecommendationList(): RecommendationReportMeta[] {
    try {
      return this.options.recommendationStore.list();
    } catch {
      return [];
    }
  }

  private async safeEffectivenessId(): Promise<string | undefined> {
    try {
      return await this.options.effectivenessSource.latestReportId();
    } catch {
      return undefined;
    }
  }

  private async safeCorrelationId(): Promise<string | undefined> {
    try {
      return await this.options.correlationSource.latestReportId();
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a default observation provider from a base executive directory
 * (e.g., `.alix/executive`). Mirrors the `createAutomaticOutcomeEvaluator`
 * pattern. Returns a fully wired provider with default observation
 * sources for effectiveness and correlation.
 *
 * The effectiveness and correlation sources intentionally start as
 * "no latest id" stubs — wiring them to actual stores is a future
 * stabilization slice once the corresponding stores are moved into
 * the executive subsystem. Per ADR-0005, this is a permitted deferral:
 * adding new snapshot kinds (and their observation sources) is
 * additive, not a contract violation.
 */
export function createDefaultObservationProvider(
  executiveDir: string,
): DefaultExecutiveObservationProvider {
  // Local import to avoid loading the full outcome store when unused.
  const trendStore = new ExecutiveTrendStore(executiveDir);
  const outcomeStore = new OutcomeReportStore(`${executiveDir}/outcomes`);
  const recommendationStore = new RecommendationReportStore(
    `${executiveDir}/recommendations`,
  );

  const noLatestEffectiveness: EffectivenessObservationSource = {
    async latestReportId(): Promise<string | undefined> {
      return undefined;
    },
  };
  const noLatestCorrelation: CorrelationObservationSource = {
    async latestReportId(): Promise<string | undefined> {
      return undefined;
    },
  };

  return new DefaultExecutiveObservationProvider({
    trendStore,
    outcomeStore,
    recommendationStore,
    effectivenessSource: noLatestEffectiveness,
    correlationSource: noLatestCorrelation,
  });
}