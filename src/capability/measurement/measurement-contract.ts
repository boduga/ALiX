/**
 * CAP-10 — A5 measurement seam (type-only).
 *
 * The A5 capability-level surface is exposed through this interface (ruling #8).
 * `CapabilityService` imports `import type { Measurement } from "./measurement/measurement-contract.js"`
 * exclusively (ruling #7). The concrete implementation lives in
 * `src/evolution/observation/capability-measurement.ts` and is constructed
 * by the composition root (`src/capability/platform.ts` — ruling #18).
 *
 * @module capability/measurement/measurement-contract
 */

import type { CapabilityMeasurementOutcome } from "./outcome-discriminated-union.js";

export type { CapabilityMeasurementOutcome } from "./outcome-discriminated-union.js";

export interface MeasurementTarget {
  readonly capabilityId: string;
  readonly version: string;
}

export interface Measurement {
  measureCapability(
    target: MeasurementTarget,
    baselineObservationId?: string,
  ): Promise<CapabilityMeasurementOutcome>;
}
