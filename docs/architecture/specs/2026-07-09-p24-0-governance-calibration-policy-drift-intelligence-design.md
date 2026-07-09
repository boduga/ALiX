# P24.0 — Governance Calibration & Policy Drift Intelligence Design Spec

**Date:** 2026-07-09
**Status:** Design
**Phase:** P24 — Governance Calibration & Policy Drift Intelligence
**Depends on:** P22 (Closure Intelligence), P23 (Governance Replay & Counterfactual Readiness Review)
**Checkpoint target:** `alix-p24-governance-calibration-policy-drift-intelligence-complete`

---

## 1. Purpose

P24 introduces a read-only governance calibration analysis layer.

P22 produces per-handoff calibration outcomes. P23 produces per-lifecycle replay diffs. P24 aggregates these into windowed, confidence-bounded policy drift signals that answer:

```
Over the last N handoffs/replays, is governance calibration becoming stale, too strict, too loose, noisy, or unreliable?
```

P24 detects drift. P24 does not rewrite policy, change thresholds, rank operators, or auto-adopt recommendations.

---

## 2. Position in the Governance Ladder

P24 builds on the sealed governed action-readiness ladder:

```text
P14 — Auditability
P15 — Observability
P16 — Safe Response & Remediation
P17 — Approved Execution Lifecycle
P18 — Governance Workbench & Lifecycle Operations
P19 — Automation Readiness Projection
P20 — Controlled Manual Execution Handoff
P21 — Human Execution Evidence Ledger & Review Closure
P22 — Closure Intelligence & Handoff Quality Signals
P23 — Governance Replay & Counterfactual Readiness Review
P24 — Governance Calibration & Policy Drift Intelligence    ← NEW
```

P24 consumes already-assembled P22 calibration records and P23 replay diff/report records. P24 does not invoke P22/P23 lifecycle logic, mutate P22/P23 stores, or reinterpret their source semantics.

---

## 3. Relationship to P9.0d GovernanceDriftDetector

P24 is strictly additive to P9.0d.

| Layer | Owner | Input Sources | Output Categories |
|-------|-------|--------------|-------------------|
| P9.0d | Learning/lens/confidence drift | P8 LearningStore | `confidence_drift`, `chain_coverage_drop`, `lens_drift` |
| P24   | Governance calibration/policy drift | P22 + P23 records | `policy_drift` (via DriftFinding adapter) |

Design rules:

1. P24 may read or reference P9.0d findings as context, but must not depend on P9.0d to define, detect, or justify policy drift.
2. P24 emits DriftFinding-compatible projections with category `"policy_drift"` via a dedicated adapter.
3. P9.0d GovernanceDriftDetector remains unchanged — no new dependency on P22/P23/P24.
4. Shared reporting is allowed. Shared detection ownership is not.

---

## 4. Core Boundary

P24 is explicitly prohibited from:

- autonomous execution, background jobs, or scheduled watchers
- shell, network, MCP, browser, fetch, or subprocess calls
- execution adapters, executor imports, or tool invocations
- policy mutation or readiness threshold mutation
- approval, handoff, closure review, or audit event mutation
- persisting P24 outputs as live governance state
- operator ranking, productivity scoring, or leaderboard
- auto-adoption, auto-close, or bypass around P14–P23
- recommending exact threshold changes or rewriting policy text
- generating auto-applicable remediation proposals

P24 produces analytical artifacts only. They are not governance truth.

---

## 5. Non-Goals

P24 does not:

- execute actions
- approve or reject changes
- rewrite policy
- change readiness thresholds
- recommend exact threshold values ("change threshold from 0.72 to 0.81")
- rank policy candidates
- rank operators
- score operator productivity
- generate auto-applicable remediation proposals
- mutate P9.0d, P22, or P23 files or stores
- invoke P22/P23 lifecycle logic or reinterpret P22/P23 source semantics

