# P17.5 — Execution Report

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p17-5-execution-report.md`

## Overview

Read-only report of the full execution lifecycle. Cross-references remediations, plans, approvals, and attempts. Pure module — no mutation, no audit imports.

## Task 1 — Spec + plan docs

Already done.

## Task 2 — execution-report.ts

Pure function `buildExecutionReport(input)` with:
- Time window resolution (default 7 days, `[since, until)` half-open)
- `executionState` is derived report-only state — never written back to plan
- Totals count latest attempt per plan (not all historical attempts)
- Item assembly joining remediations → plans → approvals → attempts
- Attention rule evaluation
- Deterministic sorting

## Task 3 — Report tests

16 tests covering empty inputs, classification rules, attention rules, time windows, sorting, operator no-rank.

## Task 4 — CLI integration

Add `execution report` subcommand to `handleGovernanceCommand`:
- Loads stores read-only
- Calls `buildExecutionReport`
- Renders text or JSON

## Acceptance

Read-only, no mutation, no audit imports, deterministic totals, no operator ranking.
