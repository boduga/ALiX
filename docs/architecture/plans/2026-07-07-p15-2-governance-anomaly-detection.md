# P15.2 — Governance Anomaly Detection

**Date:** 2026-07-07
**Status:** Plan
**Depends on:** P15.1 (Governance Trends & Diagnostics), P14.5a (Audit Store + Types)
**Spec:** `docs/architecture/specs/2026-07-07-p15-2-governance-anomaly-detection.md`

## Overview

Deterministic, explainable anomaly detection over the governance audit trail. Four detector passes — volume, risk, sequence, continuity — run over the event set and return typed anomalies. Pure module, zero store access, no ML.

## Tasks

### Task 1 — `src/governance/audit-anomalies.ts` (pure module)

**Entry point:**

```typescript
export function detectAnomalies(
  events: GovernanceAuditEvent[],
  baselineEvents?: GovernanceAuditEvent[],
  options?: AnomalyOptions,
): GovernanceAuditAnomaly[]
```

`baselineEvents` is optional. When provided, volume and risk detectors compare `events` (current window) against `baselineEvents` (historical window). When absent, those detectors skip baseline comparison (returning only sequence + continuity anomalies).

**Anomaly output type** (specified in design doc — implement as-is):

```typescript
export interface GovernanceAuditAnomaly { ... }
export type AnomalyType = "volume_spike" | "volume_drop" | "risk_shift" | "risk_missing" | ...;
export type AnomalySeverity = "info" | "warning" | "critical";
```

#### Detector A — Volume anomalies

Compare per-type counts between `events` and `baselineEvents`. For each monitored event type:

1. Compute `current = count in events`, `baseline = count in baselineEvents` (if baselineEvents exists).
2. **Normal baseline** (baseline > 0):
   - If `current > baseline * 3`: emit `volume_spike` at `critical` severity.
   - If `current > baseline * 2`: emit `volume_spike` at `warning` severity.
   - If `current < baseline * 0.25` and the type is a supervisory type (`human_approval_requested`): emit `volume_drop` at `warning` severity.
3. **Zero baseline** (baseline === 0):
   - If `current >= 5`: emit `volume_spike` at `critical` severity.
   - If `current >= 3`: emit `volume_spike` at `warning` severity.
   - If `current < 3`: no anomaly (prevents "infinite growth" noise from a single event).
4. `evidenceEventIds` = the event IDs in the current window that match the type.
5. When `baselineEvents` is absent, all volume checks return nothing (no baseline, no anomaly).

**Monitored event types:** `action_denied`, `action_escalated`, `override_applied`, `human_approval_requested`.

#### Detector B — Risk anomalies

Compare risk-level proportions between `events` and `baselineEvents` (over decision-bearing events only).

**Minimum sample size:** at least 5 decision-bearing events in both the current and baseline windows. If either window has fewer than 5, risk checks return nothing (prevents misleading ratios from tiny samples).

1. Compute `currentRatio` (for critical, high) from `events`.
2. Compute `baselineRatio` from `baselineEvents`.
3. If `baselineRatio` exists and `currentRatio > baselineRatio + threshold`: emit `risk_shift`.
   Thresholds: critical = 0.15, high = 0.20.
4. If a risk level is present in `baselineEvents` but absent in `events` (count 0): emit `risk_missing`.
5. When `baselineEvents` is absent, all risk checks return nothing.

#### Detector C — Sequence/pattern anomalies

All structural — work without baseline:

1. **Approval without request**: Scan `events` for `action_allowed` events whose `metadata` or event shape indicates human approval was required (not every `action_allowed` implies a human approval gate — automated allowances are valid). For those events, trace back via `traceId`: is there a corresponding `human_approval_requested` event? If not, emit `approval_without_request` at `warning`. `evidenceEventIds` includes the `action_allowed` event and any related events on that trace.

2. **Escalation without review**: Scan `events` for `action_escalated` events. For each, trace via `traceId` or `parentEventId` chain: is there a `human_approval_requested` or `policy_evaluated` event in the same trace? If neither exists, emit `escalation_without_review` at `warning`.