P24 may identify policy drift and calibration gaps. P24 must not recommend exact threshold changes, rewrite policies, rank policy candidates, or generate auto-applicable remediation proposals.

P24 may say: _"Readiness policy may be too loose in this window."_
P24 must not say: _"Change threshold from 0.72 to 0.81."_

---

## 6. Conceptual Model

```
P22 (per-handoff CalibrationSignal[]) ──┐
                                        ├──→ P24 Policy Drift Detector
P23 (per-lifecycle ReplayDiff[] ────────┘         │
       + CandidateLesson[])                       │
                                                  ├──→ PolicyDriftSignal[]
                                                  │      (rich internal diagnostics)
                                                  │
                                                  ├──→ CalibrationConfidenceBand[]
                                                  │      (evidence certainty, not urgency)
                                                  │
                                                  └──→ DriftFinding projection
                                                         (category: "policy_drift")
```

P24 is **not a watcher**, **not a hook**, and **not a pipeline attached to P22/P23 writes**. It is a bounded, explicit on-demand analysis invoked via CLI.

---

## 7. Signal Model (P24.1)

### 7.1 Signal Kinds

Six dimensions of policy drift:

| Kind | What it detects | Source |
|------|----------------|--------|
| `calibration_skew` | P22 outcomes consistently biased (overconfident/underconfident) | P22 calibration distribution |
| `replay_divergence` | P23 counterfactuals often disagree with actual outcomes | P23 replay diff distribution |
| `convergent_gap` | Same lifecycle: P22 overconfident + P23 blocked_in_counterfactual | Paired P22 + P23 |
| `trend_direction` | Improving/degrading/stable between windows | Multi-window comparison |
| `evidence_coverage` | Signal is based on adequate sample sizes (guard) | Sample counts |
| `volatility` | Non-directional signal swing (no trend, just noise) | Sequential windows |

### 7.2 Key Distinction

```
PolicyDriftSignal = rich internal P24 diagnostic (6 kinds, direction, severity, confidence)
DriftFinding      = external/report-compatible projection (category: "policy_drift")
```

P24 emits both. They are not the same shape.

### 7.3 PolicyDriftSignal Shape

```typescript
export type PolicyDriftSignalKind =
  | "calibration_skew"
  | "replay_divergence"
  | "convergent_gap"
  | "trend_direction"
  | "evidence_coverage"
  | "volatility";

export type PolicyDriftDirection =
  | "too_loose"
  | "too_strict"
  | "stale"
  | "unstable"
  | "improving"
  | "insufficient_evidence"
  | "neutral";

export type PolicyDriftSeverity = "none" | "low" | "medium" | "high";

export interface PolicyDriftSignal {
  signalId: string;
  kind: PolicyDriftSignalKind;
  windowStart: string;
  windowEnd: string;
  direction: PolicyDriftDirection;
  severity: PolicyDriftSeverity;
  confidence: number;

  sampleSize: {
    p22CalibrationCount: number;
    p23ReplayCount: number;
    pairedLifecycleCount: number;
  };

  rates: {
    overconfidentRate?: number;
    underconfidentRate?: number;
    accurateRate?: number;
    readinessChangedRate?: number;
    blockedInCounterfactualRate?: number;
    evidenceGapChangedRate?: number;
    convergentGapRate?: number;
  };

  trend?: {
    previousWindowStart: string;
    previousWindowEnd: string;
    previousValue: number;
    currentValue: number;
    delta: number;
    direction: "improving" | "degrading" | "stable" | "insufficient_history";
  };

  implicatedPolicyAreas: string[];
  evidenceRefs: Array<{
    source: "p22_calibration" | "p23_replay_diff" | "p23_candidate_lesson";
    lifecycleId?: string;
    handoffId?: string;
    replayId?: string;
    basis?: string;
  }>;
  rationale: string[];
}
```

Internal helper return values do NOT carry boundary boilerplate. Only externally exposed P24 artifacts carry:

