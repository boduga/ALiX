import type { LearningAdapter, MeasurementOutcomeRecord } from "../contracts/learning-contract.js";
import type { EventLog } from "../../../events/event-log.js";

/**
 * Read-only adapter over EventLog `capability.governance.measurement.*` events.
 * Returns normalized MeasurementOutcomeRecord[].
 *
 * IMPORTANT: measurement events are CAPABILITY-targeted, NOT proposal-targeted.
 * They do not carry proposalId or sourceProposalIds by design (CAP-10 / CAP-10.5).
 *
 * Schema reconciliation (A8 wayfinder map #517):
 * - `capabilityId` reachable at `payload.measurement.capabilityId`.
 * - `outcome` is a nested object: `payload.outcome.kind`
 *   ("effective" | "ineffective" | "inconclusive").
 * - `signals_unpublished` events are filtered out — only `measured` events
 *   carry measurement outcomes; `signals_unpublished` is a sink-failure
 *   event (CAP-10.5) with different shape.
 */
export class MeasurementEventsAdapter implements LearningAdapter<MeasurementOutcomeRecord> {
  readonly name = "measurement-events";
  constructor(private readonly eventLog: EventLog) {}

  async list(): Promise<ReadonlyArray<MeasurementOutcomeRecord>> {
    const all = await this.eventLog.readAll();
    return all
      .filter((e) => e.type === "capability.governance.measurement.measured")
      .map((e) => this.normalize(e));
  }

  private normalize(event: {
    seq: number;
    timestamp: string;
    type: string;
    payload: unknown;
  }): MeasurementOutcomeRecord {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const measurement = payload["measurement"] as { capabilityId?: string } | undefined;
    const outcome = payload["outcome"] as { kind?: string } | undefined;
    return {
      capabilityId: measurement?.capabilityId ?? "",
      outcome: (outcome?.kind as MeasurementOutcomeRecord["outcome"] | undefined) ?? "inconclusive",
      recordedAt: event.timestamp,
      eventId: String(event.seq),
    };
  }
}
