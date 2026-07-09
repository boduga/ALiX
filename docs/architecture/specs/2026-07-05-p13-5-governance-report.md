# P13.5 — Governance Report CLI Design Spec

**Date:** 2026-07-05
**Status:** Design — implementation deferred.

## Purpose

P13.5 is the unified terminal report aggregating all four P13 intelligence modules (P13.1–P13.4) into a single `alix governance report` command. It is **aggregation only** — no new analysis, no new scoring, no persistence.

## Architecture

```
P13.1 Ledger Analytics ───┐
P13.2 Failure Clustering ──┤
P13.3 Policy Suggestions ──┤──→ P13.5 Governance Report CLI
P13.4 Approval Friction ───┘        (aggregate + render)
```

The report handler reads all four P12 stores (`FileLedgerStore`, `FileFailureMemoryStore`), window-filters each independently, calls the appropriate pure function per section, and renders colored terminal output or JSON.

## CLI interface

```bash
alix governance report                    # Full report (all sections)
alix governance report --json             # Machine-readable
alix governance report --window 30        # Last 30 days
alix governance report --section analytics
alix governance report --section failures
alix governance report --section policies
alix governance report --section friction
```

**Flags:**
- `--window N` — time window in days (default 90). Applied independently to each store.
- `--json` — output raw JSON instead of terminal rendering
- `--section` — output only one section. Valid values: `analytics`, `failures`, `policies`, `friction`. Only one `--section` allowed per invocation.

## Behaviour

- **No `--section`:** runs all 4 modules, renders each section with headers
- **`--section analytics`:** runs only `computeAnalytics` + `computePeriodRollups` (P13.1)
- **`--section failures`:** runs only `computeFailureAnalysis` (P13.2)
- **`--section policies`:** runs only `computePolicySuggestions` (P13.3)
- **`--section friction`:** runs only `computeFrictionReport` (P13.4)
- **Invalid section:** exits with `"Unknown section"` usage message, code 2

## JSON shape (full report)

```json
{
  "analytics": { ... },
  "rollups": [ ... ],
  "failureAnalysis": { ... },
  "policySuggestions": [ ... ],
  "frictionReport": { ... }
}
```

When `--section` is used, only the requested section key is in the output.

## Human output

- Section headers with colored labels
- Empty-state messages: "No data" per section
- Advisory banner: "Governance Report — advisory only, no policies or gates modified"
- Sections rendered using existing renderers from P13.1–P13.4 where possible

## Hard boundaries

- **No new analysis logic** — only calls existing pure functions
- **No policy mutation**
- **No approval gate changes**
- **No risk threshold changes**
- **No ledger/failure-memory writes**
- **No report persistence**
- **No P13.6 checkpoint/tag**

## Files

```
src/cli/commands/governance.ts       # Amend (add report subcommand handler)
tests/governance/governance-report.test.ts  # Create
```
