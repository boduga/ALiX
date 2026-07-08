# P16.5 — Response Report

**Date:** 2026-07-07
**Status:** Design
**Parent:** P16.0 — Governance Response & Remediation
**Depends on:** P16.1–P16.4

## Purpose

Compose P16 response artifacts into a read-only governance response report. No new detectors, no new logic, no persistence, no mutation.

## Core function

```typescript
export function buildGovernanceResponseReport(
  input: GovernanceResponseReportInput,
  options: GovernanceResponseReportOptions,
): GovernanceResponseReport
```

## Input / Options

```typescript
export interface GovernanceResponseReportInput {
  recommendations: GovernanceResponseRecommendation[];
  remediationProposals: GovernanceRemediationProposal[];
  policyCandidates: GovernancePolicyFeedbackCandidate[];
}

export interface GovernanceResponseReportOptions {
  windowStart: string;
  windowEnd: string;
  now: string;
}
```

## Output

```typescript
export interface GovernanceResponseReport {
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  summary: {
    totalRecommendations: number;
    totalRemediationProposals: number;
    openRemediationCount: number;
    acceptedRemediationCount: number;
    dismissedRemediationCount: number;
    resolvedRemediationCount: number;
    criticalUnresolvedCount: number;
    staleRemediationCount: number;
    totalPolicyCandidates: number;
  };
  recommendationSummary: Array<{
    source: GovernanceResponseRecommendation["source"];
    responseKind: GovernanceResponseRecommendation["responseKind"];
    severity: GovernanceResponseRecommendation["severity"];
    count: number;
  }>;
  policyCandidateSummary: Array<{
    policyArea: GovernancePolicyFeedbackCandidate["policyArea"];
    severity: GovernancePolicyFeedbackCandidate["severity"];
    count: number;
  }>;
}
```

## Field definitions

| Field | Source |
|-------|--------|
| criticalUnresolvedCount | Count of recommendations where source=workbench_signal AND metadata.signalType=unresolved_critical_proposal |
| staleRemediationCount | Count of recommendations where source=workbench_signal AND metadata.signalType=stale_open_proposal |

## Sort order

- recommendationSummary: severity desc (critical→warning→info) → source asc → responseKind asc
- policyCandidateSummary: severity desc → policyArea asc

## Files

| File | Change |
|------|--------|
| `src/governance/response-report.ts` | New — pure composition |
| `tests/governance/response-report.test.ts` | New |

## Non-goals

No new detectors, no new logic, no persistence, no CLI, no audit imports. Must NOT import or call detectWorkbenchSignals() or detectPolicyFeedbackCandidates().
