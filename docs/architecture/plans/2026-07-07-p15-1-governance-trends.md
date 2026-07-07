# P15.1 — Governance Trends & Diagnostics

**Date:** 2026-07-07
**Status:** Plan
**Depends on:** P14.8 (Audit CLI Polish), P14.5a (Audit Store + Types)
**Spec:** `docs/architecture/specs/2026-07-07-p15-1-governance-trends.md`

## Overview

First observability slice on the P14 audit trail. A new pure computation module (`audit-metrics.ts`) aggregates `GovernanceAuditEvent` records into time-windowed governance metrics. A new `alix governance audit stats` CLI renders them.

**Pure module:** all metric functions take `GovernanceAuditEvent[]`, return plain objects. Zero side effects, zero store access. Every function unit-testable with inline fixture data.

## Tasks

### Task 1 — `src/governance/audit-metrics.ts` (pure computation module)

**File:** `src/governance/audit-metrics.ts` (new)

Export 10 pure functions. Each takes a `GovernanceAuditEvent[]` snapshot (never calls a store). All return plain objects or primitives.

| # | Function | Signature | Description |
|---|----------|-----------|-------------|
| 1 | `totalEvents` | `(events: GovernanceAuditEvent[]) => number` | `events.length` |
| 2 | `eventTypeDistribution` | `(events) => Record<string, number>` | Group count by `eventType` |
| 3 | `decisionRates` | `(events) => { allowed: number; denied: number; escalated: number; overridden: number }` | Proportion of each decision among decision-bearing events (action_allowed → allowed, action_denied → denied, action_escalated → escalated, override_applied → overridden). Exclude policy_evaluated and non-decision-bearing event types. Return `{ allowed: 0, denied: 0, escalated: 0, overridden: 0 }` for empty/no decision-bearing events. |
| 4 | `riskDistribution` | `(events) => Record<string, number>` | Group count by `riskLevel` |
| 5 | `timeWindowedCounts` | `(events, windowMs: number) => Array<{ windowStart: string; count: number }>` | Bucket events by time. Sort events by timestamp; anchor first bucket at `floor(firstEvent.timestamp / windowMs) * windowMs`. Bucket each event at `floor(event.timestamp / windowMs) * windowMs`. Return only non-empty buckets, sorted oldest→newest. `windowStart` is the ISO timestamp of each bucket boundary. **Throw on `windowMs <= 0`.** |
| 6 | `topActors` | `(events, n?: number) => Array<{ actorId: string; count: number; lastSeen: string }>` | Top N actors by event count. Default 10. `lastSeen` = max `timestamp` for that actor. |
| 7 | `topSubjects` | `(events, n?: number) => Array<{ subjectId: string; subjectType: string; count: number }>` | Top N subjects by event count (exclude null subjectIds). Default 10. |
| 8 | `policyActivity` | `(events) => Array<{ policyId: string; count: number }>` | Policies referenced (exclude null policyIds). |
| 9 | `traceVolume` | `(events) => { totalEvents: number; eventsWithTrace: number; traceRatio: number }` | Events that have a traceId vs total. `traceRatio = eventsWithTrace / totalEvents` (0 if empty). |
| 10 | `beforeAfterComparison` | `(events, beforeFrom: string, beforeTo: string, afterFrom: string, afterTo: string) => { before: MetricsSummary; after: MetricsSummary; delta: ExplicitDelta }` | Compare two time windows. `MetricsSummary = { totalEvents, decisionRates, riskDistribution }`. `ExplicitDelta = { totalEvents: number; decisionRates: { allowed: number; denied: number; escalated: number; overridden: number }; riskDistribution: Record<string, number> }`. Delta = after - before for each numeric field. For riskDistribution, include the union of risk keys from both windows. All window boundaries are ISO timestamps (`from <= event.timestamp < to` — inclusive lower, exclusive upper). |

**Deterministic sort / tie-breaker rules** (for test stability):
- `eventTypeDistribution`, `riskDistribution`: rendered output sorted by key ascending (locale‑independent `String.localeCompare`).
- `topActors`, `topSubjects`, `policyActivity`: sorted by `count` descending, then by `id` ascending.
- `timeWindowedCounts`: sorted by `windowStart` ascending (already oldest→newest by construction).

**Helper type:**
```ts
export interface MetricsSummary {
  totalEvents: number;
  decisionRates: { allowed: number; denied: number; escalated: number; overridden: number };
  riskDistribution: Record<string, number>;
}
```

### Task 2 — CLI handler (`runAuditStats`)

**File:** `src/cli/commands/governance.ts`

Add `case "stats"` to the audit dispatch → `runAuditStats(cwd, args, jsonMode)`.

The `stats` dispatch recognizes sub-subcommands:

- **`alix governance audit stats`** — full summary (all metrics except `beforeAfter`)
- **`alix governance audit stats before-after <bf> <bt> <af> <at>`** — two-window comparison
- **`alix governance audit stats [--window <minutes>] [--from <iso>] [--to <iso>] [--top <N>] [--json]`**