3. **Terminal mutation**: Scan `events` sorted chronologically. Fire only when ALL of:
   - Terminal event is `action_denied` or `override_applied`
   - A later event exists on the same `traceId` AND same `subjectId`
   - That later event is contradictory: `action_allowed`, `action_escalated`, `override_applied`, or `action_denied`
   - Emit `terminal_mutation` at `critical`. `evidenceEventIds` = both events.
   Do NOT fire for unrelated later trace activity (different subjectId, semantically consistent event types).

4. **Flip-flop**: For each `traceId`, collect events ordered by time. Look for 3+ alternations between allow-type and deny-type events on the same `subjectId`. Emit `flip_flop` at `info`.

#### Detector D — Continuity anomalies

Two orderings of the input event array are maintained for different checks:
- **`eventsInInputOrder`** — the original array order (preserving whatever ordering the caller passed, typically newest-first from `store.list()`). Used for continuity checks.
- **`eventsChronological`** — sorted by `timestamp` ascending (oldest→newest). Used for sequence/pattern checks (`terminal_mutation`, `flip_flop`).

All structural — work on any event set:

1. **Timestamp regression**: Scan `eventsInInputOrder` for adjacent pairs. For each pair `(prev, curr)`, compare their `timestamp` values as ISO strings (lexicographic comparison, valid for ISO 8601). If `prev.timestamp > curr.timestamp` (chronologically out of order in the input stream), emit `timestamp_regression` at `critical` with both event IDs as evidence. Uses input/append order — not chronological order — because a regression is only detectable in append order.

2. **Duplicate eventId**: Scan for duplicate `eventId`. For each duplicate set (size > 1), emit `duplicate_event_id` at `critical` with all duplicate IDs. A single deduplicated anomaly per duplicate eventId (not N duplicates).

3. **Hash-chain break**: Scan `eventsInInputOrder` (same append order as `timestamp_regression`). For each event from index 1 onward, check `current.previousHash` against `prev.eventHash`. A break is when `current.previousHash !== null && current.previousHash !== prev.eventHash`. Emit `hash_chain_break` at `critical`. The first event (`previousHash === null`) is the chain anchor and always valid. **Uses input/append order, not chronological** — chronological sort can hide append-order corruption and creates false breaks when timestamps are out of order but the chain itself was correctly appended.

**Combining detectors:**

`detectAnomalies` runs all 4 detectors. Results are combined, deduplicated (same type + same evidenceSet key), and sorted by severity descending (critical → warning → info) then by windowStart ascending within each severity band.

**Anomaly ID determinism:** `anomalyId` must be deterministic (not random) to keep the module pure.

```typescript
import { createHash } from "node:crypto";

function buildAnomalyId(
  type: string,
  windowStart: string,
  windowEnd: string,
  evidenceEventIds: string[],
  metadata: Record<string, unknown>,
): string {
  const stable = [
    type,
    windowStart,
    windowEnd,
    ...[...evidenceEventIds].sort(), // copy before sort — avoid mutating the caller's array
    JSON.stringify(metadata, Object.keys(metadata).sort()),
  ].join("||");
  return `anom_${type}_${createHash("sha256").update(stable).digest("hex").slice(0, 16)}`;
}
```

**Anomaly sort order (for stable CLI output and tests):**
1. Severity descending: `critical` → `warning` → `info`
2. `windowStart` ascending
3. `type` ascending (locale‑independent)
4. `anomalyId` ascending

### Task 2 — CLI handler (`runAuditAnomalies`)

**File:** `src/cli/commands/governance.ts`

Add `case "anomalies"` to audit dispatch → `runAuditAnomalies(cwd, args, jsonMode)`.

**Flags:**
- `--recent <minutes>` — size of the "current" window in minutes (default 60). The handler fetches events from `now - recentMinutes` to `now`, then fetches a baseline window of `--baseline` minutes immediately prior to that.
- `--baseline <minutes>` — size of the baseline window in minutes (default 1440 = 24h). Only used for volume/risk detectors that require baseline comparison.
- `--since <iso>` — explicit start of the recent window (overrides `--recent`).
- `--until <iso>` — explicit end of the recent window (overrides `--recent`).
- `--severity <s>` — filter output to min severity (critical, warning, info).
- `--type <s>` — filter by anomaly type (e.g. `volume_spike`, `approval_without_request`); can be repeated.
- `--json` — machine-readable output.

