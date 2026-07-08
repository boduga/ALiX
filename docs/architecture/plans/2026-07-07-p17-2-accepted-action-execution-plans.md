# P17.2 — Accepted Action Execution Plans

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p17-2-accepted-action-execution-plans.md`

## Overview

Convert accepted remediation proposals into reviewable execution plans. No execution, no approval gate, no mutation.

## Task 1 — execution-plans.ts

Export `createExecutionPlanFromRemediation(remediation, options?)`.

Generates deterministic plan with: rollback metadata, action list by responseKind, risk level from remediation severity. Throws if remediation is not accepted.

## Task 2 — Tests

| # | Test |
|---|------|
| 1 | Accepted remediation → plan with draft status |
| 2 | Non-accepted remediation → throws |
| 3 | Plan ID deterministic |
| 4 | Actions appropriate to responseKind |
| 5 | Rollback metadata present |
| 6 | Timestamp injectable |
| 7 | Pure module: no store/audit imports |

## Acceptance

Accepted → plan. Non-accepted → throw. Deterministic. No store/audit imports.
