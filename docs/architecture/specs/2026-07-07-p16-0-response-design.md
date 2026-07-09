# P16.0 — Governance Response & Remediation Design

**Date:** 2026-07-07
**Status:** Design
**Parent:** P16.0 — Design Spec
**Depends on:** P15 (Observability & Intelligence complete)

## Purpose

P15 made ALiX observant — it can see governance trends, detect anomalies, measure operator outcomes, and produce unified reports. P16 makes ALiX **safely actionable**: it converts observations into reviewable, auditable, reversible governance actions.

**Core invariant:** No autonomous enforcement. No silent policy mutation. No automatic punishment or ranking. Every response is proposed, reviewable, auditable, and reversible.

## Design principles

1. **Proposed, not enforced.** Every remediation action starts as a proposal. A human operator reviews and approves before any mutation occurs.
2. **Auditable chain.** Every proposal, decision, and execution is recorded in the existing P14 audit trail (decorated stores). Nothing happens outside the audit boundary.
3. **Reversible.** Every mutation has a defined revert path (or is structurally non-mutating, e.g. a report suggestion).
4. **Pure analysis, separate action.** P16 analysis modules are pure (like P15). The action boundary sits in CLI handlers, gated by existing P5/P9 governance proposal flows.
5. **No new event types.** Reuse existing P14.5a event types where possible. Extend only if the event model has a proven gap.

## Proposed slice structure

| Slice | What | Key questions |
|-------|------|---------------|
| P16.1 | Anomaly Triage Recommendations | Surface P15.2 anomaly findings as structured recommendations. Why: operator can review and decide. |
| P16.2 | Governance Remediation Queue | Create reviewable remediation proposals from anomaly recommendations. Why: integrates with existing P5/P9 proposal lifecycle. |
| P16.3 | Operator Review Workbench Signals | Surface stale, incomplete, or unresolved governance items (stale deferrals, orphaned escalations, incomplete reviews). Why: operators need visibility into open items. |
| P16.4 | Policy Feedback Candidates | Suggest policy/rule updates from repeated anomalies and reversals. Why: data-driven policy iteration. |
| P16.5 | Response Report | Read-only summary of open remediations, accepted fixes, dismissed items, unresolved risk. Why: status snapshot. |

## Architectural boundary

```
P15 (observation, pure modules)
  │
  ▼
P16 analysis (pure recommendation generation)
  │
  ▼
Existing P5/P9 proposal lifecycle (human gate)
  │
  ▼
Existing P14 audited stores (execution recording)
```

P16 analysis modules are pure (zero store access, zero side effects). The proposal/execution path reuses existing governance infrastructure.

## Recommendation type

```typescript
export interface GovernanceResponseRecommendation {
  recommendationId: string;
  source: "anomaly" | "operator_workbench" | "policy_feedback";
  sourceIds: string[];
  severity: "info" | "warning" | "critical";
  responseKind:
    | "investigate_anomaly"
    | "review_stale_decision"
    | "complete_review_metadata"
    | "inspect_policy_gap"
    | "propose_policy_candidate";
  title: string;
  reason: string;
  evidenceRefs: string[];
  confidence: number;
  proposedAction: string;
  reversible: boolean;
  createdAt: string;
}
```

## Reversibility by class

| Class | Reversible? | How |
|-------|-------------|-----|
| Non-mutating report suggestion | ✅ | Dismissal |
| Unaccepted remediation proposal | ✅ | Dismiss/cancel before execution |
| Accepted remediation | ⚠️ | Only if resulting action has explicit undo path |
| External issue/proposal creation | ❌ By mutation | Close/supersede; original event persists |

## Key questions for P16.0 resolution

1. **Recommendation format.** P16.1 uses a P16-specific `GovernanceResponseRecommendation` wrapper, not P9.1's model directly. Reuses/maps P9.1 fields where useful but adds P16-specific lifecycle fields (`source`, `responseKind`, `proposedAction`, `reversible`). Reason: P16 bridges observation into remediation lifecycle — a different concern from P9.1's recommendation intelligence.
2. **Proposal binding.** Batch by anomaly type per window. Prevents proposal noise. Batch IDs deterministic: `sha256(responseKind + windowStart + windowEnd + sorted(sourceIds)).slice(0, 16)`. Re-running same window must not create duplicate proposals.
3. **Policy feedback scope.** P16.4 should only flag patterns that meet minimum evidence thresholds (N occurrences, M distinct signals). Avoid one-off noise.
4. **Response report vs P15.4.** P16.5 is about *open remediations* — proposals waiting for review, accepted fixes, dismissed items. P15.4 is about *observations* — what the audit trail shows. They complement each other.

## Audit boundary

P16 must not import audit emitters directly. Any persisted remediation or proposal mutation must route through existing audited stores or existing proposal lifecycle commands. This aligns P16 with the P14.6/P14.7 hardening model — the audit trail stays append-only and single-emission through decorated store boundaries.

## Non-goals (for entire P16 phase)

- No autonomous enforcement
- No silent policy mutation
- No automatic punishment or ranking
- No new audit event types (unless proven gap)
- No changes to P14 store interfaces or decorators
- No changes to P15 pure modules
