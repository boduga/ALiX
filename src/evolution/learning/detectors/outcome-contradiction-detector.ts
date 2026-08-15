import type {
  LearningFinding,
  LearningEngineOptions,
  LearningFindingKind,
  ProposalGovernanceRecord,
  RecommendationRecord,
} from "../contracts/learning-contract.js";

/**
 * outcome-contradiction-detector (T4).
 *
 * Pure function over normalized ProposalGovernanceRecord[] and
 * RecommendationRecord[] (T1-reconciled contracts, A8 wayfinder map #517).
 *
 * Architecture: 4-adapter pattern (locked ruling per task-4-brief.md).
 * - proposal-events-adapter: emits ProposalGovernanceRecord[] (one per
 *   capability.governance.proposal.* event).
 * - recommendations-adapter: emits RecommendationRecord[] (one per A2.5
 *   recommendation in governance-store/recommendations.jsonl).
 * - Detector correlates by `proposalId` (the only join key).
 *
 * Detects capability-level patterns where the operator's disposition
 * (approved | rejected) CONTRADICTS the system's recommendation
 * (APPROVE | REJECT):
 *   - recommendation: APPROVE  + operator: rejected → contradiction
 *   - recommendation: REJECT   + operator: approved → contradiction
 *
 * Other recommendation kinds (MONITOR, REQUEST_ADDITIONAL_EVIDENCE,
 * ESCALATE) are intentionally NOT contradictions — they are not binary
 * decisions.
 *
 * Organisational-behavior framing (locked A8 ruling):
 * - A8 does NOT score governance decisions. This detector surfaces a
 *   PATTERN signal: "for this capability, the team regularly diverges
 *   from the system's recommendation in a binary way." The signal is
 *   about organizational behavior, not judgment of either party.
 *
 * Filter rules:
 * - Proposals outside evidence window: skipped.
 * - Non-approved/rejected proposals: skipped (no operator disposition).
 * - Proposals without a matching recommendation: skipped (cannot establish
 *   contradiction; per locked ruling, no silent default).
 * - Recommendation kind ∈ {MONITOR, REQUEST_ADDITIONAL_EVIDENCE, ESCALATE}:
 *   skipped (not binary, so no contradiction can be established).
 * - Capability-level grouping: counts contradictions per `capabilityId`.
 * - `minCardinality`: only emits finding when count ≥ options.minCardinality.
 *
 * Deterministic: same input + same options → same findings (sorted by
 * identityKey for stability).
 */
export function detectOutcomeContradictions(
  proposalRecs: ReadonlyArray<ProposalGovernanceRecord>,
  recommendationRecs: ReadonlyArray<RecommendationRecord>,
  options: LearningEngineOptions,
  now: string,
): ReadonlyArray<LearningFinding> {
  const windowStart = subtractDays(now, options.evidenceWindowDays);

  // Index recommendations by proposalId for O(1) lookup. If a proposalId
  // appears in multiple recommendations (rare), the LAST one wins — that's
  // the latest advisory. We don't deduplicate because the rare case of
  // duplicates is acceptable for an organizational-learning signal.
  const recByProposalId = new Map<string, RecommendationRecord>();
  for (const r of recommendationRecs) {
    recByProposalId.set(r.proposalId, r);
  }

  // Group contradictions by capabilityId. Only approved/rejected proposals
  // contribute (other kinds carry no operator disposition).
  const grouped = new Map<
    string,
    Array<{ proposal: ProposalGovernanceRecord; recommendation: RecommendationRecord }>
  >();
  for (const p of proposalRecs) {
    if (p.recordedAt < windowStart || p.recordedAt > now) continue;
    const shortKind = p.kind.replace("proposal.", "");
    if (shortKind !== "approved" && shortKind !== "rejected") continue;
    const rec = recByProposalId.get(p.proposalId);
    if (!rec) continue; // missing recommendation → cannot establish contradiction
    const isContradiction =
      (rec.kind === "APPROVE" && shortKind === "rejected") ||
      (rec.kind === "REJECT" && shortKind === "approved");
    if (!isContradiction) continue;
    const list = grouped.get(p.capabilityId) ?? [];
    list.push({ proposal: p, recommendation: rec });
    grouped.set(p.capabilityId, list);
  }

  const findings: LearningFinding[] = [];
  for (const [capabilityId, list] of grouped) {
    if (list.length < options.minCardinality) continue;
    findings.push({
      findingId: `outcome-contradiction:${capabilityId}`,
      kind: "outcome-contradiction",
      identityKey: capabilityId,
      evidenceWindow: { from: windowStart, to: now },
      occurrences: list.length,
      evidenceRefs: list.map(({ proposal, recommendation }) =>
        `${proposal.eventId}:${recommendation.recordId}`,
      ),
      summary: `${list.length} outcome contradictions for capability ${capabilityId} within ${options.evidenceWindowDays} days (operator disposition contradicted A2.5 recommendation)`,
    });
  }
  return findings.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export const OUTCOME_CONTRADICTION_DETECTOR_KIND: LearningFindingKind = "outcome-contradiction";
