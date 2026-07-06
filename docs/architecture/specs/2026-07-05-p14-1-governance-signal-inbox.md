# P14.1 — Governance Signal Inbox Specification

**Date:** 2026-07-05
**Status:** Implemented — retrospective spec
**PR:** #230
**Tag:** `alix-p14-1-complete`
**Parent:** P14.0 — Governance Operator Workflow Design

## Purpose

P14.1 implements the first concrete layer of the P14 Governance Operator Workflow: the **Governance Signal Inbox**.

P13 produces advisory governance intelligence across ledger analytics, failure clustering, policy suggestions, and approval friction. P14.1 normalizes those outputs into durable, reviewable `GovernanceSignal` records that an operator can inspect in later P14 phases.

P14.1 does not introduce operator decisions, action proposals, enforcement, audit execution, or GitHub issue conversion.

## Scope

P14.1 adds:

- `GovernanceSignal` type model
- `EvidenceRef` type model
- `SignalStatus` and `SignalType` enums
- `FileSignalStore` append-only JSONL store
- `validateGovernanceSignal()`
- P13.1 ledger analytics normalizer
- P13.2 failure clustering normalizer
- P13.3 policy suggestion normalizer
- P13.4 approval friction normalizer
- Aggregate `normalizeAllP13Outputs()` helper
- Deduplication for repeated inbox refreshes
- `alix governance inbox`
- `alix governance inbox refresh`
- Tests for validation, store behavior, deduplication, normalizers, aggregate output, and evidence invariants

## Non-goals

P14.1 does not:

- Create operator reviews
- Capture decisions
- Accept, dismiss, defer, or escalate signals
- Create action proposals
- Create GitHub issues
- Write audit entries
- Modify P13 scoring
- Modify P13 stores
- Mutate approval gates
- Modify policies or thresholds
- Execute enforcement actions

## Architecture

```text
P13.1 Ledger Analytics ───┐
P13.2 Failure Clustering ─┤
P13.3 Policy Suggestions ─┤──→ P14.1 Governance Signal Inbox
P13.4 Approval Friction ──┘
```

P14.1 is a read-only consumer of P13 outputs. It reads P12/P13 source data, runs existing P13 analysis functions, normalizes the results, deduplicates against existing new signals, and appends new `GovernanceSignal` records to the signal store.

## Core Objects

### GovernanceSignal

A `GovernanceSignal` is a single actionable advisory observation from P13.

```typescript
interface GovernanceSignal {
  signalId: string;
  sourcePhase: "p13.1" | "p13.2" | "p13.3" | "p13.4";
  signalType: "trend_alert" | "failure_cluster" | "policy_suggestion" | "friction_alert";
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;            // 0.0–1.0
  title: string;
  description: string;
  evidenceRefs: EvidenceRef[];   // non-empty
  recommendation: string;
  metadata: Record<string, unknown>;
  status: "new" | "reviewing" | "decided" | "dismissed" | "escalated";
  requestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### EvidenceRef

```typescript
interface EvidenceRef {
  source: string;        // e.g. "ledger-analytics", "failure-analysis"
  id: string;            // source record or query identifier
  description: string;   // what this evidence demonstrates
}
```

Every signal must include at least one valid `EvidenceRef` with non-empty `source`, `id`, and `description`.

## Store

P14.1 uses an append-only JSONL store:

```text
governance-signals.jsonl
```

The store exposes:

```typescript
interface SignalStore {
  append(signal: GovernanceSignal): Promise<void>;
  list(limit?: number): Promise<GovernanceSignal[]>;
  getById(signalId: string): Promise<GovernanceSignal | null>;
  query(filter: Partial<GovernanceSignal>): Promise<GovernanceSignal[]>;
}
```

Append operations validate signals before writing. Invalid rows are skipped on read rather than causing the inbox to fail.

## Signal Normalization

### P13.1 → trend_alert

Creates trend signals from ledger analytics when:

- Trend direction is degrading (severity: high)
- Trend direction is improving (severity: low)
- Approval rate is below 0.5 (severity: high)
- Average risk score is above 50 (severity: medium)

### P13.2 → failure_cluster

Creates failure-cluster signals for recurring failures with severity at least medium (approval_denied, pr_rejected → high; policy_denied, file_scope_violation, blocked_command → medium). Test failures and verification timeouts (severity: low) are skipped.

### P13.3 → policy_suggestion

Creates policy-suggestion signals from P13.3 suggestions. P13.3 already applies its own confidence (≥0.5) and evidence gates. Severity maps: tighten and remove_rule → high; add_rule and loosen → medium.

### P13.4 → friction_alert

Creates friction signals for:

- Individual approval gates with friction score above 0.3 threshold (≥0.6 → high; >0.3 and <0.6 → medium)
- Overall approval workflow friction above 0.3 threshold (≥0.6 → critical; >0.3 and <0.6 → high)

## Deduplication

P14.1 deduplicates new candidate signals against existing signals that are still in `new` status.

Deduplication key:

```text
sourcePhase + ":" + signalType + ":" + title
```

This prevents repeated `inbox refresh` runs from appending duplicate unresolved signals while still allowing new signals after the earlier signal has been reviewed or otherwise moved out of `new`.

## CLI

```bash
alix governance inbox                          # List all signals (newest first)
alix governance inbox --status new             # Filter by status
alix governance inbox --status dismissed       # Show dismissed signals
alix governance inbox --source p13.3           # Filter by source phase
alix governance inbox --json                   # Machine-readable output

