# P22.0 — Closure Intelligence & Handoff Quality Signals Design Spec

**Date:** 2026-07-09
**Status:** Design
**Phase:** P22 — Closure Intelligence & Handoff Quality Signals
**Depends on:** P19 (Readiness Projection), P20 (Handoff Packages), P21 (Closure Review)
**Checkpoint target:** `alix-p22-closure-intelligence-handoff-quality-signals-complete`

---

## 1. Purpose

P22 learns from completed, rejected, incomplete, and follow-up-required handoffs to improve future governance readiness and handoff quality — without executing, ranking operators, or mutating policy.

P21 records what happened after manual action. P22 analyzes that record to identify patterns, weak signals, and improvement candidates. The output is intelligence, not action: P22 produces read-only reports and calibration signals that inform future governance decisions.

P22 does **not** change any existing behavior. It observes and reports.

---

## 2. Core principle

```text
P21 records closure outcomes.
P22 analyzes those outcomes for quality signals.
```

The distinction is critical:

| Capability | Allowed in P22? | Notes |
|-----------|:--------------:|-------|
| Aggregate closure outcomes | ✅ | By handoff type, readiness state, evidence completeness |
| Identify missing evidence patterns | ✅ | Read-only trend analysis |
| Compare readiness vs actual outcome | ✅ | Calibration without mutation |
| Produce quality reports | ✅ | Read-only |
| Mutate P19 readiness policy | ❌ | No policy write path |
| Auto-adopt calibration into readiness | ❌ | Advisory only |
| Rank operators by outcome | ❌ | No leaderboard, scoring, productivity metrics |
| Auto-close handoffs | ❌ | No closure override |
| Skip P21 closure review | ❌ | No bypass |

---

## 3. Phase slices

```text
P22.0 — Design Spec
P22.1 — Closure Outcome Metrics
P22.2 — Handoff Quality Signals
P22.3 — Readiness Calibration
P22.4 — Closure Intelligence Report + CLI
P22.5 — Checkpoint
```

---

## 4. Terminology

### 4.1 Closure outcome

A P21 closure review decision: `accepted`, `rejected`, `incomplete`, `needs_follow_up`. Outcomes are recorded in P21 and consumed read-only by P22.

### 4.2 Handoff quality signal

A derived indicator that a handoff or its evidence had a quality problem. Examples:

```text
- evidence_gap: required evidence was never submitted
- follow_up_needed: handoff required post-closure follow-up
- incomplete_submission: evidence was submitted but insufficient
- readiness_mismatch: P19 readiness level did not match outcome
- slow_closure: handoff took longer than expected to close
```

### 4.3 Readiness calibration

A comparison between P19's projected readiness level and P21's actual closure outcome. Calibration produces signals like:

```text
- readiness_overconfident: P19 said dry_run_allowed but handoff failed
- readiness_underconfident: P19 said manual_only but handoff succeeded first time
- readiness_accurate: P19 assessment matched outcome
```

---

## 5. Hard boundary

P22 must not:

- execute actions autonomously or on a timer;
- invoke shell, network, MCP, browser, or tool executors;
- mutate plans, approvals, remediations, policies, or external systems;
- perform external side effects;
- import direct audit emitters;
- create a new approval path or bypass P17/P18/P19/P20/P21;
- rank, score, compare, or infer operator performance;
- mutate P19 readiness policy or thresholds;
- auto-adopt calibration into readiness assessments;
- auto-close or modify any P21 closure review.

P22 may:

- aggregate closure outcomes by handoff type, readiness level, evidence completeness;
- identify weak handoff packages and missing evidence patterns;
- compare P19 readiness projections against P21 closure outcomes;
- produce read-only calibration signals and quality reports;
- surface improvement candidates for human review.

---

## 6. Data model

### 6.1 Outcome aggregation

