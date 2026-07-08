# P16.1 — Anomaly Triage Recommendations

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p16-1-anomaly-triage-recommendations.md`

## Overview

Pure module mapping P15.2 `GovernanceAuditAnomaly[]` → `GovernanceResponseRecommendation[]`. Zero store access, zero audit imports, zero mutation.

## Task 1 — response-recommendations.ts

Export: `recommendGovernanceResponsesFromAnomalies(anomalies, options?)`.

One anomaly per recommendation. Severity mapped per spec table. Recommendation ID deterministic via sha256.

## Task 2 — Tests

| # | Test |
|---|------|
| 1 | Empty anomalies → empty recommendations |
| 2 | Critical anomaly → critical investigate_anomaly |
| 3 | Warning anomaly → warning investigate_anomaly |
| 4 | Info anomaly maps to inspect_policy_gap when type indicates policy pattern; investigate_anomaly otherwise |
| 5 | Recommendation IDs deterministic (same input → same id) |
| 6 | Source anomaly ID preserved in sourceIds |
| 7 | Evidence refs from anomaly preserved |
| 8 | Sort order: severity desc → responseKind asc → sourceId asc |
| 9 | Pure module: zero store imports, zero audit emitter imports |

## Acceptance

1. Empty list → empty output.
2. Severity mapping correct per spec.
3. Deterministic IDs.
4. Stable sort.
5. Evidence + source IDs preserved.
6. TypeScript clean.
7. No store or audit imports in module.
