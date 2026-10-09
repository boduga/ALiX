/**
 * P10.10 — BaselineProvider interface.
 *
 * Providers are **sensors**: they capture artifact data but never
 * perform comparison or scoring. That is framework-owned.
 *
 * @module
 */

import type { BaselineArtifact, BaselineSubsystem, ProviderState } from "./baseline-types.js";

/**
 * A sensor that captures health data from a subsystem.
 *
 * Responsibilities:
 *   - Capture baseline snapshots
 *   - Capture current state snapshots
 *
 * Non-responsibilities:
 *   - Comparison (handled by BaselineComparator)
 *   - Scoring (handled by computeHealthScore)
 *   - Recommendations (handled by Executive)
 */
export interface BaselineProvider {
  /** Canonical subsystem name. */
  readonly subsystem: BaselineSubsystem;
  /** Semantic version of this provider implementation. */
  readonly version: string;
  /** Human-readable description of what this provider measures. */
  readonly description: string;
  /** Current operational state. */
  readonly state: ProviderState;
  /** Capability flags (e.g. "capture", "historical", "trend", "forecast"). */
  readonly capabilities: string[];

  /** Capture a baseline snapshot of this subsystem's health metrics. */
  captureBaseline(): Promise<BaselineArtifact>;

  /** Capture the current state of this subsystem. */
  captureCurrent(): Promise<BaselineArtifact>;
}