**CLI validation rules:**
- `--window`: positive integer number of minutes (reject non‑positive, non‑integer).
- `--top`: positive integer (reject non‑positive, non‑integer).
- `--from`/`--to`: valid ISO timestamps (reject unparseable).
- `before-after`: exactly 4 valid ISO timestamps (reject wrong count or unparseable).
- Time filtering: `from <= event.timestamp < to` (inclusive lower, exclusive upper).

Implementation flow:

```
function runAuditStats(cwd, args, jsonMode):
  1. Detect "before-after" sub-subcommand (args[0] === "before-after")
     - If yes, parse 4 ISO args, validate, fetch events from store, call beforeAfterComparison()
  2. Else:
     - Parse --window (default 60 min), --from, --to, --top (default 10)
     - Validate all flags
     - Fetch events from store (filter by time range if --from/--to)
     - Run all metrics (eventTypeDistribution, decisionRates, riskDistribution, etc.)
     - Render human-readable block or --json output
```

**Human output format** (modeled on existing `audit list` style with BOLD/DIM/RESET colors):

```
Governance Audit Metrics (127 events, 60m window)
───────────────────────────────────────────────────

Event type distribution:
  policy_evaluated       47
  action_escalated       35
  action_allowed         22
  override_applied       13
  action_denied           7
  human_approval_...      3

Decision rates:
  allowed     0.25
  escalated   0.28
  denied      0.06
  overridden  0.10

Risk distribution:
  low        38
  medium     41
  high       33
  critical   15

Top actors:
  system/governance          89
  operator/alice             22
  operator/bob               16

Top subjects:
  proposal/prop-001          12
  signal/sig-abc              8
  ...

Policy activity:
  p13.1-policy                5
  ...

Trace volume:
  with trace:  84  (66%)
  without:     43

Time window: 2026-07-07T14:00 → 2026-07-07T15:00
```

**`before-after` output** includes before block, after block, and delta lines.

**JSON output groups all metrics** into a single object with `{ totalEvents, eventTypeDistribution, decisionRates, ... }`. For `before-after`, `{ before, after, delta }`.

### Task 3 — Unit tests for audit-metrics.ts

**File:** `tests/governance/audit-metrics.test.ts` (new)

Build a fixture of ~15 GovernanceAuditEvent objects covering all 13 event types, varying risk levels, decisions, actors, subjects, policies, traces. Test each function:

| # | Test | Function |
|---|------|----------|
| 1 | Empty array → totalEvents = 0 | `totalEvents` |
| 2 | 5 events → totalEvents = 5 | `totalEvents` |
| 3 | Distribution counts match fixture | `eventTypeDistribution` |
| 4 | Decision rates sum to 1.0 (or 0 for empty) | `decisionRates` |
| 5 | Risk counts match fixture | `riskDistribution` |
| 6 | Time window bucketing produces correct with consistent bucket sizes | `timeWindowedCounts` |
| 7 | Top N actors limited correctly | `topActors` |
| 8 | Top subjects exclude null ids | `topSubjects` |
| 9 | Policy activity counts match fixture | `policyActivity` |
| 10 | Trace ratio 1.0 when all have traces; 0 when none do | `traceVolume` |
| 11 | Before/after comparison produces correct delta | `beforeAfterComparison` |

### Task 4 — Integration tests (optional, time permitting)

**File:** `tests/cli/audit-stats.test.ts`

Seed a `FileAuditStore` with a known set of events, call `runAuditStats` logic manually (import the pure functions, not via subprocess), assert JSON output shape. Test `--json` produces parsable output.

## Estimated additions

| File | Lines | Change type |
|------|-------|-------------|
| `src/governance/audit-metrics.ts` | ~200 | New |
| `src/cli/commands/governance.ts` | ~120 | Extend (dispatch + handler) |
| `tests/governance/audit-metrics.test.ts` | ~220 | New |
| `tests/cli/audit-stats.test.ts` | ~60 | New (light integration) |
| **Total new** | ~600 | |

## Dependencies

- `src/governance/audit-store.ts` — `FileAuditStore.list()` / `listChronological()` for data fetching
- `src/governance/audit-types.ts` — `GovernanceAuditEvent`, `GovernanceEventType`, `RiskLevel`, `VALID_EVENT_TYPES`, `VALID_DECISIONS`
- `src/cli/commands/governance.ts` — `parseInlineFlag`, `eventTypeColor`, BOLD/DIM/RESET constants

## Acceptance gate

P15.1 is complete when:
1. All 10 metric functions produce correct results for known fixture data (unit tests)
2. `alix governance audit stats` renders human-readable output with all sections
3. `alix governance audit stats --json` outputs structured, parseable JSON
4. `before-after` sub-subcommand computes deltas correctly
5. Empty audit store produces all-zero metrics with no crashes
6. All tests pass; TypeScript clean
7. GitNexus detect_changes: LOW risk
8. `src/governance/audit-metrics.ts` is a pure module — no store import, no side effects
9. No P14 audit behavior changes: no changes to audit store, decorators, emission, or event core types
10. Metric outputs are deterministic: sorted keys/lists have stable tie-breakers per the rules above
