# P16.3 — Governance Workbench Signals

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p16-3-governance-workbench-signals.md`

## Overview

Pure module detecting stale, incomplete, orphaned, unresolved governance items. Input object, not positional arrays. No stores, no CLI, no operator ranking.

## Task 1 — Extend source union

**File:** `src/governance/response-recommendations.ts`

Add `"workbench_signal"` to `GovernanceResponseRecommendation.source` union.

## Task 2 — workbench-signals.ts

5 detectors, takes input object `GovernanceWorkbenchSignalInput` + options.

| Signal | Threshold | responseKind |
|--------|-----------|-------------|
| Stale open | > staleThresholdDays (default 7) | investigate_anomaly |
| Unresolved critical | critical + > unresolvedCriticalDays (default 1) | investigate_anomaly |
| Dismissed pattern | >= dismissedPatternThreshold (default 2) same source type | inspect_policy_gap |
| Incomplete review | null notes or null classification | complete_review_metadata |
| Orphaned escalation | no proposal with matching decisionId | investigate_anomaly |

## Task 3 — Tests

| # | Test |
|---|------|
| 1 | Empty inputs → [] |
| 2 | Open proposal older than staleThresholdDays → stale_open_proposal signal |
| 3 | Open proposal not older → no signal |
| 4 | Critical open > unresolvedCriticalDays → unresolved_critical signal |
| 5 | Critical open newer → no signal |
| 6 | Two dismissed proposals same source type → inspect_policy_gap |
| 7 | One dismissed → no pattern signal |
| 8 | Dismissed outside window ignored |
| 9 | Review null notes → complete_review_metadata |
| 10 | Review with notes + classification → no signal |
| 11 | Escalate with matching proposal.decisionId → no orphan |
| 12 | Escalate without matching proposal → orphan signal |
| 13 | IDs deterministic |
| 14 | Sort deterministic |
| 15 | No operator ranking terms in titles/reasons |
| 16 | Pure module: no store/audit imports |

## Acceptance

Empty → []. All 5 signals correct. IDs deterministic. No ranking language. No store/audit imports.