alix governance inbox refresh                  # Capture signals from all P13 modules
alix governance inbox refresh --window 30      # Override analysis window (days)
alix governance inbox refresh --json           # Machine-readable output
```

The refresh command is advisory only. It reads governance data, creates inbox records, and does not mutate policies, gates, approval state, P13 scoring, or P13 stores.

## Invariants

| # | Invariant | Enforcement |
|---|---|---|
| 1 | **P13 remains advisory** — P14.1 consumes P13 outputs but does not modify P13 analysis functions, scoring, thresholds, or stores. | P14.1 calls P13 pure functions but never writes to P12/P13 stores. |
| 2 | **Signals are evidence-backed** — every signal must include at least one valid `EvidenceRef` with non-empty source, id, and description. | `validateGovernanceSignal()` rejects empty or malformed evidenceRefs. |
| 3 | **Inbox refresh is non-enforcing** — refresh may append signals, but it cannot approve, reject, block, escalate, or execute anything. | No enforcement code paths exist in P14.1. |
| 4 | **Signal storage is append-only** — P14.1 appends new records and does not update or delete existing records. | `FileSignalStore` has no update/delete methods. |
| 5 | **Dedup applies only to unresolved new signals** — existing `new` signals suppress duplicates. Reviewed or resolved signals do not permanently suppress future signals. | `isDuplicate()` only matches against `status === "new"`. |
| 6 | **P14.1 does not leak into P14.2+ behavior** — no reviews, decisions, action proposals, audit entries, or GitHub issue conversion. | No types or code paths for those concepts. |

## Verification

P14.1 verification covered:

- Type validation (12 tests)
- Evidence reference validation (5 tests)
- Append-only store behavior (11 tests)
- Store list/query/getById behavior
- Deduplication (4 tests)
- P13.1 trend normalization (5 tests)
- P13.2 failure-cluster normalization (4 tests)
- P13.3 policy-suggestion normalization (3 tests)
- P13.4 friction-alert normalization (4 tests)
- Aggregate normalization with dedup (2 tests)

Total: 54 tests.

## Files

```text
src/governance/governance-signal.ts               # 644 lines — types, store, normalizers, dedup
src/cli/commands/governance.ts                     # Amended — inbox + inbox refresh handlers
tests/governance/governance-signal.test.ts         # 763 lines — 54 tests
```

## Outcome

P14.1 established the durable signal substrate needed by later P14 phases. P14.2 can now build operator review sessions on top of `GovernanceSignal` records without re-running P13 analysis directly.
