# P16.5 — Response Report

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p16-5-response-report.md`

## Overview

Composition-only report over P16 artifacts. No detection, no mutation. Must not import or call detectWorkbenchSignals() or detectPolicyFeedbackCandidates().

## Task 1 — response-report.ts

Pure composition. Counts/groupings from already-produced P16 recommendations, proposals, policy candidates. No new logic.

- generatedAt from options.now
- criticalUnresolvedCount from workbench_signal/unresolved_critical_proposal
- staleRemediationCount from workbench_signal/stale_open_proposal
- Sort: severity desc → source/kind/area asc

## Task 2 — Tests

| # | Test |
|---|------|
| 1 | Empty → valid report with zeros |
| 2 | windowStart/windowEnd/generatedAt present |
| 3 | open/accepted/dismissed/resolved counts correct |
| 4 | criticalUnresolvedCount from workbench signals |
| 5 | staleRemediationCount from workbench signals |
| 6 | totalPolicyCandidates counted |
| 7 | recommendationSummary groups correctly |
| 8 | policyCandidateSummary groups correctly |
| 9 | Sort deterministic |
| 10 | Pure module: no store/audit imports; no detect* calls |

## Acceptance

Empty → valid. Counts correct. No detection calls. No store/audit imports.
