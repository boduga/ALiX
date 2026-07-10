# P27.0 — Policy Review Learning Synthesis & Drift Outcome Correlation Design Spec

**Date:** 2026-07-09
**Status:** Design
**Phase:** P27 — Policy Review Learning Synthesis & Drift Outcome Correlation
**Depends on:** P24 (Governance Calibration & Policy Drift Intelligence), P25 (Governed Policy Review Candidate Lifecycle), P26 (Policy Review Outcome Ledger & Candidate Closure Intelligence)
**Checkpoint target:** `alix-p27-policy-review-learning-synthesis-drift-outcome-correlation-complete`

---

## 1. Primary Invariant

P27 produces **descriptive** governance intelligence.

P27 SHALL NOT produce **prescriptive** governance intelligence.

| Descriptive (✓) | Prescriptive (✗) |
|----------------|------------------|
| Correlations | Policy recommendations |
| Summaries | Threshold tuning |
| Frequencies | Reviewer guidance |
| Timelines | Candidate prioritization |
| Distributions | Automatic adoption |
| Traceability | Governance decisions |

P27 should explain what the governance system learned, not decide what the governance system should do.

---

## 2. Purpose

P27 correlates P24 policy drift signals, P25 review candidates, and P26 human review outcomes into read-only learning synthesis.

P27 answers:

- Which kinds of drift evidence most often lead to which review outcomes?
- What is the outcome distribution by signal kind, severity, and direction?
- How complete is the evidence-to-outcome trace chain?
- What are the time-to-review and time-to-outcome distributions?
- Are there repeated drift patterns across windows?
- What is the confidence distribution of signals that reached review?

P27 transforms governance history into governance understanding — not governance decisions.

---

## 3. Position in the Governance Ladder

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
P24 — Governance Calibration & Policy Drift Intelligence
P25 — Governed Policy Review Candidate Lifecycle
P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence
P27 — Policy Review Learning Synthesis & Drift Outcome Correlation    ← NEW
```

---

## 4. Four Invariants

### 4.1 Historical Truth

Reports reflect recorded governance events only. No inferred events. No simulated outcomes. Every data point in a P27 report must trace to an actual recorded signal, candidate, or outcome.

### 4.2 Correlation, not Causation

P27 may identify statistical relationships between governance events. P27 must never claim one governance event caused another. Drift signals and review outcomes are correlated based on candidate lineage — not proven causal.

### 4.3 Learning, not Recommendation

The system may explain observed patterns. The system must not recommend policy changes. Reports describe what happened and what patterns exist — they do not prescribe actions.

### 4.4 Human Sovereignty

All governance decisions remain external to P27. P27 has zero authority over:
- policies
- thresholds
- reviewers
- candidate lifecycle
- governance execution

---

## 5. Phase Relationship

P27 joins across three governance layers by reading persisted data from P25 candidates and P26 outcomes. P24 signal metadata is embedded in P25 candidates at creation time, so P27 never re-runs P24 detection.

```
P24 — PolicyDriftSignal (computed on demand, signal metadata embedded in P25)

P25 — PolicyReviewCandidate (persisted, carries source signal metadata)
         │
         ├── source.signalKind, source.signalSeverity, source.signalDirection
         │
P26 — PolicyReviewOutcome (persisted, carries candidateId)
         │
         └── candidateId → P25 candidate → P24 source metadata
```

The join is:

```
P26 outcome.candidateId → P25 candidate.candidateId → P24 signal metadata in candidate.source
```

P27 is a read-only consumer of all three layers. It never writes to P24, P25, or P26 stores.

---

## 6. Core Boundary

P27 is explicitly prohibited from:

- autonomous execution, background jobs, or scheduled watchers
- shell, network, MCP, browser, fetch, or subprocess calls
- execution adapters, executor imports, or tool invocations
- policy mutation or readiness threshold mutation
- candidate generation alteration
- candidate lifecycle state mutation
- reviewer or operator ranking
- auto-adoption of learning synthesis outputs
- recommending exact policy changes
- recommending threshold changes
- claiming causation between governance events
- inferring events that were not recorded
- generating predictive scores or likelihood estimates for future governance outcomes
- generating prescriptive governance intelligence

P27 may correlate drift signals, review candidates, and human outcomes. P27 must not mutate policy, change thresholds, alter candidate generation, rank reviewers, recommend exact changes, auto-adopt outcomes, or auto-close candidates.

Add to prohibited list: P27 shall not generate predictive scores or likelihood estimates for future governance outcomes.

---

## 7. Trace Model (P27.1)

### 5.1 Trace Graph

The trace graph is deterministic and uses only recorded relationships:

```text
PolicyDriftSignal
        │
        ▼
  (embedded in candidate.source)
        │
PolicyReviewCandidate
        │
        ▼
  (candidateId in outcome record)
        │
