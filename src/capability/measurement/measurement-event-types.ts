// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — Measurement event types + payload.
 *
 * Append-only measurement event stream. Lives in same EventLog as
 * lifecycle (`capability.*`) governance (`capability.governance.proposal.*`)
 * events, sharing parent prefix `capability.governance.*` single-filter
 * projection (ruling #1, #20).
 *
 * Today: exactly one event type — `measured` (ruling #5: one event per call).
 *
 * @module capability/measurement/measurement-event-types
 */

import type { ObservationStatus } from "../../evolution/observation/contracts/observation-contract.js";
import type { CapabilityEvolutionSignal } from "../evolution/a7-proposals.js";

export type CapabilityMeasurementEventType = "capability.governance.measurement.measured";

export const CAPABILITY_MEASUREMENT_EVENT_TYPES: readonly CapabilityMeasurementEventType[] = [
  "capability.governance.measurement.measured",
] as const;

export const MEASUREMENT_EVENT_PREFIX = "capability.governance.measurement.";

/** Parent prefix that scopes ALL governance events: proposal.* (CAP-9) + measurement.* (CAP-10). */
export const MEASUREMENT_GOVERNANCE_PREFIX = "capability.governance.";

export function isMeasurementEventType(value: unknown): value is CapabilityMeasurementEventType {
  return (
    typeof value === "string" &&
    (CAPABILITY_MEASUREMENT_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export interface CapabilityMeasurementPayloadTarget {
  readonly capabilityId: string;
  readonly version: string;
}

export interface CapabilityMeasurementPayloadBaseline {
  readonly observationId: string;
  readonly takenAt: string;
}

export interface CapabilityMeasurementPayloadPost {
  readonly observationId: string;
  readonly takenAt: string;
  readonly status: ObservationStatus;
  readonly confidence: number;
}

export type CapabilityMeasurementPayloadOutcome =
  | {
      readonly kind: "effective";
      readonly evidenceRefs: readonly string[];
      readonly confidence: number;
      readonly summary: string;
      readonly signals: readonly CapabilityEvolutionSignal[];
    }
  | {
      readonly kind: "ineffective";
      readonly evidenceRefs: readonly string[];
      readonly confidence: number;
      readonly summary: string;
      readonly signals: readonly CapabilityEvolutionSignal[];
    }
  | {
      readonly kind: "inconclusive";
      readonly evidenceRefs: readonly string[];
      readonly confidence: number;
      readonly summary: string;
      readonly signals: readonly CapabilityEvolutionSignal[];
    };

export interface CapabilityMeasurementPayload {
  readonly measurement: CapabilityMeasurementPayloadTarget;
  readonly baseline?: CapabilityMeasurementPayloadBaseline;
  readonly post: CapabilityMeasurementPayloadPost;
  readonly outcome: CapabilityMeasurementPayloadOutcome;
}

export type CapabilityMeasurementEvent = {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: "capability.governance.measurement.measured";
  readonly payload: CapabilityMeasurementPayload;
};
