/**
 * A9 — correlation engine (Slice 4, Phase 11).
 *
 * Measurement-arrival-driven correlation. The engine is NOT
 * `(forecastId, measurementId)`-pair-driven: the driving event is a measurement
 * arriving, after which candidate forecasts for its capability are loaded,
 * authorized through the canonical two-hop bridge, and emitted as one
 * independent `A9Correlation` per qualifying pair.
 *
 * Canonical two-hop bridge (locked — do NOT reduce to a simple
 * forecastId + measurementId association):
 *
 *   Step 1 — Load forecast. `subject` = proposalId, `subjectCapability` =
 *            capabilityId; read `horizon`, `forecastId`.
 *   Step 2 — Authorize through `proposal.submitted`. Find `proposal.submitted`
 *            where `proposalId === forecast.subject`. Verify
 *            `proposal.submitted.payload.candidate.target.id === forecast.subjectCapability`.
 *            If NOT: no correlation. Do not repair or infer the mismatch.
 *   Step 3 — Require `proposal.executed`. Find `proposal.executed` where
 *            `proposalId === forecast.subject`. If absent: no correlation. If the
 *            proposal was rejected: no correlation. NEVER correlate a forecast to
 *            measurements when execution did not occur.
 *   Step 4 — Find measurements where `measurement.capabilityId ===
 *            forecast.subjectCapability` AND `horizon.from <= measurement.recordedAt
 *            <= horizon.to`. The horizon is a VALIDITY BOUNDARY, NOT a ranking
 *            heuristic — no latest/nearest/first selection.
 *   Step 5 — Emit ONE independent `A9Correlation` per (forecastId, measurementId)
 *            pair. No group artifact, no reverse pointer, no primary designation.
 *
 * No heuristic correlation: no temporal proximity, no proposal-similarity
 * matching, no payload-equality matching, no "most recent" selection.
 *
 * Output is deterministically sorted (forecastId asc, then measurementId asc)
 * so the emission is stable regardless of adapter/append order.
 *
 * @module evolution/a9/correlation-engine
 */

import type {
  A9Adapter,
  A9Correlation,
  A9Forecast,
  CapabilityMeasurementRecord,
  ProposalEventRecord,
} from "./contracts/a9-contract.js";
import type { ForecastsAdapter } from "./forecasts-adapter.js";
import { buildCorrelation } from "./correlation-builder.js";
import { readCandidateTargetId } from "./bridge-target.js";

/** The engine's composition-root-injected dependencies (no infra instantiation). */
export interface CorrelationEngineDependencies {
  /** Read-only forecast query surface over the persisted forecasts store. */
  readonly forecasts: ForecastsAdapter;
  /** RAW governance proposal events (submitted / executed / rejected). */
  readonly proposalEvents: A9Adapter<ProposalEventRecord>;
  /** Canonical measurement events (Q8: capability-targeted, no proposal linkage). */
  readonly measurements: A9Adapter<CapabilityMeasurementRecord>;
}

/** Per-subject proposal event index (deterministic: first event per kind wins). */
interface ProposalIndex {
  readonly submitted: Map<string, ProposalEventRecord>;
  readonly executed: Set<string>;
  readonly rejected: Set<string>;
}

export class CorrelationEngine {
  constructor(private readonly deps: CorrelationEngineDependencies) {}

  /**
   * Correlate EVERY measurement currently in the measurement adapter.
   *
   * Measurement-arrival-driven per measurement: each measurement is treated as
   * an arriving event, candidate forecasts for its capability are loaded, and
   * the two-hop bridge authorizes the pairs.
   *
   * @param timestamp ISO 8601 deterministic event-context time (not identity-bearing)
   * @returns one independent A9Correlation per qualifying (forecastId, measurementId)
   *          pair, sorted by forecastId then measurementId
   */
  async correlate(timestamp: string): Promise<ReadonlyArray<A9Correlation>> {
    const [measurements, proposalEvents] = await Promise.all([
      this.deps.measurements.list(),
      this.deps.proposalEvents.list(),
    ]);
    const index = indexProposalEvents(proposalEvents);

    const out: A9Correlation[] = [];
    for (const measurement of measurements) {
      out.push(...(await this.correlateMeasurementWith(measurement, index, timestamp)));
    }
    return sortCorrelations(out);
  }

