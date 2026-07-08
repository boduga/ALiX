# P16.1 — Anomaly Triage Recommendations

**Date:** 2026-07-07
**Status:** Design
**Parent:** P16.0 — Governance Response & Remediation
**Depends on:** P15.2 (Anomaly Detection)

## Purpose

Convert P15.2 deterministic anomalies into P16 `GovernanceResponseRecommendation` objects. Pure module, zero mutation, no store access, no CLI.

## Core function

```typescript
export function recommendGovernanceResponsesFromAnomalies(
  anomalies: GovernanceAuditAnomaly[],
  options?: { now?: string; minSeverity?: string },
): GovernanceResponseRecommendation[]
```

## Mapping rules

| Input severity | Output severity | responseKind |
|----------------|----------------|--------------|
| critical       | critical       | investigate_anomaly |
| warning        | warning        | investigate_anomaly |
| info           | info           | `inspect_policy_gap` if anomaly type indicates policy drift or repeated pattern; `investigate_anomaly` otherwise. |

Every anomaly maps to exactly one recommendation. Evidence refs and source anomaly ID preserved.

## Determinism

- `recommendationId = sha256("p16.1" + responseKind + severity + sorted(sourceIds).join("|")).slice(0, 16)`
- Stable sort: severity desc → responseKind asc → sourceId asc

## Output type

```typescript
export interface GovernanceResponseRecommendation {
  recommendationId: string;
  source: "anomaly";
  sourceIds: string[];
  severity: "info" | "warning" | "critical";
  responseKind: "investigate_anomaly" | "inspect_policy_gap" | "verify_audit_integrity";
  title: string;
  reason: string;
  evidenceRefs: string[];
  confidence: number;
  proposedAction: string;
  reversible: true;
  createdAt: string;
}
```

## Files

| File | Change |
|------|--------|
| `src/governance/response-recommendations.ts` | New |
| `tests/governance/response-recommendations.test.ts` | New |

## Non-goals

No queue, no persistence, no CLI, no P5/P9 lifecycle, no accepted/dismissed status, no policy mutation.
