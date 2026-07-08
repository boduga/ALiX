# P16.3 — Governance Workbench Signals

**Date:** 2026-07-07
**Status:** Design
**Parent:** P16.0 — Governance Response & Remediation
**Depends on:** P16.2 (Remediation Queue)

## Purpose

Surface stale, incomplete, orphaned, or unresolved governance items as response recommendations. Pure module — no stores, no CLI, no mutation, no operator ranking.

## Signals

| Signal | Detection | Source data |
|--------|-----------|-------------|
| Stale open proposal | Proposal with status=open, older than staleThresholdDays | remediationProposals |
| Unresolved critical proposal | Critical proposal with status=open older than unresolvedCriticalDays | remediationProposals |
| Repeatedly dismissed pattern | Same source anomaly type dismissed >= dismissedPatternThreshold times in window | remediationProposals |
| Incomplete review metadata | Review with null notes or null classification | reviews |
| Orphaned escalation | Escalate decision with no proposal where proposal.decisionId === decision.decisionId | decisions, actionProposals |

## Input

```typescript
export interface GovernanceWorkbenchSignalInput {
  remediationProposals: GovernanceRemediationProposal[];
  responseRecommendations: GovernanceResponseRecommendation[];
  reviews: OperatorReview[];
  decisions: OperatorDecision[];
  actionProposals: GovernanceActionProposal[];
}

export interface GovernanceWorkbenchSignalOptions {
  now: string;
  windowStart?: string;
  windowEnd?: string;
  staleThresholdDays?: number;       // default 7
  unresolvedCriticalDays?: number;    // default 1
  dismissedPatternThreshold?: number; // default 2
}
```

## Source extension

P16.3 reuses `GovernanceResponseRecommendation` but adds `"workbench_signal"` to the source union. Each recommendation carries metadata:

```typescript
metadata: {
  signalType:
    | "stale_open_proposal"
    | "unresolved_critical_proposal"
    | "repeatedly_dismissed_pattern"
    | "incomplete_review_metadata"
    | "orphaned_escalation";
  targetId: string;
}
```

## Core function

```typescript
export function detectWorkbenchSignals(
  input: GovernanceWorkbenchSignalInput,
  options: GovernanceWorkbenchSignalOptions,
): GovernanceResponseRecommendation[]
```

## Determinism

- `recommendationId = sha256("p16.3" + signalType + targetId + windowStart + windowEnd).slice(0, 16)`
- One recommendation per signalType + targetId + window. Re-running same input → identical output.
- Sort: severity desc → responseKind asc → targetId asc.

## Window semantics

[windowStart, windowEnd) — inclusive lower, exclusive upper. Applies to proposal.createdAt, review.createdAt, decision.createdAt.

## Orphaned escalation matching

An escalation is orphaned if no actionProposal has `proposal.decisionId === decision.decisionId`. Decision-level matching only. No fallback by signalId, title, or timestamp.

## Language guardrails

Review completeness signals use item-centered language. Titles like "Complete missing review metadata" — never "Operator failed to complete review", "Reviewer incomplete", or other person-focused framing.

## Files

| File | Change |
|------|--------|
| `src/governance/workbench-signals.ts` | New |
| `tests/governance/workbench-signals.test.ts` | New |
| `src/governance/response-recommendations.ts` | Amend: extend source union to include "workbench_signal" |

## Non-goals

No store, no CLI, no persistence, no audit imports, no operator ranking, no punitive language.