```typescript
readOnly: true;
noPolicyMutation: true;
noThresholdChange: true;
noAutoAdoption: true;
noRanking: true;
```

### 7.4 Default Threshold Constants

```typescript
export interface PolicyDriftThresholds {
  calibrationSkew: {
    medium: { minRate: number; minSampleSize: number };
    high:   { minRate: number; minSampleSize: number };
  };
  replayDivergence: {
    medium: { minRate: number; minReplayCount: number };
    high:   { minRate: number; minReplayCount: number };
  };
  convergentGap: {
    medium: { minRate: number; minPairedCount: number };
    high:   { minRate: number; minPairedCount: number };
  };
}

export const DEFAULT_POLICY_DRIFT_THRESHOLDS: PolicyDriftThresholds = {
  calibrationSkew: {
    medium: { minRate: 0.60, minSampleSize: 10 },
    high:   { minRate: 0.70, minSampleSize: 20 },
  },
  replayDivergence: {
    medium: { minRate: 0.40, minReplayCount: 10 },
    high:   { minRate: 0.60, minReplayCount: 20 },
  },
  convergentGap: {
    medium: { minRate: 0.30, minPairedCount: 8 },
    high:   { minRate: 0.50, minPairedCount: 12 },
  },
};
```

---

## 8. Detector Logic (P24.2)

### 8.1 Function Signature

```typescript
function detectPolicyDrift(opts: {
  calibrations: P22CalibrationSignal[];  // from handoff-readiness-calibration
  replayDiffs: P23ReplayDiff[];          // from replay-diff-model
  candidateLessons: P23CandidateLesson[]; // from counterfactual readiness evaluator
  windowStart: string;
  windowEnd: string;
  previousWindowStart?: string;
  previousWindowEnd?: string;
  thresholds?: PolicyDriftThresholds;
}): PolicyDriftSignal[];
```

No stores. No file reads. No CLI args. No date guessing inside unless defaults are passed by the caller.

### 8.2 Detection Algorithm (4-Layer Aggregation)

**Layer 1 — Source rates:**
- Compute P22 calibration distribution (overconfident/underconfident/accurate rates)
- Compute P23 replay divergence distribution (readiness_changed/blocked_in_counterfactual/evidence_gap_changed rates)

**Layer 2 — Lifecycle pairing:**
- Match P22 and P23 records by lifecycleId / handoff lineage
- Detect convergent gaps: same lifecycle shows P22 overconfidence + P23 blocked_in_counterfactual

**Layer 3 — Window comparison:**
- Compare current window rates to previous equivalent window rates
- Compute delta for trend_direction signals

**Layer 4 — Confidence guards:**
- Minimum sample count per calibration/replay dimension
- Minimum paired lifecycle count for convergent_gap detection
- Volatility check: if sequential windows swing wildly without direction → volatility signal
- Evidence coverage check: if sample counts are below floor → insufficient_evidence signal

---

## 9. Confidence Bands (P24.3)

### 9.1 Purpose

Aggregate signal confidence + evidence_coverage + volatility into band classifications.

Confidence bands are **about evidence certainty**, not action urgency.

### 9.2 Band Labels

| Label | Meaning |
|-------|---------|
| `high_confidence_drift` | Sufficient samples, low volatility, clear directional trend |
| `moderate_confidence_drift` | Adequate samples, moderate volatility, detectable trend |
| `low_confidence_drift` | Few samples or high volatility, drift direction uncertain |
| `insufficient_evidence` | Too few samples or paired lifecycles to assess |
| `volatile_or_unstable` | Signals swing without directional trend |
| `neutral_or_stable` | No drift detected within confidence bounds |

### 9.3 Prohibited Labels

Confidence bands must NOT use labels that imply actionable urgency:

```text
NOT: critical
NOT: urgent
NOT: must_fix
```

---

## 10. Report and Adapter (P24.4)

### 10.1 Calibration Report

Pure report builder that composes PolicyDriftSignal[] + CalibrationConfidenceBand[] into a structured read-only report.