```typescript
export interface HandoffOutcomeAggregate {
  periodStart: string;
  periodEnd: string;
  totalHandoffs: number;
  byStatus: {
    accepted: number;
    rejected: number;
    incomplete: number;
    needsFollowUp: number;
    awaitingEvidence: number;
  };
  byReadinessLevel: Record<string, number>;
  byEvidenceCompleteness: {
    full: number;
    partial: number;
    none: number;
  };
}
```

### 6.2 Quality signal

```typescript
export type HandoffQualitySignalCode =
  | "evidence_gap"
  | "follow_up_needed"
  | "incomplete_submission"
  | "readiness_mismatch"
  | "slow_closure"
  | "repeated_follow_up";

export interface HandoffQualitySignal {
  signalCode: HandoffQualitySignalCode;
  handoffId: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  details: Record<string, unknown>;
  detectedAt: string;
}
```

### 6.3 Calibration signal

```typescript
export type CalibrationLabel =
  | "overconfident"
  | "underconfident"
  | "accurate";

export interface ReadinessCalibrationSignal {
  handoffId: string;
  planId: string;
  readinessLevel: string;
  closureDecision: string;
  calibration: CalibrationLabel;
  evidenceComplete: boolean;
  evidenceCount: number;
}
```

---

## 7. P22.1 — Closure Outcome Metrics

### 7.1 Purpose

Aggregate P21 closure outcomes into period-based metrics. Pure read-only computation.

```typescript
export function aggregateClosureOutcomes(
  handoffRefs: HandoffRef[],
  evidenceRefs: HumanExecutionEvidenceRef[],
  closureReviews: HumanExecutionClosureReview[],
  periodStart: string,
  periodEnd: string,
): HandoffOutcomeAggregate;
```

### 7.2 Grouping dimensions

- By closure status (accepted, rejected, incomplete, follow-up)
- By P19 readiness level (reversible, dry_run_capable, manual_only)
- By evidence completeness (full/partial/none based on required vs captured ratio)

### 7.3 Rules

- No operator identity or ranking in aggregates.
- Period uses half-open `[periodStart, periodEnd)` interval.
- Readiness level derived from the handoff's P19 assessment (stored in handoff metadata).
- Aggregates are recomputed on demand — no persistence.

---

## 8. P22.2 — Handoff Quality Signals

### 8.1 Purpose

Detect quality problems in handoff packages and evidence submissions.

```typescript
export function detectHandoffQualitySignals(
  handoffRefs: HandoffRef[],
  evidenceRefs: HumanExecutionEvidenceRef[],
  closureReviews: HumanExecutionClosureReview[],
): HandoffQualitySignal[];
```

### 8.2 Signal detection rules

| Signal | Condition | Severity |
|--------|-----------|----------|
| `evidence_gap` | Required evidence ref never submitted for a handoff | `warning` |
| `incomplete_submission` | Closure review was `incomplete` | `warning` |
| `follow_up_needed` | Closure review was `needs_follow_up` | `info` |
| `repeated_follow_up` | Same handoff had 2+ `needs_follow_up` reviews | `critical` |
| `slow_closure` | Time between handoff generation and closure review > N days (default: 14) | `info` |

### 8.3 Rules

- Signals are computed read-only — never persisted.
- No operator identity in signal data.
- `slow_closure` threshold is configurable via options parameter.

---

## 9. P22.3 — Readiness Calibration

### 9.1 Purpose

Compare P19 readiness projections against P21 closure outcomes.

```typescript
export function calibrateReadiness(
  handoffRefs: HandoffRef[],
  closureReviews: HumanExecutionClosureReview[],
): ReadinessCalibrationSignal[];
```

### 9.2 Calibration rules

| Readiness Level | Closure Decision | Calibration |
|----------------|-----------------|-------------|
| `dry_run_allowed` | `accepted` | `accurate` |
| `dry_run_allowed` | `rejected` | `overconfident` |
| `dry_run_allowed` | `incomplete` | `overconfident` |
| `manual_only` | `accepted` | `underconfident` |
| `manual_only` | `rejected` | `accurate` |
| `reversible` | `accepted` | `accurate` |
| `reversible` | `rejected` | `overconfident` |

