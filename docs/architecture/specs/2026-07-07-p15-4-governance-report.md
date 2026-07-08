# P15.4 — Governance Observability Report

**Date:** 2026-07-07
**Status:** Design
**Parent:** P15.0 — Governance Observability & Audit Intelligence
**Depends on:** P15.1–P15.3a

Read-only CLI report aggregating P15.1 trends, P15.2 anomalies, P15.3a effectiveness. Composition only — no new logic.

## Architecture

CLI handler → `report-orchestrator.ts` (pure composition, zero store imports) → calls P15.1/P15.2/P15.3a functions → unified report.

## CLI

```
alix governance audit report [--section all|trends|anomalies|effectiveness] [--since] [--until] [--json]
```

## Window semantics

- `reportWindow = [since, until)`, default last 7 days.
- Trends + effectiveness: use `reportWindow`.
- Anomalies: current = `reportWindow`, baseline = equal-length window before `reportWindow`.

## Files

| File | Change |
|------|--------|
| `src/governance/report-orchestrator.ts` | New — pure composition |
| `src/cli/commands/governance.ts` | Add `case "report"` + handler |
| `tests/governance/report-orchestrator.test.ts` | New — unit tests |
| `tests/cli/audit-report.test.ts` | New — integration tests |

## Non-goals

No new metrics, detectors, effectiveness signals, persistence, or dashboard.
