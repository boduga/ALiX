import type {
  LearningFinding,
  ProposalGovernanceRecord,
  LearningEngineOptions,
  LearningFindingKind,
} from "../contracts/learning-contract.js";

/**
 * repeated-pattern-failure-detector (T5).
 *
 * Pure function over normalized ProposalGovernanceRecord[] (T1-reconciled
 * contract, A8 wayfinder map #517). Groups `proposal.execution_failed`
 * events by a derived failure fingerprint within the evidence window;
 * emits one finding per fingerprint whose count >= minCardinality.
 *
 * ---------------------------------------------------------------------------
 * Fingerprint derivation (per locked T5 ruling)
 * ---------------------------------------------------------------------------
 *
 * The locked ruling (T5 brief) specifies fingerprint =
 * `${error ?? "unspecified"}:${capabilityId}`. The T2 adapter now
 * populates `error` from `payload.error`
 * (`src/capability/governance/governance-types.ts:181-184` — always present
 * on `ProposalExecutionFailedPayload`).
 *
 * However, `capabilityId` is empty on `proposal.execution_failed` events
 * (populated ONLY on `proposal.submitted`, via
 * `payload.candidate.target.id`; reconciled in T1-reconciliation). Applied
 * directly, the locked fingerprint would collapse every execution failure
 * into a `"<error>:"` bucket — degenerate because the capability dimension
 * is missing.
 *
 * To recover the capability dimension, the detector joins each failure
 * event to its `proposal.submitted` event on `proposalId` — the one join
 * key that IS populated on all five event types
 * (`governance-types.ts:190-225`, event-level field). This is the same
 * in-detector correlation pattern locked for T4 (outcome-contradiction
 * correlates proposals to recommendations by `proposalId` inside the
 * detector, not inside an adapter), so it introduces no new architectural
 * concept and requires no additional contract amendment beyond the `error`
 * addition.
 *
 * The submitted-event index is built from ALL records, NOT window-filtered:
 * a proposal submitted before the window may fail inside it, and the
 * submitted event serves identity resolution only. The evidence window
 * still gates which FAILURES count as evidence.
 *
 * When capability identity is unresolvable (no submitted event in the log
 * slice), the capability dimension of the fingerprint is empty — that
 * fingerprint still distinguishes failures by `error` string, which is
 * the more load-bearing signal A8 is after.
 *
 * Organisational-behavior framing (locked A8 ruling): A8 does not score or
 * blame. This detector surfaces the pattern "this capability's mutations
 * repeatedly fail during execution, grouped by error", nothing more.
 *
 * Deterministic: same input + same options -> same findings (sorted by
 * identityKey for stability).
 */
export function detectRepeatedPatternFailures(
  records: ReadonlyArray<ProposalGovernanceRecord>,
  options: LearningEngineOptions,
  now: string,
): ReadonlyArray<LearningFinding> {
  const windowStart = subtractDays(now, options.evidenceWindowDays);

  // Identity index: proposalId -> capabilityId, sourced from submitted
  // events (the only kind carrying capabilityId). Deliberately NOT window
  // filtered — identity resolution is not evidence.
  const capabilityByProposalId = new Map<string, string>();
  for (const r of records) {
    if (r.kind !== "proposal.submitted") continue;
    if (!r.capabilityId) continue;
    capabilityByProposalId.set(r.proposalId, r.capabilityId);
  }

  const grouped = new Map<string, ProposalGovernanceRecord[]>();
  for (const r of records) {
    if (r.recordedAt < windowStart || r.recordedAt > now) continue;
    if (r.kind !== "proposal.execution_failed") continue;
    const fingerprint = fingerprintOf(r, capabilityByProposalId);
    const list = grouped.get(fingerprint) ?? [];
    list.push(r);
    grouped.set(fingerprint, list);
  }

  const findings: LearningFinding[] = [];
  for (const [fingerprint, list] of grouped) {
    if (list.length < options.minCardinality) continue;
    findings.push({
      findingId: `repeated-pattern-failure:${fingerprint}`,
      kind: "repeated-pattern-failure",
      identityKey: fingerprint,
      evidenceWindow: { from: windowStart, to: now },
      occurrences: list.length,
      evidenceRefs: list.map((r) => r.eventId),
      summary: `${list.length} execution failures sharing fingerprint "${fingerprint}" within ${options.evidenceWindowDays} days`,
    });
  }
  return findings.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

/**
 * Derive the failure fingerprint for one execution_failed record.
 *
 * Per locked T5 ruling: `${error ?? "unspecified"}:${capabilityId}`.
 * `error` is sourced from the record (populated by T2 adapter from
 * `payload.error`); `capabilityId` is recovered via the submitted-event
 * join when not on the record directly.
 */
function fingerprintOf(
  record: ProposalGovernanceRecord,
  capabilityByProposalId: ReadonlyMap<string, string>,
): string {
  const error = record.error ?? "unspecified";
  // Prefer a capabilityId already on the record (defensive: a future
  // adapter revision may populate it directly), then the submitted-event
  // join. Empty capabilityId is preserved per the locked ruling (the
  // fingerprint format is `${error}:${capabilityId}` regardless).
  const capabilityId = record.capabilityId || capabilityByProposalId.get(record.proposalId) || "";
  return `${error}:${capabilityId}`;
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export const REPEATED_PATTERN_FAILURE_DETECTOR_KIND: LearningFindingKind = "repeated-pattern-failure";
