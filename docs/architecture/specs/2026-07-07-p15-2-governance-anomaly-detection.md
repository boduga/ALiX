# P15.2 — Governance Anomaly Detection

**Date:** 2026-07-07
**Status:** Design
**Parent:** P15.0 — Governance Observability & Audit Intelligence
**Depends on:** P15.1 (Governance Trends & Diagnostics), P14.5a (Audit Store + Types)

## Purpose

Add a deterministic, explainable anomaly detection layer over the P14 audit trail. Four anomaly families detect suspicious governance patterns using static thresholds and structural rules — no ML, no statistical models, no actor-behavior drift.

Every anomaly is: deterministic, explainable, and carries a human-readable `reason`.

## Anomaly families

### 1. Volume anomalies

Detect sudden spikes or drops in key event families by comparing a recent window to a baseline window.

**Monitored event types:** `action_denied`, `action_escalated`, `override_applied`, `human_approval_requested`.

| Rule | Threshold |
|------|-----------|
| Spike in type count vs baseline (baseline > 0) | `current > baseline * 3` (critical), `> baseline * 2` (warning) |
| Drop in type count vs baseline (baseline > 0) | `current < baseline * 0.25` (warning, for supervisory events like `human_approval_requested`) |
| Spike with zero baseline (baseline === 0) | `current >= 5` (critical), `current >= 3` (warning). `current < 3` → no anomaly. |

**Default windows:** recent = last 60 min, baseline = prior 24h window at same time of day (or last 24h of data).

### 2. Risk anomalies

Detect shifts in risk-level distribution that exceed expected bounds.

| Rule | Threshold |
|------|-----------|
| Critical-risk events exceed baseline proportion | `criticalRatio > baselineCriticalRatio + 0.15` |
| High-risk events exceed baseline proportion | `highRatio > baselineHighRatio + 0.20` |
| Risk level absent from recent (present in baseline) | Only when: baseline count ≥ 5, baseline ratio ≥ 0.10, current count === 0 |

Risk ratios are computed over decision-bearing events (same set as `decisionRates` in P15.1: action_allowed, action_denied, action_escalated, override_applied).

### 3. Sequence/pattern anomalies

Detect impossible or suspicious governance sequences. All rules are structural checks on the event set — no ordering dependencies outside of timestamps.

| Rule | Detection |
|------|-----------|
| Approval without request | `action_allowed` events where human approval was required (not automated allowances). No preceding `human_approval_requested` on same trace or parentEventId chain. |
| Escalation without review context | `action_escalated` with no `human_approval_requested` or `policy_evaluated` event in the same trace (including parentEventId chain). |
| Terminal decision followed by mutation | `action_denied` or `override_applied` with a later event (same traceId AND same subjectId) that contradicts the terminal outcome. Contradictory types: `action_allowed`, `action_escalated`, `override_applied`, or `action_denied`. |
| Repeated deny/approve flip-flops | 3+ status changes on the same `subjectId` alternating between deny/disallow and approve/allow within a single trace |

Each sequence anomaly checks against events in the provided array (the full data window). False positives are acceptable when the data window is truncated — this is explainable at query time.

### 4. Audit continuity anomalies

Detect data-integrity issues in the audit trail.

| Rule | Detection |
|------|-----------|
| Timestamp regression | Event with `timestamp` earlier than the immediately preceding event in **input (append) order**. Uses the caller's ordering — NOT chronological sort, which would hide regressions by reordering. |
| Duplicate eventId | Two or more events with the same `eventId`; one deduplicated anomaly per duplicate eventId. |
| Missing hash-chain link | `previousHash` does not match the `eventHash` of the preceding event in **input (append) order**. Uses append order, not chronological, because chronological sort hides the file-order corruption the detector is designed to catch. |

Continuity anomalies are always `critical` severity.

## Output type

```typescript
export interface GovernanceAuditAnomaly {
  anomalyId: string;
  type: "volume_spike" | "volume_drop" | "risk_shift" | "risk_missing"
       | "approval_without_request" | "escalation_without_review"
       | "terminal_mutation" | "flip_flop"
       | "timestamp_regression" | "duplicate_event_id" | "hash_chain_break";
  severity: "info" | "warning" | "critical";
  /** ISO timestamp window start (or event timestamp for point anomalies). */
  windowStart: string;
  /** ISO timestamp window end (or event timestamp for point anomalies). */
  windowEnd: string;
  /** Event IDs that triggered this anomaly. */
  evidenceEventIds: string[];
  /** Human-readable explanation of what was detected. */
  reason: string;
  /** Optional sub-type metadata. */
  metadata: Record<string, unknown>;
}
```

## Architecture

```
CLI (governance.ts: runAuditAnomalies)
        ↓
audit-anomalies.ts (pure — zero store access)
  detectAnomalies(events, baselineEvents?, options?) → GovernanceAuditAnomaly[]
        ↓
Uses audit-metrics.ts helpers (eventTypeDistribution, riskDistribution, etc.)
```

`detectAnomalies` is the single entry point. It orchestrates all 4 detector passes and returns the combined, deduplicated, severity-sorted list.

**Anomaly ID determinism:** Each anomaly gets a deterministic `anomalyId` derived from `sha256(type + windowStart + windowEnd + sorted(evidenceEventIds) + stable(metadata)).slice(0, 16)`. No randomness.

**Sort order:** Results sorted by (1) severity descending (critical → warning → info), (2) `windowStart` ascending, (3) `type` ascending, (4) `anomalyId` ascending. Ensures stable, testable output.

## Files

| File | Change |
|------|--------|
| `src/governance/audit-anomalies.ts` | **New** — pure module, ~300 lines |
| `src/cli/commands/governance.ts` | Extend audit dispatch (`case "anomalies"`) + `runAuditAnomalies` handler, ~80 lines |
| `tests/governance/audit-anomalies.test.ts` | **New** — ~300 lines, unit tests per anomaly type with fixture data |

## Non-goals

- No ML or statistical models
- No actor-behavior drift detection (P15.x)
- No dynamic threshold learning (thresholds are static constants)
- No UI/dashboard (P15.4)
- No persistent anomaly store (computed per CLI invocation)
- No changes to P14 audit store, decorators, or emission

## Acceptance gate

P15.2 is complete when:
1. All 4 anomaly families produce correct results for known fixture data
2. Empty / normal (no anomaly) event set produces zero anomalies
3. CLI renders anomalies grouped by severity with `--json` support
4. All tests pass; TypeScript clean
5. Pure module invariant: zero store imports in `audit-anomalies.ts`
6. Every anomaly carries `type`, `severity`, `reason`, `evidenceEventIds`
