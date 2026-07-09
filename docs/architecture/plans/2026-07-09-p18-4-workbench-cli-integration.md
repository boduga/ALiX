# P18.4 — Workbench CLI Integration Plan

**Date:** 2026-07-09
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-09-p18-4-workbench-cli-integration.md`

## Overview

Polish the P18.1–P18.3 workbench CLI commands into production-ready operator surfaces. No read-model changes — CLI-only hardening.

## Task 1 — Spec + plan docs

Already done.

## Task 2 — Harden `runWorkbenchQueue`

- Deterministic text output with queue headers, severity coloring, item blocks
- Empty-state message when no items
- JSON output from snapshot.queues

## Task 3 — Harden `runWorkbenchTrace`

- Load all currently available stores read-only (ExecutionStore for attempts)
- For stores not yet implemented, pass empty arrays with TODO — behavior stays deterministic
- Call `buildWorkbenchSnapshot`
- Select the trace item/remediation from the snapshot; render its data
- Render populated hops with `●` and gaps with `○`
- Not-found handling for unknown remediationId
- No duplicate lifecycle classification logic in CLI handler

## Task 4 — Harden `runWorkbenchSummary`

- Render queue counts, lifecycle totals, oldest items
- JSON output from snapshot.summary

## Task 5 — CLI integration tests

10 tests covering text rendering, JSON validity, empty states, not-found, sentinel checks for no writes / no audit imports.

## Acceptance

Text output is deterministic and readable. JSON output is stable and valid. Sentinel tests confirm no writes, no audit imports, no mutation.
