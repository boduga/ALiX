/**
 * CAP-10 — A5 measurement seam (type-only).
 *
 * The A5 capability-level surface is exposed through this interface (ruling #8).
 * `CapabilityService` imports `import type { A5Measurement } from "./measurement/a5.js"`
 * exclusively (ruling #7). The concrete implementation lives in
 * `src/evolution/observation/a5-capability-measurement.ts` and is constructed
 * by the composition root (`src/capability/platform.ts` — ruling #18).
 *
 * @module capability/measurement/a5
 */

import type { CapabilityMeasurementOutcome } from "./outcome-discriminated-union.js";

export type { CapabilityMeasurementOutcome } from "./outcome-discriminated-union.js";

export interface A5MeasurementTarget {
  readonly capabilityId: string;
  readonly version: string;
}

export interface A5Measurement {
  measureCapability(
    target: A5MeasurementTarget,
    baselineObservationId?: string,
  ): Promise<CapabilityMeasurementOutcome>;
}
