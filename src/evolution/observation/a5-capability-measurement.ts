// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — A5 concrete capability-measurement implementation.
 * CAP-10.5 — wiring for sink-based signal emission (ruling #R1, #R2).
 *
 * Implements the `A5Measurement` seam (`src/capability/measurement/a5.ts`).
 * Uses `ObservationEngine` (A5.1) for baseline/post observations, computes
 * the outcome via injected `OutcomeDecider`, then publishes the produced
 * signals through the injected `ProposalSignalSink`.
 *
 * Locked pipeline (ruling #R2):
 *   1. Compute observation
 *   2. Decider finalizes outcome (signals slot populated)
 *   3. Append `measured` event to EventLog (COMMIT POINT)
 *   4. Publish outcome.signals via ProposalSignalSink
 *      - on failure → record `signals_unpublished` event with signal IDs
 *      - on success → continue
 *   5. Return outcome (successful measurement, regardless of publish)
 *
 * Architectural boundaries (ruling #5, #7, axis 5):
 *   - Read-only catalog access (provider-name lookup).
 *   - MUST NOT import `src/capability/canonical/catalog` mutators.
 *   - MUST NOT modify outcome.signals after the decider returns.
 *
 * @module evolution/observation/a5-capability-measurement
 */

import type { ObservationEngine } from "./observation-engine.js";
import type {
  Observation,
  ObservationResult,
} from "./contracts/observation-contract.js";
import type { CapabilityMeasurementOutcome } from "../../capability/measurement/outcome-discriminated-union.js";
import type {
  A5Measurement,
  A5MeasurementTarget,
} from "../../capability/measurement/a5.js";
import type { CapabilityCatalog } from "../../capability/canonical/catalog.js";
import type { ProposalSignalSink, CapabilityEvolutionSignal } from "../../capability/evolution/a7-proposals.js";
import { computeSignalId } from "../../capability/evolution/signal-identity.js";
import type { EventLog } from "../../events/event-log.js";
import type {
  MeasurementSignalsUnpublishedFailure,
  CapabilityMeasurementPayload,
} from "../../capability/measurement/measurement-event-types.js";

export type OutcomeDecider = (
  post: ObservationResult,
  baseline?: ObservationResult,
  target?: A5MeasurementTarget,
) => CapabilityMeasurementOutcome;

export interface A5CapabilityMeasurementOptions {
  readonly observationEngine: ObservationEngine;
  readonly signalSink: ProposalSignalSink;
  readonly catalog: CapabilityCatalog;
  readonly eventLog: EventLog;
  readonly outcomeDecider?: OutcomeDecider;
}

const DEFAULT_OUTCOME_DECIDER: OutcomeDecider = (post, baseline, target) => {
  const confidence = post.confidence;
  const evidenceRefs: string[] = [post.observationId];
  if (baseline) evidenceRefs.push(baseline.observationId);

  if (post.status === "pass") {
    return {
      kind: "effective",
      evidenceRefs,
      confidence,
      summary: `Post observation passed (status=${post.status})`,
      signals: [],
    };
  }
  if (post.status === "fail") {
    return {
      kind: "ineffective",
      evidenceRefs,
      confidence,
      summary: `Post observation failed (status=${post.status})`,
      signals: defaultSignalsFor(target, evidenceRefs, confidence),
    };
  }
  return {
    kind: "inconclusive",
    evidenceRefs,
    confidence,
    summary: `Post observation ${post.status}`,
    signals: [],
  };
};

/** Default signal population (ruling #R3). Ineffective → one underperformer. */
function defaultSignalsFor(
  target: A5MeasurementTarget | undefined,
  evidenceRefs: readonly string[],
  confidence: number,
): readonly CapabilityEvolutionSignal[] {
  if (!target) return [];
  return [
    {
      kind: "underperformer",
      capabilityId: `${target.capabilityId}@${target.version}`,
      score: confidence,
      evidenceIds: [...evidenceRefs],
    },
  ];
}

export class A5CapabilityMeasurement implements A5Measurement {
  private readonly engine: ObservationEngine;
  private readonly signalSink: ProposalSignalSink;
  private readonly catalog: CapabilityCatalog;
  private readonly outcomeDecider: OutcomeDecider;
  private readonly eventLog: EventLog;

  constructor(options: A5CapabilityMeasurementOptions) {
    this.engine = options.observationEngine;
    this.signalSink = options.signalSink;
    this.catalog = options.catalog;
    this.outcomeDecider = options.outcomeDecider ?? DEFAULT_OUTCOME_DECIDER;
    this.eventLog = options.eventLog;
    Object.freeze(this);
  }

  async measureCapability(
    target: A5MeasurementTarget,
    baselineObservationId?: string,
  ): Promise<CapabilityMeasurementOutcome> {
    const postObservation = this.buildPostObservation(target);
    const post = await this.engine.observe(postObservation);

    let baseline: ObservationResult | undefined;
    if (baselineObservationId !== undefined) {
      const baselineObservation = this.buildBaselineObservation(target, baselineObservationId);
      baseline = await this.engine.observe(baselineObservation);
    }

    const outcome = this.outcomeDecider(post, baseline, target);

    // Step 3 — COMMIT POINT: append measured event.
    const measured = await this.recordMeasured(target, baseline, post, outcome);

    // Step 4 — best-effort publish via sink.
    await this.publishSignals(outcome.signals, measured.seq);

    return outcome;
  }

  private async recordMeasured(
    target: A5MeasurementTarget,
    baseline: ObservationResult | undefined,
    post: ObservationResult,
    outcome: CapabilityMeasurementOutcome,
  ): Promise<{ seq: number }> {
    const payload: CapabilityMeasurementPayload = {
      measurement: { capabilityId: target.capabilityId, version: target.version },
      ...(baseline
        ? {
            baseline: {
              observationId: baseline.observationId,
              takenAt: baseline.observedAt,
            },
          }
        : {}),
      post: {
        observationId: post.observationId,
        takenAt: post.observedAt,
        status: post.status,
        confidence: post.confidence,
      },
      outcome,
    };
    const event = await this.eventLog.append({
      type: "capability.governance.measurement.measured",
      actor: "system",
      sessionId: "",
      payload,
    });
    return { seq: event.seq };
  }

  private async publishSignals(
    signals: readonly CapabilityEvolutionSignal[],
    measurementEventId: number,
  ): Promise<void> {
    const failed: Array<{ signal: CapabilityEvolutionSignal; signalId: string; cause: string }> = [];

    for (const signal of signals) {
      try {
        await this.signalSink.publish(signal);
      } catch (cause) {
        failed.push({
          signal,
          signalId: computeSignalId(signal),
          cause: safeErrorString(cause),
        });
      }
    }

    if (failed.length > 0) {
      const failure: MeasurementSignalsUnpublishedFailure = {
        classification: "sink_threw",
        cause: failed[0]!.cause,
      };
      const payload = {
        measurementEventId: String(measurementEventId),
        signalCount: failed.length,
        signalIds: failed.map((f) => f.signalId),
        failure,
        occurredAt: new Date().toISOString(),
        actor: { kind: "system", component: "A5CapabilityMeasurement" },
      };
      await this.eventLog.append({
        type: "capability.governance.measurement.signals_unpublished",
        actor: "system",
        sessionId: "",
        payload,
      });
    }
  }

  private buildPostObservation(target: A5MeasurementTarget): Observation {
    return {
      observationId: `post-${target.capabilityId}-${target.version}-${Date.now()}`,
      provider: this.resolveProviderName(target),
      description: `Post-measurement of ${target.capabilityId}@${target.version}`,
    };
  }

  private buildBaselineObservation(
    target: A5MeasurementTarget,
    baselineObservationId: string,
  ): Observation {
    return {
      observationId: baselineObservationId,
      provider: this.resolveProviderName(target),
      description: `Baseline for ${target.capabilityId}@${target.version}`,
    };
  }

  private resolveProviderName(target: A5MeasurementTarget): string {
    const def = this.catalog.get(target.capabilityId);
    if (!def) return "native";
    const firstBinding = def.bindings[0];
    return firstBinding?.type ?? "native";
  }
}

function safeErrorString(cause: unknown): string {
  if (cause instanceof Error) return String(cause.message).slice(0, 500);
  return String(cause).slice(0, 500);
}
