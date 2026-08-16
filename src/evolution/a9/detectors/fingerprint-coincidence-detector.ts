/**
 * A9 — fingerprint coincidence detector (Slice 1, Phase 6).
 *
 * Pure function over `proposal.execution_failed` evidence. Builds the
 * normalized failure fingerprint (normalized `error` + `capabilityId`, the
 * fingerprint contract established by the existing repository — see A8's
 * repeated-pattern-failure detector) and measures prior failure density for the
 * affected capability.
 *
 * NOT correlated using timestamps alone, proposal similarity, or arbitrary
 * payload equality — the fingerprint is the error string + capabilityId, and
 * timestamps are used only to (a) exclude future-dated evidence against `now`
 * and (b) attribute the finding to the most recent member of the group.
 *
 * A group emits a finding only when it has >= MIN_OCCURRENCES members AND the
 * deterministic density-derived internalScore meets the exported trigger.
 * capabilityId for a failure is joined through the proposal.submitted index
 * (the A8 pattern), falling back to "" when no submitted event exists.
 *
 * No I/O. No implicit clock (the `now` timestamp is an explicit parameter).
 * No hidden configuration mutation. Deterministic given the same input +
 * timestamp.
 *
 * @module evolution/a9/detectors/fingerprint-coincidence-detector
 */

import type { A9ForecastKind, DetectorFinding, ProposalEventRecord } from "../contracts/a9-contract.js";
import { clamp01 } from "../scale.js";

export const FINGERPRINT_COINCIDENCE_KIND: A9ForecastKind = "fingerprint-coincidence";

/** Minimum occurrences of a normalized failure fingerprint to be a coincidence. */
export const FINGERPRINT_COINCIDENCE_MIN_OCCURRENCES = 2;

/** Below this internalScore a failure pattern is not detection-worthy. */
export const FINGERPRINT_COINCIDENCE_TRIGGER_SCORE = 0.5;

/** Deterministic scoring weights (authorized implementation-plan defaults). */
export const FINGERPRINT_COINCIDENCE_WEIGHTS = {
  /** Weight of the recurrence magnitude (occurrences within the group). */
  occurrenceShare: 0.6,
  /** Weight of prior failure density for the capability. */
  density: 0.4,
  /** Occurrence count at/above this saturates the occurrence component. */
  occurrenceSaturation: 5,
} as const;

/** Normalize a failure error string into its fingerprint key component.
 *  Deterministic: trim + lowercase (no locale-sensitive case folding). */
export function normalizeFingerprint(error: string): string {
  return error.trim().toLowerCase();
}

/**
 * Detect fingerprint-coincidence risk from proposal.execution_failed evidence.
 *
 * @param records raw proposal event records (RAW payload preserved by the adapter)
 * @param now the evaluation timestamp (explicit — no implicit clock)
 * @returns deterministic findings, sorted by subject
 */
export function detectFingerprintCoincidence(
  records: ReadonlyArray<ProposalEventRecord>,
  now: string,
): ReadonlyArray<DetectorFinding> {
  const nowMs = Date.parse(now);

  // Index: proposalId → capabilityId from proposal.submitted events (A8 join).
  const submittedCapability = new Map<string, string>();
  for (const rec of records) {
    if (rec.kind === "proposal.submitted" && rec.capabilityId) {
      submittedCapability.set(rec.proposalId, rec.capabilityId);
    }
  }

  // Resolve failures (exclude future-dated evidence against `now`).
  const failures: Array<{ rec: ProposalEventRecord; capabilityId: string }> = [];
  for (const rec of records) {
    if (rec.kind !== "proposal.execution_failed") continue;
    if (!Number.isFinite(nowMs) || Date.parse(rec.recordedAt) > nowMs) continue;
    failures.push({
      rec,
      capabilityId: rec.capabilityId || (submittedCapability.get(rec.proposalId) ?? ""),
    });
  }

  // Group by normalized failure fingerprint (error:capabilityId).
  const groups = new Map<string, Array<{ rec: ProposalEventRecord; capabilityId: string }>>();
  for (const item of failures) {
    const error = typeof item.rec.payload["error"] === "string" ? item.rec.payload["error"] : "";
    const fingerprint = `${normalizeFingerprint(error)}:${item.capabilityId}`;
    const list = groups.get(fingerprint) ?? [];
    list.push(item);
    groups.set(fingerprint, list);
  }

  // Prior failure density per capability (over the resolved evidence set).
  const submittedCount = new Map<string, number>();
  for (const rec of records) {
    if (rec.kind === "proposal.submitted") {
      submittedCount.set(rec.capabilityId, (submittedCount.get(rec.capabilityId) ?? 0) + 1);
    }
  }
  const failureCount = new Map<string, number>();
  for (const item of failures) {
    failureCount.set(item.capabilityId, (failureCount.get(item.capabilityId) ?? 0) + 1);
  }

  const findings: DetectorFinding[] = [];
  for (const [fingerprint, members] of groups) {
    if (members.length < FINGERPRINT_COINCIDENCE_MIN_OCCURRENCES) continue;

    const capabilityId = fingerprint.slice(fingerprint.indexOf(":") + 1);
    const totalProposals = submittedCount.get(capabilityId) ?? 0;
    const totalFailures = failureCount.get(capabilityId) ?? 0;
    const priorFailureRate = totalProposals > 0 ? totalFailures / totalProposals : 0;

    const internalScore = clamp01(
      FINGERPRINT_COINCIDENCE_WEIGHTS.occurrenceShare
        * clamp01(members.length / FINGERPRINT_COINCIDENCE_WEIGHTS.occurrenceSaturation)
        + FINGERPRINT_COINCIDENCE_WEIGHTS.density * priorFailureRate,
    );
    if (internalScore < FINGERPRINT_COINCIDENCE_TRIGGER_SCORE) continue;

    // Deterministic ordering; the most recent member is the finding's subject.
    const ordered = [...members].sort((a, b) =>
      a.rec.recordedAt === b.rec.recordedAt
        ? a.rec.eventId.localeCompare(b.rec.eventId)
        : a.rec.recordedAt.localeCompare(b.rec.recordedAt),
    );
    const latest = ordered[ordered.length - 1]!.rec;

    findings.push({
      subject: latest.proposalId,
      subjectCapability: capabilityId,
      kind: FINGERPRINT_COINCIDENCE_KIND,
      internalScore,
      confidence: clamp01(priorFailureRate),
      evidenceRefs: ordered.map((m) => m.rec.eventId),
    });
  }
  return findings.sort((a, b) => a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind));
}
