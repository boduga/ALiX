/**
 * A9 — forecast engine (Slice 1, Phase 8).
 *
 * Composition-root-injected orchestration: the engine receives adapters in its
 * constructor and does NOT instantiate any infrastructure. It runs the three
 * pure detectors over the adapter outputs, groups findings by subject, and
 * builds one forecast per subject.
 *
 * Flow:
 *   list proposal evidence → list enriched proposals
 *         ↓
 *   run detectors (trust-velocity, evidence-completeness, fingerprint-coincidence)
 *         ↓
 *   group findings by subject
 *         ↓
 *   aggregate (max internalScore + weighted confidence per subject)
 *         ↓
 *   build forecasts
 *
 * No-trigger rule: if no detector emits a detection-worthy finding, return []
 * — an empty forecast artifact is NEVER constructed or persisted.
 *
 * Determinism: given the same evidence, the same `now` timestamp, and the same
 * generator version, the result is identical.
 *
 * Measurement consumption is a later-slice (correlation) concern. The engine
 * signature has exactly two adapters — proposal events + enriched proposals —
 * and the detectors never read measurement evidence.
 *
 * @module evolution/a9/forecast-engine
 */

import type {
  A9Adapter,
  A9Forecast,
  DetectorFinding,
  EnrichedProposalRecord,
  ProposalEventRecord,
} from "./contracts/a9-contract.js";
import { detectTrustVelocity } from "./detectors/trust-velocity-detector.js";
import { detectEvidenceCompleteness } from "./detectors/evidence-completeness-detector.js";
import { detectFingerprintCoincidence } from "./detectors/fingerprint-coincidence-detector.js";
import { buildForecast } from "./forecast-builder.js";

/** The adapters the engine reads. Signature is ready for the Slice 5
 *  composition root to inject real (EventLog-backed / pipeline-backed)
 *  adapters. Exactly two adapters — NO measurement adapter. */
export interface ForecastEngineAdapters {
  readonly proposalEvents: A9Adapter<ProposalEventRecord>;
  readonly enrichedProposals: A9Adapter<EnrichedProposalRecord>;
}

export class ForecastEngine {
  constructor(private readonly adapters: ForecastEngineAdapters) {}

  /**
   * Produce the forecast set for the given evaluation timestamp.
   *
   * @param now ISO 8601 evaluation timestamp (explicit — no implicit clock)
   * @returns forecasts ([]) when no detector fires
   */
  async forecast(now: string): Promise<ReadonlyArray<A9Forecast>> {
    const [proposalRecs, enrichedRecs] = await Promise.all([
      this.adapters.proposalEvents.list(),
      this.adapters.enrichedProposals.list(),
    ]);

    const findings: ReadonlyArray<DetectorFinding> = [
      ...detectTrustVelocity(proposalRecs),
      ...detectEvidenceCompleteness(enrichedRecs, now),
      ...detectFingerprintCoincidence(proposalRecs, now),
    ];

    // No-trigger rule: never emit an empty forecast artifact.
    if (findings.length === 0) return [];

    // Group findings by subject; subjectCapability from the first finding for
    // the subject (deterministic — findings are emitted in sorted order).
    const bySubject = new Map<string, DetectorFinding[]>();
    const subjectCapability = new Map<string, string>();
    for (const f of findings) {
      const list = bySubject.get(f.subject) ?? [];
      list.push(f);
      bySubject.set(f.subject, list);
      if (!subjectCapability.has(f.subject)) subjectCapability.set(f.subject, f.subjectCapability);
    }

    const forecasts: A9Forecast[] = [];
    for (const [subject, subjectFindings] of bySubject) {
      forecasts.push(buildForecast(subjectFindings, subject, subjectCapability.get(subject) ?? "", now));
    }
    return forecasts.sort(
      (a, b) => a.subject.localeCompare(b.subject) || a.forecastId.localeCompare(b.forecastId),
    );
  }
}
