# P16.4 — Policy Feedback Candidates

**Date:** 2026-07-07
**Status:** Design
**Parent:** P16.0 — Governance Response & Remediation
**Depends on:** P16.1–P16.3

## Purpose

Suggest reviewable policy/rule update candidates from repeated governance patterns. No policy mutation, no automatic rule creation, no autonomous enforcement.

## Input / Options

```typescript
export interface GovernancePolicyFeedbackCandidateInput {
  anomalies: GovernanceAuditAnomaly[];
  remediationProposals: GovernanceRemediationProposal[];
  responseRecommendations: GovernanceResponseRecommendation[];
  auditEvents: GovernanceAuditEvent[];
  reviews: OperatorReview[];
}

export interface GovernancePolicyFeedbackCandidateOptions {
  now: string;
  windowStart: string;
  windowEnd: string;
  anomalyTypeThreshold?: number;
  dismissedPatternThreshold?: number;
  reversalThreshold?: number;
  unresolvedCriticalThreshold?: number;
  incompleteMetadataThreshold?: number;
}
```

Defaults: anomaly 3, dismissed 2, reversal 2, critical 2, metadata 3.

## Candidate sources

| Source | Detection | policyArea |
|--------|-----------|------------|
| Repeated anomaly type | Same anomaly type >= threshold in window | Per mapping table |
| Repeated dismissed pattern | Same source type dismissed >= threshold | remediation_feedback_policy |
| Repeated override/reversal | override_applied after action_denied or action_allowed on same subjectId/traceId >= threshold | terminal_decision_policy |
| Unresolved critical pattern | Unresolved critical workbench signals >= threshold | remediation_sla_policy |
| Recurring incomplete metadata | Same missing field type (notes/classification/both) >= threshold. Grouped by missing field, NOT by reviewer. | review_metadata_policy |

## policyArea mapping

| Source condition | policyArea |
|-----------------|------------|
| approval_without_request | approval_policy |
| escalation_without_review | escalation_policy |
| terminal_mutation | terminal_decision_policy |
| flip_flop | decision_consistency_policy |
| timestamp_regression / duplicate_event_id / hash_chain_break | audit_integrity_policy |
| volume_spike / volume_drop | governance_volume_policy |
| risk_shift / risk_missing | risk_review_policy |
| incomplete_review_metadata | review_metadata_policy |
| unresolved_critical_proposal / stale_open_proposal | remediation_sla_policy |
| repeatedly_dismissed_pattern | remediation_feedback_policy |

## Core function

```typescript
export function detectPolicyFeedbackCandidates(
  input: GovernancePolicyFeedbackCandidateInput,
  options: GovernancePolicyFeedbackCandidateOptions,
): GovernancePolicyFeedbackCandidate[]
```

## Output type

```typescript
export interface GovernancePolicyFeedbackCandidate {
  candidateId: string;
  source: "anomaly" | "remediation" | "workbench_signal" | "operator_outcome";
  sourceIds: string[];
  policyArea: string;
  severity: "info" | "warning" | "critical";
  title: string;
  reason: string;
  evidenceRefs: string[];
  proposedPolicyDirection: string;
  confidence: number;
  createdAt: string;
  reversible: true;
}
```

## Determinism

- `candidateId = sha256("p16.4" + source + policyArea + sorted(sourceIds).join("|") + windowStart + windowEnd).slice(0, 16)`
- One candidate per (source, policyArea) meeting threshold.
- `confidence = Math.min(1, observedCount / (threshold * 2))`. No ML.
- Sort: severity desc → policyArea asc → candidateId asc.

## Language

Advisory, policy-centered, not person-focused.

Good: "Consider reviewing policy for review metadata completeness"
Bad: "operator failed", "reviewer failed", "noncompliant operator", "policy violation by operator", "punish", "rank", "blacklist"

## Files

| File | Change |
|------|--------|
| `src/governance/policy-feedback-candidates.ts` | New |
| `tests/governance/policy-feedback-candidates.test.ts` | New |

## Non-goals

No policy mutation, no automatic rule creation, no enforcement, no store/audit imports, no person-focused framing.