PolicyReviewOutcome
```

No inferred edges. No guessed causality. Only recorded relationships.

### 7.2 Partial Trace Semantics

A trace remains valid if one or more linked governance artifacts are unavailable. Missing fields are represented explicitly (null or empty) rather than inferred. This ensures downstream analytics functions never operate on fabricated data.

Partial trace scenarios:

- **Candidate without outcome**: trace exists with candidate fields populated, outcome fields null/empty. Analytics detect this as a "missing outcome."
- **Signal metadata unavailable**: candidate exists but source signal metadata is incomplete. Trace preserves whatever fields are available; analytics handle gracefully.
- **No candidate for outcome**: not possible by design — every P26 outcome carries a `candidateId` referencing a P25 candidate. If the candidate file is missing, trace includes the outcome with candidate fields null and notes the gap.

### 7.3 Trace Record

```typescript
export interface DriftOutcomeTrace {
  outcomeId: string;
  candidateId: string;
  signalId: string;

  // P24 signal metadata (from candidate.source)
  signalKind: string;
  signalSeverity: string;
  signalDirection: string;
  windowStart: string;
  windowEnd: string;

  // P25 candidate metadata
  candidateTitle: string;
  candidateStatus: string;
  candidateCreatedAt: string;
  candidateClosedAt: string;

  // P26 outcome metadata
  outcomeType: string;
  outcomeRecordedAt: string;
  outcomeRationale: string;

  // Derived
  timeToReviewDays: number;
  timeToOutcomeDays: number;
}
```

---

## 8. Drift Outcome Correlation Analytics (P27.2)

### 8.1 Analytics Functions

All analytics are pure read-only functions consuming `DriftOutcomeTrace[]`:

| Metric | Description |
|--------|-------------|
| Outcome frequency by signal kind | Distribution of outcomes per `signalKind` |
| Outcome frequency by signal severity | Distribution of outcomes per `signalSeverity` |
| Evidence completeness vs outcome | Correlation between evidence refs and outcome type |
| Time-to-review distribution | Time from candidate creation to first recorded transition |
| Time-to-outcome distribution | Time from candidate creation to outcome recording |
| Repeated drift patterns | Two or more recorded signals sharing the same `signalKind` across distinct governance windows (non-overlapping time windows) |
| Confidence distribution by outcome | P24 signal confidence grouped by outcome type |
| Policy area distribution | `implicatedPolicyAreas` from source signal grouped by outcome |
| Trace completeness | Percentage of candidates with linked outcomes |
| Missing outcome detection | Only terminal-state candidates (`dismissed`, `closed`, `accepted_for_policy_review`) lacking a P26 outcome. Non-terminal candidates are not flagged — they may still be under active review |

### 8.2 Prohibited Analytics

Analytics must not:

- rank reviewers or operators
- generate reviewer scorecards
- recommend exact policy changes
- recommend threshold changes
- claim causation
- generate predictive scores or likelihood estimates for future governance outcomes
- classify candidates or outcomes as "best" or "worst"
- prioritize future candidates based on past outcomes

### 8.3 Deterministic Sorting

- All result arrays sorted alphabetically by key field (signalKind, outcomeType, etc.)
- Trace records sorted by `candidateCreatedAt` ascending, then `candidateId` as tie-break
- No person-based ordering

---

## 9. Review Learning Synthesis Report (P27.3)

### 9.1 Report Semantics

Reports describe observed patterns. They do not prescribe actions.

Instead of:
> "Increase threshold to 0.80."

The report says:
> "During the selected window, authentication-policy drift produced 18 review candidates. Twelve were accepted, four deferred, two rejected. Accepted candidates commonly included configuration evidence and supporting documentation."

### 9.2 Report Shape

```typescript
export interface LearningSynthesisReport {
  reportId: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;

  // Summary
  totalSignals: number;
  totalCandidates: number;
  totalOutcomes: number;

  // Correlation analytics
  outcomeBySignalKind: Record<string, Record<string, number>>;
  outcomeBySeverity: Record<string, Record<string, number>>;
  timeStats: {
    avgTimeToReviewDays: number;
    avgTimeToOutcomeDays: number;
  };

  // Trace completeness
  traceCompleteness: number;
  missingOutcomes: number;

  // Repeated patterns
  repeatedPatterns: string[];

  // Distribution
  confidenceByOutcome: Record<string, number>;
  signalKindFrequency: Record<string, number>;

  // Boundary
  footnotes: string[];
  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}
```

### 9.3 Required Footnotes

Every report must include:

```
This report contains descriptive governance intelligence only.
P27 produces correlations, not causation.
No governance policy was changed by generating this report.
No thresholds were adjusted.
No reviewers were ranked.
No candidates were prioritized.
No outcomes were auto-adopted.
Governance decisions remain under explicit human control.
```

---

## 10. CLI Shape (P27.4)

```bash
alix governance learning-synthesis build --p24-bundle <bundle.json> --p25-store <path> --p26-store <path> [--json]

