# P15.4 — Governance Observability Report

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p15-4-governance-report.md`

## Overview

Composition layer. Single `alix governance audit report` combines P15.1 trends, P15.2 anomalies, P15.3a signals. No new logic.

## Tasks

### Task 1 — `src/governance/report-orchestrator.ts`

Pure module. `buildReport(auditEvents, decisions, reviews, proposals, transitions, options)`.
Returns unified `{ windowStart, windowEnd, trends?, anomalies?, effectiveness? }`.
Omits section keys not requested.

### Task 2 — CLI handler

Add `case "report"` + `runAuditReport`. Fetches stores, calls orchestrator, renders.

### Task 3 — Unit tests

`tests/governance/report-orchestrator.test.ts` — section composition, empty data, JSON shape.

### Task 4 — CLI integration tests

`tests/cli/audit-report.test.ts` — seeded stores, --section filtering, --json.

## Acceptance gate

1. All 3 sections render in full report.
2. `--section` filters correctly.
3. `--json` parseable.
4. Default window = last 7 days.
5. Empty data produces zero-valued report.
6. Anomaly baseline = equal-length window before reportWindow.
7. `report-orchestrator.ts` has zero store imports.
8. Tests pass; TS clean.
9. No changes to P15.1–P15.3a modules.
