// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — Stable error thrown by `CapabilityMeasurementEngine.measure()`
 * when the supplied `id@version` target does not exist in the catalog
 * (spec §8.2). Target resolution is the engine's responsibility (ruling
 * #8), not A5's; this error therefore fires BEFORE A5 is invoked, and
 * `CapabilityMeasureFailedError` is reserved for A5-side failures.
 *
 * Frozen — error instances are immutable so they can safely cross
 * process boundaries (logger, event payloads) without mutation
 * (CAP-6/9 precedent).
 *
 * @module capability/errors/measure-invalid-target
 */

/** Thrown by `CapabilityMeasurementEngine.measure()` when the supplied
 *  id@version target is not present in the catalog (spec §8.2).
 *  Frozen — error instances are immutable. */
export class CapabilityMeasureInvalidTargetError extends Error {
  readonly code: "measure_invalid_target" = "measure_invalid_target" as const;

  constructor(readonly capabilityId: string, readonly version: string) {
    super(`Capability measurement target not found in catalog: '${capabilityId}@${version}'`);
    this.name = "CapabilityMeasureInvalidTargetError";
    this.code = "measure_invalid_target";
    Object.freeze(this);
  }
}
