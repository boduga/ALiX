/**
 * P8.5a.2 — Shared adapter result + diagnostics types.
 *
 * Every calibration adapter returns AdapterResult so the learning-refresh
 * orchestrator can summarize uniformly. The diagnostics give operators
 * visibility into what was read, processed, excluded, and at what fidelity —
 * WITHOUT needing the P8.5b dashboard.
 *
 * Pure data types, no storage dependencies.
 *
 * @module
 */

import type { LearningSignal, CalibrationProfile } from "./learning-types.js";

export type AdapterName = "recommendation" | "risk" | "governance";

export interface AdapterDiagnostics {
  /** Which adapter produced this. */
  adapter: AdapterName;
  /** Source records read in the window (e.g. outcomes, or risk scores). */
  sourceRecordsRead: number;
  /** Records that contributed to an observation fed to the builder. */
  processed: number;
  /** Records excluded, keyed by reason (e.g. { missingConfidence: 12, noOutcome: 4 }). */
  excludedReasons: Record<string, number>;
  /** Data fidelity: "high" for recorded observations, "low" for inferred (P8.3 concernsRaised). */
  fidelity: "high" | "low";
  notes?: string[];
}

export interface AdapterResult {
  signals: LearningSignal[];
  profiles: CalibrationProfile[];
  diagnostics: AdapterDiagnostics;
}

/**
 * Minimal interface a calibration adapter satisfies. Lets the
 * learning-refresh orchestrator iterate a heterogeneous registry without
 * an if/else chain — and lets future adapters (P7.5p.4 routing,
 * telemetry, evidence, ...) drop in as a single map entry.
 */
export interface CalibrationAdapter {
  calibrate(opts?: {
    windowDays?: number;
    generatedAt?: string;
  }): Promise<AdapterResult>;
}
