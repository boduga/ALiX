// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — `CapabilityMeasurementEngine` (orchestrator).
 *
 * Owns the measurement boundary:
 *   1. Resolves the id@version target via the catalog (ruling #8).
 *   2. Calls `A5Measurement.measureCapability(target, baseline?)`
 *      (ruling #8). The A5 implementation is injected via the
 *      composition root (`src/capability/platform.ts` — ruling #18).
 *   3. Builds the post observation reference from the `ObservationEngine`
 *      (ruling #14; spec §5.1).
 *   4. Records exactly one `capability.governance.measurement.measured`
 *      event (ruling #5, #14).
 *   5. Returns the atomic `CapabilityMeasureResult` (ruling #4, Type Gate).
 *
 * Does NOT compute outcomes (A5 owns that — ruling #7, #8).
 * Does NOT emit evolution signals (A5 owns that — ruling #12).
 * Append-only — no idempotency check on re-measure (ruling #13).
 *
 * Lives in `capability/measurement/`, NOT `evolution/`.
 *
 * Forbidden (ruling #9, axis 5):
 *   - MUST NOT import `src/evolution/observation/a5-capability-measurement`.
 *
 * @module capability/measurement/capability-measurement-engine
 */

import type { AlixEvent, NewEvent } from "../../events/types.js";
import type { EventLog } from "../../events/event-log.js";
import type { CapabilityCatalog } from "../canonical/catalog.js";
import type { A5Measurement, A5MeasurementTarget } from "./a5.js";
import type { CapabilityMeasurementOutcome } from "./outcome-discriminated-union.js";
import type {
  CapabilityMeasurementPayload,
  CapabilityMeasurementPayloadPost,
} from "./measurement-event-types.js";
import { MEASUREMENT_EVENT_PREFIX } from "./measurement-event-types.js";
import type { CapabilityMeasureInput, CapabilityMeasureResult } from "../types/service-results.js";
import type { ObservationEngine, Observation, ObservationResult } from "../../evolution/observation/index.js";
import { CapabilityMeasureFailedError } from "../errors/measure-failed.js";
import { CapabilityMeasureInvalidTargetError } from "../errors/measure-invalid-target.js";

export interface CapabilityMeasurementEngineOptions {
  readonly catalog: CapabilityCatalog;
  readonly eventLog: EventLog;
  readonly a5: A5Measurement;
  readonly observationEngine: ObservationEngine;
}

export class CapabilityMeasurementEngine {
  private readonly catalog: CapabilityCatalog;
  private readonly eventLog: EventLog;
  private readonly a5: A5Measurement;
  private readonly observationEngine: ObservationEngine;

  constructor(options: CapabilityMeasurementEngineOptions) {
    this.catalog = options.catalog;
    this.eventLog = options.eventLog;
    this.a5 = options.a5;
    this.observationEngine = options.observationEngine;
  }

  async measure(input: CapabilityMeasureInput): Promise<CapabilityMeasureResult> {
    const target: A5MeasurementTarget = {
      capabilityId: input.capabilityId,
      version: input.version,
    };

    // Target resolution (ruling #8; spec §8.2).
    const def = this.catalog.get(input.capabilityId);
    if (!def || def.version !== input.version) {
      throw new CapabilityMeasureInvalidTargetError(input.capabilityId, input.version);
    }

    // Call A5 (ruling #8, #12, #15). A5 owns outcome computation +
    // evolution-signal emission. We catch and rethrow as the stable
    // frozen error (ruling #16).
    let outcome: CapabilityMeasurementOutcome;
    try {
      outcome = await this.a5.measureCapability(target, input.baselineObservationId);
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      throw new CapabilityMeasureFailedError(
        input.capabilityId,
        input.version,
        input.baselineObservationId,
        err,
      );
    }

    // Build post observation reference (ruling #14; spec §5.1).
    const postObservation = this.buildPostObservation(target);
    const postResult: ObservationResult = await this.observationEngine.observe(postObservation);

    const baselineRef: CapabilityMeasureResult["baseline"] =
      input.baselineObservationId !== undefined
        ? {
            observationId: input.baselineObservationId,
            takenAt: postResult.observedAt,
          }
        : undefined;

    const postPayload: CapabilityMeasurementPayloadPost = {
      observationId: postResult.observationId,
      takenAt: postResult.observedAt,
      status: postResult.status,
      confidence: postResult.confidence,
    };
    const payload: CapabilityMeasurementPayload = {
      measurement: { capabilityId: input.capabilityId, version: input.version },
      ...(baselineRef !== undefined ? { baseline: baselineRef } : {}),
      post: postPayload,
      outcome,
    };

    const event = await this.recordEvent(payload);

    return Object.freeze({
      status: "measured" as const,
      measurement: { capabilityId: input.capabilityId, version: input.version },
      ...(baselineRef !== undefined ? { baseline: baselineRef } : {}),
      post: {
        observationId: postResult.observationId,
        takenAt: postResult.observedAt,
        status: postResult.status,
        confidence: postResult.confidence,
      },
      outcome,
      eventIds: [{ type: event.type, seq: event.seq }],
    });
  }

  private buildPostObservation(target: A5MeasurementTarget): Observation {
    return {
      observationId: `post-${target.capabilityId}-${target.version}-${Date.now()}`,
      provider: "native",
      description: `Post-measurement for ${target.capabilityId}@${target.version}`,
    };
  }

  private async recordEvent(payload: CapabilityMeasurementPayload): Promise<AlixEvent> {
    const newEvent: NewEvent<string, CapabilityMeasurementPayload> = {
      type: `${MEASUREMENT_EVENT_PREFIX}measured`,
      actor: "system",
      sessionId: "",
      payload,
    };
    return this.eventLog.append(newEvent);
  }
}
