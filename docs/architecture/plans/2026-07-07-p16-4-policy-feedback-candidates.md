# P16.4 — Policy Feedback Candidates

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p16-4-policy-feedback-candidates.md`

## Overview

Pure module surfacing reviewable policy feedback candidates from repeated patterns. No mutation, no enforcement, advisory language.

## Task 1 — policy-feedback-candidates.ts

Input object with 5 data arrays. Options with configurable thresholds + window. 5 detectors mapped to policyArea per spec table. Confidence formula `Math.min(1, count / (threshold * 2))`.

## Task 2 — Tests

| # | Test |
|---|------|
| 1 | Empty → [] |
| 2 | Single anomaly below threshold → no candidate |
| 3 | Repeated anomaly type >= threshold → candidate with correct policyArea |
| 4 | Repeated dismissed pattern >= threshold → candidate |
| 5 | Repeated override >= reversalThreshold → terminal_decision_policy |
| 6 | Unresolved critical signals >= threshold → remediation_sla_policy |
| 7 | Incomplete metadata grouped by missing field, not reviewer |
| 8 | Events outside window ignored |
| 9 | candidateId deterministic |
| 10 | candidateId changes when window changes |
| 11 | confidence capped at 1 |
| 12 | Advisory language only; no punitive terms |
| 13 | Pure module sentinel |

## Acceptance

Empty → []. Repeated patterns at threshold produce candidates. One-off events do not. policyArea mapped per spec. Language advisory. No store/audit imports.
