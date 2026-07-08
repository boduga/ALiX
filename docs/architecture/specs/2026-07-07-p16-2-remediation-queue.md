# P16.2 — Governance Remediation Queue

**Date:** 2026-07-07
**Status:** Design
**Parent:** P16.0 — Governance Response & Remediation
**Depends on:** P16.1 (Anomaly Triage Recommendations)

## Purpose

Convert P16.1 response recommendations into reviewable remediation proposals with a pure lifecycle shape: open → accepted/dismissed → resolved. No autonomous enforcement, no policy mutation, no direct audit imports.

## Core function

```typescript
export function createRemediationProposalsFromRecommendations(
  recommendations: GovernanceResponseRecommendation[],
  options?: GovernanceRemediationProposalOptions,
): GovernanceRemediationProposal[]
```

## Options

```typescript
export interface GovernanceRemediationProposalOptions {
  windowStart: string;
  windowEnd: string;
  now?: string;
}
```

## Types

```typescript
export type GovernanceRemediationProposalStatus =
  | "open"
  | "accepted"
  | "dismissed"
  | "resolved";

export type GovernanceRemediationResponseKind =
  | "investigate_anomaly"
  | "inspect_policy_gap"
  | "verify_audit_integrity";

export interface GovernanceRemediationProposal {
  proposalId: string;
  sourceRecommendationIds: string[];
  title: string;
  severity: "info" | "warning" | "critical";
  windowStart: string;
  windowEnd: string;
  evidenceRefs: string[];
  status: "open";
  createdAt: string;
  responseKind: GovernanceRemediationResponseKind;
  proposedAction: string;
  reversible: true;
}
```

## Determinism

- `proposalId = sha256("p16.2" + responseKind + severity + windowStart + windowEnd + sorted(sourceRecommendationIds).join("|")).slice(0, 16)`
- Batch by (responseKind, severity, windowStart, windowEnd). One proposal per batch.
- Duplicate source recommendation IDs → no duplicate proposal.
- Sort by severity desc → createdAt asc → proposalId asc.

## Batch aggregation rules

| Field | Rule |
|-------|------|
| title | Deterministic summary: `"Remediation: {responseKind} ({count} items)"` |
| proposedAction | Deterministic generic action for the batch responseKind |
| evidenceRefs | Unique, sorted union of all source recommendation evidenceRefs |
| sourceRecommendationIds | Unique, sorted list of all source recommendation IDs |
| createdAt | `options.now` if provided, else current ISO timestamp |
| severity | Highest severity in the batch (critical > warning > info) |

## Files

| File | Change |
|------|--------|
| `src/governance/remediation-queue.ts` | New — pure module |
| `tests/governance/remediation-queue.test.ts` | New |

## Non-goals

No store, no CLI, no persistence, no lifecycle transitions beyond open, no audit imports.
