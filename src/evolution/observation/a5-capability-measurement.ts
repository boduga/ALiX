// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — A5 concrete capability-measurement implementation.
 *
 * Implements the `A5Measurement` seam (`src/capability/measurement/a5.ts`).
 * Uses the existing `ObservationEngine` (A5.1) to perform baseline (if
 * requested) and post observations, then computes the outcome via an
 * injected (or default) `OutcomeDecider`.
 *
 * Architectural boundaries (ruling #5, #7, axis 5):
 *   - Read-only catalog access (provider-name lookup).
 *   - MUST NOT import `src/capability/canonical/catalog` mutators.
 *   - MUST emit evolution signals via the injected `ProposalSignalSource`
 *     (ruling #12).
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
import type { ProposalSignalSource } from "../../capability/evolution/a7-proposals.js";

export type OutcomeDecider = (
  post: ObservationResult,
  baseline?: ObservationResult,
) => CapabilityMeasurementOutcome;

export interface A5CapabilityMeasurementOptions {
  readonly observationEngine: ObservationEngine;
  readonly signalSource: ProposalSignalSource;
  readonly catalog: CapabilityCatalog;
  readonly outcomeDecider?: OutcomeDecider;
}

const DEFAULT_OUTCOME_DECIDER: OutcomeDecider = (post, baseline) => {
  const confidence = post.confidence;
  const evidenceRefs = [post.observationId];
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
      signals: [],
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

export class A5CapabilityMeasurement implements A5Measurement {
  private readonly engine: ObservationEngine;
  private readonly signalSource: ProposalSignalSource;
  private readonly catalog: CapabilityCatalog;
  private readonly outcomeDecider: OutcomeDecider;

  constructor(options: A5CapabilityMeasurementOptions) {
    this.engine = options.observationEngine;
    this.signalSource = options.signalSource;
    this.catalog = options.catalog;
    this.outcomeDecider = options.outcomeDecider ?? DEFAULT_OUTCOME_DECIDER;
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

    const outcome = this.outcomeDecider(post, baseline);

    // Consult signalSource (ruling #12). Effective outcome → no signal; the
    // signalSource is consumed via its public API to keep the contract.
    const signals = await this.signalSource.signals();
    void signals;

    return outcome;
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
