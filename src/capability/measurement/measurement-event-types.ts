// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — Measurement event types + payload.
 * CAP-10.5 — adds `signals_unpublished` event for sink-publish failures
 * (ruling #R5).
 *
 * Append-only measurement event stream. Lives in same EventLog as
 * lifecycle (`capability.*`) governance (`capability.governance.proposal.*`)
 * events, sharing parent prefix `capability.governance.*` single-filter
 * projection (ruling #1, #20).
 *
 * Event types:
 *   - `measured`            — successful measurement (one per call)
 *   - `signals_unpublished` — sink delivery failure (CAP-10.5)
 *
 * @module capability/measurement/measurement-event-types
 */

import type { ObservationStatus } from "../../evolution/observation/contracts/observation-contract.js";
import type { CapabilityEvolutionSignal } from "../evolution/proposals.js";

export type CapabilityMeasurementEventType =
  | "capability.governance.measurement.measured"
  | "capability.governance.measurement.signals_unpublished";

export const CAPABILITY_MEASUREMENT_EVENT_TYPES: readonly CapabilityMeasurementEventType[] = [
  "capability.governance.measurement.measured",
  "capability.governance.measurement.signals_unpublished",
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

// ---------------------------------------------------------------------------
// CAP-10.5 — `signals_unpublished` event (ruling #R5)
// ---------------------------------------------------------------------------

/**
 * Classification of the failure that caused signals to be unpublished.
 * CAP-10.5 emits only `"sink_threw"` (no timeout contract yet); the
 * `"sink_timeout"` variant is reserved for forward compatibility.
 */
export type MeasurementSignalsUnpublishedFailure =
  | { readonly classification: "sink_threw"; readonly cause: string }
  | { readonly classification: "sink_timeout"; readonly cause: string };

/**
 * Emitted by A5 when a `ProposalSignalSink.publish()` throws. References
 * the `measured` event whose signals failed delivery so a CAP-12 replay
 * tool can re-publish them.
 *
 * Invariant: `payload.signalCount === payload.signalIds.length`.
 */
export interface MeasurementSignalsUnpublishedEvent {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: "capability.governance.measurement.signals_unpublished";
  readonly payload: {
    readonly measurementEventId: string;
    readonly signalCount: number;
    readonly signalIds: readonly string[];
    readonly failure: MeasurementSignalsUnpublishedFailure;
    readonly occurredAt: string;
    readonly actor: {
      readonly kind: "system";
      readonly component: "CapabilityMeasurement";
    };
  };
}

export interface CapabilityMeasurementMeasuredEvent {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: "capability.governance.measurement.measured";
  readonly payload: CapabilityMeasurementPayload;
}

export type CapabilityMeasurementEvent =
  | CapabilityMeasurementMeasuredEvent
  | MeasurementSignalsUnpublishedEvent;