**Implementation flow:**

```
1. Parse --recent (default 60), --baseline (default 1440), or --since/--until
2. Compute time boundaries:
   - If --since/--until: recentWindow = [since, until), baseline = 24h before since
   - Else: recentWindow = [now - recent, now), baseline = [now - recent - baseline, now - recent)
3. Fetch events for recent window + baseline window from store
4. Call detectAnomalies(events, baselineEvents)
5. Filter by --severity (default: show all), --type (if specified)
6. Render grouped by severity, or --json output
```

**Human output:**
```
Governance Audit Anomalies (3 found)
───────────────────────────────────────

CRITICAL:
  timestamp_regression — 2026-07-07T14:00:00
    Event aud-001 has timestamp earlier than aud-000 by 30s
    Evidence: aud-001, aud-000

WARNING:
  approval_without_request — 2026-07-07T14:05:00
    action_allowed on trace T-42 has no preceding human_approval_requested
    Evidence: aud-010, aud-011

  escalation_without_review — 2026-07-07T14:10:00
    ...
```

JSON output returns the anomaly array as-is.

### Task 3 — Unit tests

**File:** `tests/governance/audit-anomalies.test.ts`

**Fixture:** Build known "normal" and "anomalous" event sets.
- Normal: balanced event types, clean trace chains, no dups, monotonic timestamps
- Volume anomaly: 6× normal count of `action_denied`
- Risk anomaly: 40% critical events vs 5% baseline
- Sequence: `action_allowed` with no `human_approval_requested` on same trace
- Continuity: duplicate eventId, timestamp regression, hash-chain break

| # | Test | Detector |
|---|------|----------|
| 1 | Empty events → zero anomalies | All |
| 2 | Normal events → zero anomalies | All |
| 3 | Baseline zero + current 1 event → zero volume anomaly | Volume |
| 4 | Baseline zero + current 5 events → volume_spike critical | Volume |
| 5 | Spike in action_denied (3× baseline) → volume_spike critical | Volume |
| 6 | Drop in human_approval_requested (0.25×) → volume_drop warning | Volume |
| 7 | No baseline → zero volume/risk anomalies | Volume + Risk |
| 8 | High critical ratio with ≥5 decision events → risk_shift warning | Risk |
| 9 | Risk shift with <5 decision events → zero risk anomalies (minimum sample) | Risk |
| 10 | Action allowed without request → approval_without_request | Sequence |
| 11 | Escalated without review context → escalation_without_review | Sequence |
| 12 | Terminal overridden + later allow → terminal_mutation | Sequence |
| 13 | Flip-flop (3+ alternations on same subjectId + trace) → flip_flop | Sequence |
| 14 | Duplicate eventId → single deduplicated anomaly | Continuity |
| 15 | Timestamp regression in input order → timestamp_regression | Continuity |
| 16 | Hash-chain break → hash_chain_break | Continuity |
| 17 | First event with previousHash null → no false chain break | Continuity |

## Estimated additions

| File | Lines | Change type |
|------|-------|-------------|
| `src/governance/audit-anomalies.ts` | ~350 | New |
| `src/cli/commands/governance.ts` | ~120 | Extend (dispatch + handler) |
| `tests/governance/audit-anomalies.test.ts` | ~350 | New |
| **Total new** | ~820 | |

## Dependencies

- `src/governance/audit-types.ts` — `GovernanceAuditEvent`, event type constants
- `src/governance/audit-metrics.ts` — function types may be reused for baseline computation
- `src/cli/commands/governance.ts` — `parseInlineFlag`, `eventTypeColor`, BOLD/DIM/RESET constants

## Acceptance gate

P15.2 is complete when:
1. All 4 anomaly families produce correct results for known fixture data
2. Normal (no anomaly) event set produces zero anomalies
3. Each anomaly carries `type`, `severity`, `reason`, `evidenceEventIds`
4. Empty event set produces zero anomalies
5. `alix governance audit anomalies` CLI renders anomalies grouped by severity
6. `--json` output is parseable
7. All tests pass; TypeScript clean
8. Pure module invariant: zero store imports in `audit-anomalies.ts`
