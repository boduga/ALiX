# P18.0 — Governance Workbench & Lifecycle Operations Design Plan

**Date:** 2026-07-08
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-08-p18-0-gov-workbench-design.md`

## Overview

Unify P14–P17 governance lifecycle into read-only operator-facing control surface. Pure read model — no store writes, no audit imports, no operator ranking.

## Task 1 — Spec + plan docs

Already done.

## Task 2 — governance-workbench.ts (P18.1 + P18.2 + P18.3)

Pure function `buildWorkbenchSnapshot(input)` with:

- **Queue classification** — each remediation classified into one of four queues (needs_acceptance, needs_planning, needs_approval, needs_followup) or none (terminal state). Each item carries `severity` (info/warning/critical) and `reason`.
- **Lifecycle trace** — per-remediation hop chain from signal → investigation → proposal → plan → approval → attempt → report, with explicit gaps
- **Summary** — queue counts, lifecycle state totals, oldest items, staleness

Core invariants:
- One queue per item, priority wins
- Derived state only — no mutation of inputs
- Deterministic ordering: queue priority asc → severity desc → createdAt asc → remediationId asc → planId asc (nulls last)
- No sorting by operator ID, operator count, or operator performance

## Task 3 — Workbench tests

16 tests covering queue classification, single-queue invariant, lifecycle detail, summary, purity.

## Task 4 — CLI integration

Add `workbench` command group to `handleGovernanceCommand`:

```
alix governance workbench queue          — show operator queues
alix governance workbench trace <id>     — lifecycle detail for one remediation
alix governance workbench summary        — aggregate snapshot
alix governance workbench queue --json   — JSON output
alix governance workbench trace <id> --json
alix governance workbench summary --json
```

CLI handler loads stores, calls pure buildWorkbenchSnapshot, renders text or JSON.

## Acceptance

Read-only, no mutation, no audit imports, deterministic queues, one queue per item, lifecycle trace with explicit gaps, CLI views work.
