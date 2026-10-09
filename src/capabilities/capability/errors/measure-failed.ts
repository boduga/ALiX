// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — Stable error thrown by `CapabilityMeasurementEngine.measure()`
 * when the A5 `measureCapability(target, baseline?)` call itself throws
 * (locked ruling #16). The orchestrator catches the original error and
 * rethrows as `CapabilityMeasureFailedError` so consumers can match a
 * single stable code while retaining the underlying cause via
 * `err.cause`. On this path NO measurement event is recorded and NO
 * evolution signal is emitted (ruling #12).
 *
 * Distinct from `CapabilityMeasureInvalidTargetError`: target resolution
 * is CAP-10's responsibility, so unknown id@version targets take a
 * different code (spec §8.2).
 *
 * Frozen — error instances are immutable so they can safely cross
 * process boundaries (logger, event payloads) without mutation
 * (CAP-6/9 precedent).
 *
 * @module capability/errors/measure-failed
 */

/** Thrown by `CapabilityMeasurementEngine.measure()` when A5 throws
 *  (ruling #16). No measurement event is recorded. Frozen. */
export class CapabilityMeasureFailedError extends Error {
  readonly code: "measure_failed" = "measure_failed" as const;

  constructor(
    readonly capabilityId: string,
    readonly version: string,
    readonly baselineObservationId: string | undefined,
    readonly cause: Error,
  ) {
    super(
      `Capability measurement failed for '${capabilityId}@${version}' (baseline: ${baselineObservationId ?? "absent"}): ${cause.message}`,
    );
    this.name = "CapabilityMeasureFailedError";
    this.code = "measure_failed";
    Object.freeze(this);
  }
}