  /**
   * Correlate ONE arriving measurement (the driving event).
   *
   * Loads candidate forecasts for the measurement's capability, authorizes each
   * through the two-hop bridge, and emits one correlation per qualifying pair.
   *
   * @param measurement the arriving measurement event
   * @param timestamp ISO 8601 deterministic event-context time (not identity-bearing)
   */
  async correlateMeasurement(
    measurement: CapabilityMeasurementRecord,
    timestamp: string,
  ): Promise<ReadonlyArray<A9Correlation>> {
    const proposalEvents = await this.deps.proposalEvents.list();
    const index = indexProposalEvents(proposalEvents);
    const out = await this.correlateMeasurementWith(measurement, index, timestamp);
    return sortCorrelations(out);
  }

  /** Core per-measurement correlation. Authorizes then emits per pair. */
  private async correlateMeasurementWith(
    measurement: CapabilityMeasurementRecord,
    index: ProposalIndex,
    timestamp: string,
  ): Promise<ReadonlyArray<A9Correlation>> {
    // Step 1 + capability pre-filter: load candidate forecasts for the
    // measurement's capability (findByCapability = the adapter query surface).
    const candidates = await this.deps.forecasts.findByCapability(measurement.capabilityId);

    const out: A9Correlation[] = [];
    for (const forecast of candidates) {
      const correlation = this.authorizeAndBuild(forecast, measurement, index, timestamp);
      if (correlation) out.push(correlation);
    }
    return out;
  }

  /**
   * Execute the canonical two-hop bridge for ONE forecast ⇄ measurement pair.
   *
   * @returns a correlation, or null when the bridge fails at any step
   *          (no submitted / target mismatch / no executed / rejected /
   *          capability mismatch / outside horizon).
   */
  private authorizeAndBuild(
    forecast: A9Forecast,
    measurement: CapabilityMeasurementRecord,
    index: ProposalIndex,
    timestamp: string,
  ): A9Correlation | null {
    // Step 2 — authorize through proposal.submitted.
    const submitted = index.submitted.get(forecast.subject);
    if (!submitted) return null;
    const targetId = readCandidateTargetId(submitted.payload);
    // Do not repair or infer a mismatch: strict equality or no correlation.
    if (targetId !== forecast.subjectCapability) return null;

    // Step 3 — require proposal.executed; a rejected proposal never correlates.
    if (!index.executed.has(forecast.subject)) return null;
    if (index.rejected.has(forecast.subject)) return null;

    // Step 4 — horizon VALIDITY BOUNDARY (inclusive), not a ranking heuristic.
    const recordedAt = Date.parse(measurement.recordedAt);
    const from = Date.parse(forecast.horizon.from);
    const to = Date.parse(forecast.horizon.to);
    // Fail-closed: an unparseable timestamp excludes the pair (no throw mid-run).
    if (!isFiniteNumber(recordedAt) || !isFiniteNumber(from) || !isFiniteNumber(to)) {
      return null;
    }
    if (!(from <= recordedAt && recordedAt <= to)) return null;

    // Step 5 — one independent correlation per (forecastId, measurementId) pair.
    return buildCorrelation(forecast, measurement, forecast.subject, timestamp);
  }
}

/** Read `proposal.submitted.payload.candidate.target.id` (bridge anchor). */

/** Build a deterministic per-subject proposal index (first event per kind wins). */
function indexProposalEvents(
  events: ReadonlyArray<ProposalEventRecord>,
): ProposalIndex {
  const submitted = new Map<string, ProposalEventRecord>();
  const executed = new Set<string>();
  const rejected = new Set<string>();
  for (const event of events) {
    switch (event.kind) {
      case "proposal.submitted":
        if (!submitted.has(event.proposalId)) submitted.set(event.proposalId, event);
        break;
      case "proposal.executed":
        executed.add(event.proposalId);
        break;
      case "proposal.rejected":
        rejected.add(event.proposalId);
        break;
      default:
        // approved / execution_failed are not bridge inputs.
        break;
    }
  }
  return { submitted, executed, rejected };
}

/** Deterministic emission order: forecastId asc, then measurementId asc. */
function sortCorrelations(
  correlations: ReadonlyArray<A9Correlation>,
): ReadonlyArray<A9Correlation> {
  return [...correlations].sort(
    (a, b) =>
      a.forecastId.localeCompare(b.forecastId) ||
      a.measurementId.localeCompare(b.measurementId),
  );
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}
