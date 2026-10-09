# P18.4 — Workbench CLI Integration

**Date:** 2026-07-09
**Status:** Design
**Parent:** P18.0
**Depends on:** P18.1–P18.3 (Governance Workbench Read Model)

## Purpose

Harden the three workbench CLI commands from P18.1–P18.3 into production-ready operator surfaces:
- `alix governance workbench queue`
- `alix governance workbench trace <id>`
- `alix governance workbench summary`

## Hard boundary

No lifecycle mutation. No execution. No approval/rejection. No remediation transitions. No store writes. No audit emitter imports. No operator ranking. No punitive inference. No read-model changes unless fixing a discovered CLI integration bug.

## Scope

### In scope

| Area | Detail |
|------|--------|
| Queue command | Deterministic text output, severity-colored items, queue headers, empty-state message, `--json` stable output |
| Trace command | Real lifecycle trace from read model, populated hops with gap rendering, `--json` stable output, not-found handling |
| Summary command | Aggregate counts, oldest items, queue totals, `--json` stable output |
| Integration tests | Text + JSON output tests, sentinel tests for purity |

### Out of scope

Read-model changes, new queue types, new lifecycle hop types, store writes, audit emission, operator ranking.

## CLI interface

### `alix governance workbench queue [--json]`

```
Needs Acceptance (1)
 ────────────────────────────────────────────────────────────
 CRITICAL r-abc123
    Reason: Remediation "High failure rate" needs operator acceptance
    Created: 2026-07-08T12:00:00.000Z

Needs Planning (2)
 ────────────────────────────────────────────────────────────
 WARNING r-def456
    Reason: Accepted remediation has no execution plan
    Created: 2026-07-07T09:00:00.000Z
```

JSON output emits the queues object directly from the snapshot.

### `alix governance workbench trace <remediationId> [--json]`

```
Lifecycle Trace: r-abc123
 ────────────────────────────────────────────────────────────
 signal     ● sig-1          new       — Anomaly detected
 proposal   ● r-abc123       accepted  — High failure rate
 plan       ● plan-42        draft     — 3 action(s)
 approval   ● approval-42    approved  — Approved by operator
 attempt    ● attempt-42     succeeded — Execution succeeded
 report     ● r-abc123       executed  — Execution state: executed
```

When a hop is missing, show `○ (gap)` with dimmed status. When remediation not found, show clear message.

### `alix governance workbench summary [--json]`

```
Governance Workbench Summary
 ────────────────────────────────────────────────────────────
 Queues:
   1 needs acceptance
   2 needs planning
   1 needs approval
   3 needs follow-up
   7 total pending

 Oldest items:
   r-abc123 — Remediation "High failure rate" needs operator acceptance
```

## Files

| File | Change |
|------|--------|
| `src/interfaces/cli/commands/governance.ts` | Modified — harden `runWorkbenchQueue`, `runWorkbenchTrace`, `runWorkbenchSummary` |
| `tests/cli/governance-workbench-cli.test.ts` | New — CLI integration tests |

## Required tests

1. `workbench queue` renders text output with queue headers and items
2. `workbench queue --json` emits valid JSON with all queues
3. `workbench queue` with empty stores shows empty-state message
4. `workbench trace <id>` renders populated lifecycle hops
5. `workbench trace <id> --json` emits valid JSON trace
6. `workbench trace <missingId>` shows not-found message
7. `workbench summary` renders text output with counts and oldest items
8. `workbench summary --json` emits valid JSON summary
9. CLI handler does not call append/write/transition methods
10. `governance.ts` imports no audit emitters