### 10.2 DriftFinding Adapter

Maps selected PolicyDriftSignal entries into DriftFinding-compatible output:

```typescript
function toDriftFindings(signals: PolicyDriftSignal[]): DriftFinding[];
```

Each mapped finding carries `driftType: "policy_drift"`. The adapter does not inject findings into P9.0d's store — it produces a projection that the CLI/report layer may optionally present alongside P9.0d output.

### 10.3 CLI

```bash
alix governance calibration detect [--since <iso>] [--until <iso>] [--window N]
alix governance calibration report [--since <iso>] [--until <iso>] [--json]
alix governance calibration bands [--since <iso>] [--until <iso>] [--json]
```

The `--window N` flag is convenience shorthand for "last N days." Explicit `--since`/`--until` override windowed defaults.

CLI dispatch is wired in `src/cli/commands/governance.ts` — the dispatch file is touched but not conceptually owned by P24.

---

## 11. Determinism

P24 must be deterministic. Same inputs + same thresholds → same output every time.

Rules:
- Records sorted by timestamp ascending, stable id ascending for ties
- No randomness
- No model calls
- No external calls

---

## 12. Safety Invariants

Every externally exposed P24 artifact carries:

```typescript
readOnly: true;
noPolicyMutation: true;
noThresholdChange: true;
noAutoAdoption: true;
noRanking: true;
```

Every calibration report must clearly state:

- This report is read-only
- No policy was changed
- No readiness threshold was changed
- No operator ranking was performed
- No recommendations were auto-adopted

---

## 13. Module Boundaries

### 13.1 Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P24.1 | `src/governance/policy-drift-types.ts` | Type definitions + default threshold constants |
| P24.2 | `src/governance/policy-drift.ts` | Pure `detectPolicyDrift()` — 4-layer aggregation |
| P24.3 | `src/governance/calibration-confidence-bands.ts` | Pure `buildConfidenceBands()` |
| P24.4 | `src/governance/calibration-report.ts` | Pure report builder |
| P24.4 | `src/governance/drift-finding-adapter.ts` | DriftFinding-compatible projection |
| P24.4 | `src/cli/commands/governance-calibration.ts` | CLI entry point |
| P24.0 | `docs/architecture/specs/2026-07-09-p24-0-governance-calibration-policy-drift-intelligence-design.md` | Design spec |
| P24.5 | `docs/architecture/checkpoints/2026-07-09-p24-5-checkpoint.md` | Checkpoint doc |

### 13.2 Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Wire `alix governance calibration ...` dispatch — contains no detector logic |

### 13.3 Untouched Files

- `src/governance/governance-drift-detector.ts` (P9.0d)
- `src/governance/governance-types.ts` (DriftFinding type — consumed, not changed)
- `src/governance/replay/*` (P23)
- `src/governance/handoff-readiness-calibration.ts` (P22)
- `src/governance/handoff-intelligence-types.ts` (P22)

### 13.4 Pure Modules

```text
policy-drift-types.ts       (types only)
policy-drift.ts             (pure detector)
calibration-confidence-bands.ts (pure aggregator)
calibration-report.ts       (pure report builder)
drift-finding-adapter.ts    (pure mapper)
```

### 13.5 Store-Reading Boundary

```text
CLI command handler        (reads P22/P23 output records from filesystem)
```

### 13.6 Forbidden Imports in Pure Modules

```text
fs
child_process
exec
spawn
network clients
execution adapters
mutable stores
audit emitters
approval writers
handoff writers
closure writers
policy writers
```

---

## 14. Testing Plan

### P24.1 — Calibration Signal Model (2 tests)

1. Threshold constants load with expected defaults.
2. Signal model types are structurally sound (compile-time check).

### P24.2 — Policy Drift Detector (10 tests)