alix governance learning-synthesis report [--json]

alix governance learning-synthesis export <format>
```

| Command | Behavior | Writes |
|---------|----------|--------|
| `build` | Read-only: reads P24 bundle + P25 candidates + P26 outcomes, computes traces and analytics | No |
| `report` | Render learning synthesis report | No |
| `export` | Export trace data as JSON | No (write to stdout) |

### 10.1 No Write Path

P27 has no write path. The CLI reads from three data sources (P24 bundle, P25 store, P26 store), computes analytics in memory, and outputs a report. No files are created, modified, or persisted.

---

## 11. Module Boundaries

### 11.1 Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P27.1 | `src/governance/learning-synthesis-types.ts` | Trace model, report types |
| P27.2 | `src/governance/learning-synthesis-analytics.ts` | Pure analytics functions |
| P27.3 | `src/governance/learning-synthesis-report.ts` | Pure report builder + text/json |
| P27.4 | `src/cli/commands/governance-learning-synthesis.ts` | CLI handler |
| P27.0 | `docs/architecture/specs/<date>-p27-0-*.md` | Design spec |
| P27.5 | `docs/architecture/checkpoints/<date>-p27-5-*.md` | Checkpoint |

### 11.2 Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "learning-synthesis"` dispatch |

### 11.3 Untouched Files

- P24 modules (policy-drift-*.ts)
- P25 modules (policy-review-candidate-*.ts)
- P26 modules (policy-review-outcome-*.ts)
- P13.3 policy-suggestions.ts
- P9.0d governance-drift-detector.ts

### 11.4 Pure Modules

```text
learning-synthesis-types.ts       (types only)
learning-synthesis-analytics.ts   (pure analytics, no I/O)
learning-synthesis-report.ts      (pure report builder)
```

The CLI handler owns all file reads (P24 bundle, P25 store, P26 store). Pure modules never touch the filesystem.

---

## 12. Testing Plan

### P27.1 — Trace Model (4 tests)

1. Trace record shape has all required fields.
2. Trace records sort deterministically by candidateCreatedAt.
3. Trace with missing candidate produces partial trace with available fields.
4. Trace with missing outcome produces partial trace (candidate without outcome).

### P27.2 — Analytics (8 tests)

1. Empty traces produce zero counts.
2. Outcome frequency by signal kind is correct.
3. Outcome frequency by signal severity is correct.
4. Evidence completeness vs outcome computed correctly.
5. Time-to-review computed correctly.
6. Repeated drift patterns detected.
7. No causation claims in output.
8. No reviewer ranking in output.

### P27.3 — Report (4 tests)

1. Empty analytics produce clean report.
2. Report includes all required footnotes.
3. Report JSON output is parseable.
4. Report uses descriptive language (no prescriptive statements).

### P27.4 — CLI (4 tests)

1. Build reads from three sources without error.
2. Report renders text output.
3. Report --json returns parseable JSON.
4. No write operations occur.

**Total: 20 tests.**

---

## 13. Storage Boundary

P27 does not introduce a new store. It reads from:

- P25 store: `.alix/governance/policy-review-candidates/`
- P26 store: `.alix/governance/policy-review-outcomes/`
- P24 bundle: provided via `--p24-bundle` flag at build time (JSON file with PolicyDriftSignal[])

No files are written by P27. No new persistence layer is added. P27 is fully on-demand.

---

## 14. P27 Seal Criteria

P27 may be sealed only when:

- all 20 P27 tests pass
- no execution adapter imports exist
- no shell/network/tool execution exists
- no policy writer imports exist
- no threshold writer imports exist
- no candidate store writes exist
- no outcome store writes exist
- no reviewer ranking exists
- no auto-adoption exists
- no policy recommendations exist
- all output is descriptive (no prescriptive language)
- no causation claims in output
- P24/P25/P26 modules unchanged
- P9.0d/P22/P23 unchanged

Final seal tag:

```text
alix-p27-policy-review-learning-synthesis-drift-outcome-correlation-complete
```

---

## 15. Proposed Slice Plan

```text
P27.0 — Design Spec
P27.1 — Signal→Candidate→Outcome Trace Model (learning-synthesis-types.ts) — 4 tests
P27.2 — Drift Outcome Correlation Analytics (learning-synthesis-analytics.ts) — 8 tests
P27.3 — Review Learning Synthesis Report (learning-synthesis-report.ts) — 4 tests
P27.4 — CLI + Export (governance-learning-synthesis.ts) — 4 tests
P27.5 — Checkpoint
```

---

## 16. Next Steps

```text
P27.0 — Policy Review Learning Synthesis & Drift Outcome Correlation Design Spec
```

This document is P27.0.

Proceed to implementation planning.