Rules:
- Calibration is advisory only. It does not change any P19 thresholds.
- Calibration is recomputed on demand — no persistence.
- No operator identity in calibration data.

---

## 10. P22.4 — Closure Intelligence Report + CLI

### 10.1 Purpose

Read-only report showing closure-derived quality signals, outcome aggregates, and calibration signals.

### 10.2 Report types

```text
alix governance intelligence outcomes [--since <iso>] [--until <iso>] [--json]
alix governance intelligence signals [--severity <level>] [--json]
alix governance intelligence calibration [--json]
alix governance intelligence report [--json] [--since <iso>] [--until <iso>]
```

### 10.3 Report output rules

- No operator ranking, productivity scoring, or leaderboard language.
- Text output is deliberately neutral (handoff IDs, status counts, signal codes).
- JSON output is stable and schema-versioned.

---

## 11. Validation rules

- Period start < period end.
- All input handoff/evidence/review refs are validated by P21 contracts — P22 trusts them.
- Unknown handoff types or readiness levels are excluded from calibration (not a hard error).

---

## 12. Files

| File | Change |
|------|--------|
| `docs/architecture/specs/2026-07-09-p22-0-closure-intelligence-handoff-quality-signals-design.md` | New |
| `src/governance/handoff-intelligence-types.ts` | P22 types (pure) |
| `src/governance/handoff-outcome-aggregate.ts` | P22.1 |
| `src/governance/handoff-quality-signals.ts` | P22.2 |
| `src/governance/handoff-readiness-calibration.ts` | P22.3 |
| `src/governance/handoff-intelligence-report.ts` | P22.4 pure report builder |
| `src/cli/commands/governance.ts` | Extend CLI (P22-INTELLIGENCE-START/END) |

---

## 13. Test plan

### P22.1 — 6 tests
1. Empty inputs produce zero aggregates.
2. Accept/reject/incomplete/follow-up counts correct.
3. Readiness level grouping.
4. Evidence completeness grouping (full/partial/none).
5. Period filtering.
6. No operator identity in output.

### P22.2 — 8 tests
1. Evidence gap detected when required ref missing.
2. Incomplete submission detected.
3. Follow-up needed detected.
4. Repeated follow-up detected.
5. Slow closure detected.
6. No false positives for complete handoffs.
7. Severity levels correct.
8. No operator identity in signals.

### P22.3 — 7 tests
1. accurate for matching readiness/accepted.
2. overconfident for dry_run_allowed + rejected.
3. overconfident for dry_run_allowed + incomplete.
4. underconfident for manual_only + accepted.
5. accurate for manual_only + rejected.
6. Unknown readiness level excluded.
7. No operator identity in calibration.

### P22.4 — 6 tests
1. Empty inputs produce zero totals.
2. All three computation stages compose correctly.
3. JSON output stable.
4. No operator ranking in output.
5. Text output has expected structure.
6. CLI is read-only.

---

## 14. Acceptance gate

P22 is complete when:
- P22.0 design spec exists and is approved.
- P22.1 closure outcome metrics aggregate across status, readiness, evidence.
- P22.2 quality signals detect evidence gaps, incomplete submissions, follow-ups.
- P22.3 readiness calibration compares P19 vs P21 without mutation.
- P22.4 intelligence report is read-only, text + JSON, no operator ranking.
- P22.5 checkpoint verifies no execution, no policy mutation, no ranking.
- TypeScript clean, all tests passing.

---

## 15. Seal statement target

```text
P22 — Closure Intelligence & Handoff Quality Signals ✅ SEALED

ALiX can now:
- aggregate closure outcomes by status, readiness level, evidence completeness
- detect handoff quality signals (evidence gaps, follow-ups, slow closure)
- calibrate P19 readiness projections against P21 closure outcomes
- produce read-only intelligence reports

ALiX still cannot:
- execute
- mutate policy or readiness thresholds
- rank operators
- auto-close handoffs
- bypass P21 closure review
```