1. Empty inputs produce an `evidence_coverage` signal with direction `"insufficient_evidence"` and severity `"none"` or `"low"` (not zero signals, not a crash).
2. Calibration skew detected when overconfident rate exceeds threshold.
3. Calibration skew detected when underconfident rate exceeds threshold.
4. No calibration skew signal when accurate rate is within band.
5. Replay divergence detected when readiness_changed rate exceeds threshold.
6. Convergent gap detected when P22 + P23 align on same lifecycle.
7. Trend direction computed correctly between windows.
8. Evidence coverage signal emitted when sample count is too low.
9. Volatility signal emitted when sequential windows swing without trend.
10. Deterministic: same inputs → same output.

### P24.3 — Governance Confidence Bands (6 tests)

1. High confidence band for sufficient samples + low volatility + clear trend.
2. Low confidence band for few samples.
3. Insufficient evidence for zero samples.
4. Volatile band for non-directional swings.
5. Neutral band when no drift detected.
6. No actionable-urgency labels in output.

### P24.4 — Calibration Report + Adapter + CLI (8 tests)

1. Empty signals produce empty report.
2. DriftFinding adapter maps PolicyDriftSignal correctly (driftType: "policy_drift").
3. DriftFinding adapter preserves evidence refs.
4. JSON output stable.
5. Text output has expected structure (per existing governance CLI patterns).
6. CLI is read-only.
7. Missing P22/P23 records produce clean "insufficient evidence" (not crash).
8. --json flag produces parseable output.

### P24.5 — Checkpoint

Manual boundary verification.

---

## 15. P24 Seal Criteria

P24 may be sealed only when:

- all P24 tests pass
- no execution adapter imports exist in P24 modules
- no shell/network/tool execution exists
- no policy writer imports exist
- no readiness threshold writer imports exist
- no approval/handoff/closure writer imports exist
- no audit emitter imports exist from P24 pure modules
- P24 outputs are not persisted as live governance state
- reports clearly mark outputs as read-only
- P9.0d unchanged
- P22 unchanged
- P23 unchanged
- PolicyDriftSignal remains separate from DriftFinding
- operator ranking is absent
- auto-adoption is absent
- auto-close is absent
- no policy recommendations or threshold-change proposals are emitted

Final seal tag:

```text
alix-p24-governance-calibration-policy-drift-intelligence-complete
```

---

## 16. Acceptance Criteria for P24.0

P24.0 is complete when:

- design spec exists
- calibration purpose is defined
- boundaries are explicit (no mutation, no execution, no ranking, no auto-adoption)
- P24/P9.0d relationship is documented
- signal model (6 dimensions) is defined
- detector algorithm (4-layer aggregation) is defined
- confidence band labels are defined
- CLI shape is defined
- module boundaries are documented
- test strategy is documented
- checkpoint criteria are documented

P24.0 must not implement calibration analysis yet.

---

## 17. Proposed Slice Plan

```text
P24.0 — Design Spec
  Define calibration scope, boundaries, signal model, detector algorithm,
  confidence bands, module plan, CLI plan, and tests.

P24.1 — Calibration Signal Model (policy-drift-types.ts)
  Type definitions + default threshold constants.
  2 tests.

P24.2 — Policy Drift Detector (policy-drift.ts)
  4-layer aggregation. Pure detectPolicyDrift().
  10 tests.

P24.3 — Governance Confidence Bands (calibration-confidence-bands.ts)
  Evidence certainty classification. No urgency labels.
  6 tests.

P24.4 — Calibration Report + CLI (calibration-report.ts, drift-finding-adapter.ts, governance-calibration.ts)
  Report builder, DriftFinding adapter, CLI dispatch.
  8 tests.

P24.5 — Checkpoint
  Boundary verification. No execution, mutation, ranking, or auto-adoption.
  P9.0d/P22/P23 unchanged.
```

---

## 18. Next Steps

```text
P24.0 — Governance Calibration & Policy Drift Intelligence Design Spec
```

This document is P24.0.

Proceed to implementation planning.
