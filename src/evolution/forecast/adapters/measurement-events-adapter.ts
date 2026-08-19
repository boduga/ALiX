/**
 * A9 — measurement events adapter (Slice 1, Phase 4/5).
 *
 * Read-only adapter over EventLog `capability.governance.measurement.measured`
 * events. Returns canonical `CapabilityMeasurementRecord[]`.
 *
 * Q8 locked ruling: measurement events are CAPABILITY-targeted, NOT
 * proposal-targeted, and deliberately carry NO proposalId / sourceProposalIds
 * / forecastId / correlationId. This adapter MUST NOT expose or invent those
 * fields. Measurement consumption belongs to the later correlation slice, NOT
 * to forecast generation — the forecast engine never reads this adapter.
 *
 * Schema reconciliation (matches the canonical measurement payload in
 * `src/capability/measurement/measurement-event-types.ts`):
 * - `measurementId` ← the EventLog event `id` (UUID; the event's unique identity).
 * - `capabilityId` ← `payload.measurement.capabilityId`.
 * - `outcome` ← `payload.outcome.kind` ("effective" | "ineffective" |
 *   "inconclusive"); defaults to "inconclusive" when absent.
 * - `signals_unpublished` events are filtered out — they are CAP-10.5 sink
 *   failures with a different shape, not measurement outcomes.
 *
 * @module evolution/forecast/adapters/measurement-events-adapter
 */

import type { EventLog } from "../../../events/event-log.js";
import type { ForecastAdapter, CapabilityMeasurementRecord } from "../contracts/contract.js";

/** The single measurement event type that carries an outcome. */
export const MEASUREMENT_EVENT_TYPE = "capability.governance.measurement.measured";

export class MeasurementEventsAdapter implements ForecastAdapter<CapabilityMeasurementRecord> {
  readonly name = "a9-measurement-events";
  constructor(private readonly eventLog: EventLog) {}

  async list(): Promise<ReadonlyArray<CapabilityMeasurementRecord>> {
    const all = await this.eventLog.readAll();
    return all
      .filter((e) => e.type === MEASUREMENT_EVENT_TYPE)
      .map((e) => this.toRecord(e));
  }

  private toRecord(event: {
    id: string;
    seq: number;
    timestamp: string;
    type: string;
    payload: unknown;
  }): CapabilityMeasurementRecord {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const measurement = payload["measurement"] as { capabilityId?: string } | undefined;
    const outcome = payload["outcome"] as { kind?: string } | undefined;
    return {
      measurementId: event.id,
      capabilityId: measurement?.capabilityId ?? "",
      outcome: (outcome?.kind as CapabilityMeasurementRecord["outcome"] | undefined) ?? "inconclusive",
      recordedAt: event.timestamp,
      eventId: String(event.seq),
    };
  }
}
