# P23.0 — Governance Replay & Counterfactual Readiness Review Design Spec

**Date:** 2026-07-09
**Status:** Design — approved for implementation
**Phase:** P23 — Governance Replay & Counterfactual Readiness Review
**Depends on:** P17 (Approved Execution Lifecycle), P18 (Governance Workbench), P19 (Readiness Projection), P20 (Manual Execution Handoff), P21 (Closure Review), P22 (Closure Intelligence)
**Checkpoint target:** `alix-p23-governance-replay-counterfactual-readiness-review-complete`

---

## 1. Purpose

P23 introduces a read-only replay layer for ALiX governance history.

The goal is to replay historical governance decisions, readiness projections, handoffs, closure evidence, and closure intelligence inside a sandboxed counterfactual evaluator.

P23 answers questions like:

```text
What would the governance outcome have looked like if:
- readiness labels had been stricter?
- required evidence checks had been different?
- handoff quality expectations had changed?
- closure risk thresholds had been interpreted differently?
- an approval had remained valid but downstream readiness differed?
```

P23 must never change what actually happened.

It does not mutate policy, approvals, readiness thresholds, handoffs, closure reviews, execution state, audit history, or live governance records.

P23 produces replay reports only.

---

## 2. Position in the Governance Ladder

P23 builds on the sealed governed action-readiness ladder:

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
```

P23 does not bypass or replace any prior phase.

It consumes historical governance records and produces read-only replay intelligence.

---

## 3. Core Boundary

P23 is explicitly prohibited from:

```text
- autonomous execution
- shell execution
- network execution
- tool execution
- execution adapter integration
- policy mutation
- readiness threshold mutation
- approval mutation
- handoff mutation
- closure review mutation
- audit event mutation
- operator ranking
- productivity scoring
- fairness scoring
- auto-adoption
- auto-close
- hidden side effects
- persisting counterfactuals as live governance state
- bypassing P17 approval
- bypassing P18 visibility
- bypassing P19 readiness projection
- bypassing P20 handoff evidence
- bypassing P21 closure review
- bypassing P22 intelligence boundaries
```

Counterfactual outputs are analytical artifacts only.

They are not governance truth.

---

## 4. Non-Goals

P23 does not:

```text
- execute actions
- approve actions
- reject actions
- change readiness rules
- change readiness thresholds
- change policy
- rewrite historical records
- reclassify operators
- rank operators
- score operator productivity
- create remediation automatically
- create handoffs automatically
- close reviews automatically
- update live proposals
- update live action queues
- mutate audit stores
```

P23 may suggest candidate lessons, but those lessons remain advisory and read-only.

Any future adoption must go through a separate governed workflow.

---

## 5. Conceptual Model

P23 compares two worlds:

```text
Original world:
  What actually happened in the governed lifecycle.

Counterfactual world:
  What the replay evaluator says might have happened under a declared hypothetical rule set.
```

P23 never overwrites the original world.

It only computes a diff.

---

## 6. Replay Input Sources

The replay assembler may read from historical records produced by:

```text
P17 — approvals and approval lifecycle records
P18 — workbench lifecycle visibility records
P19 — readiness projections
P20 — manual handoff packages and evidence records
P21 — human execution evidence and closure review records
P22 — closure intelligence and handoff quality signals
```

All reads must be read-only.

The replay assembler must treat source records as immutable inputs.

---

## 7. Replay Dataset

A replay dataset represents one historical lifecycle thread.

Recommended TypeScript shape:

```ts
export interface GovernanceReplayDataset {
  replayId: string;
  sourceLifecycleId: string;

  assembledAt: string;

  approvals: ReplayApprovalRecord[];
  readinessProjections: ReplayReadinessProjectionRecord[];
  handoffs: ReplayHandoffRecord[];
  closureReviews: ReplayClosureReviewRecord[];
  closureIntelligence: ReplayClosureIntelligenceRecord[];

  sourceSummary: ReplaySourceSummary;
}
```

The dataset must contain copies or normalized read models only.

It must not expose writable store handles.

---

## 8. Counterfactual Scenario

A counterfactual scenario declares the hypothetical assumptions being tested.

Recommended shape:

```ts
export interface CounterfactualScenario {
  scenarioId: string;
  name: string;
  description: string;

  readinessAssumptions?: CounterfactualReadinessAssumptions;
  evidenceAssumptions?: CounterfactualEvidenceAssumptions;
  handoffAssumptions?: CounterfactualHandoffAssumptions;
  closureAssumptions?: CounterfactualClosureAssumptions;

  createdForReplayOnly: true;
}
```

Every scenario must be explicit.

No hidden defaults may change live governance semantics.

---

## 9. Counterfactual Readiness Assumptions

P23 may support assumptions such as:

```text
- require stronger evidence completeness
- require stricter handoff readiness
- downgrade readiness when closure risk is high
- flag readiness uncertainty when evidence is missing
- treat missing closure evidence as unresolved
- require human review before readiness can be considered stable
```

These assumptions apply only inside the replay evaluator.

They must not change P19 readiness thresholds.

---

## 10. Replay Evaluation Output

The evaluator produces a counterfactual outcome.

Recommended shape:

```ts
export interface CounterfactualReplayOutcome {
  replayId: string;
  scenarioId: string;

  originalOutcome: ReplayOriginalOutcome;
  counterfactualOutcome: ReplayCounterfactualOutcome;

  diff: ReplayDiff;
  riskDelta: ReplayRiskDelta;

  candidateLessons: ReplayCandidateLesson[];

  generatedAt: string;
  readOnly: true;
}
```

The output is a report artifact, not live governance state.

---

## 11. Replay Diff Model

The diff model should compare original and counterfactual outcomes.

Suggested diff categories:

```text
unchanged:
  Counterfactual assumptions did not materially change the replay result.

readiness_changed:
  Readiness label or readiness explanation changed.

handoff_quality_changed:
  Handoff quality assessment changed.

closure_risk_changed:
  Closure risk level changed.

evidence_gap_changed:
  Evidence completeness or missing-evidence interpretation changed.

review_path_changed:
  The replay suggests a different review path would have been recommended.

blocked_in_counterfactual:
  The counterfactual assumptions would have prevented progression.

advanced_in_counterfactual:
  The counterfactual assumptions would have allowed progression earlier or with fewer concerns.
```

No diff category may trigger automatic changes.

---

## 12. Candidate Lessons

Candidate lessons are advisory observations.

Example:

```ts
export interface ReplayCandidateLesson {
  lessonId: string;
  summary: string;
  basis: string[];
  confidence: "low" | "medium" | "high";
  appliesTo: "readiness" | "handoff" | "closure" | "evidence" | "review";
  requiresHumanReview: true;
}
```

Candidate lessons must not mutate policy.

They must not update readiness rules.

They must not auto-create remediation.

They must not be auto-adopted.

---

## 13. Module Boundary

P23 should use a pure/read-only architecture.

Suggested modules:

```text
src/governance/replay/types.ts
src/governance/replay/replay-input-assembler.ts
src/governance/replay/counterfactual-readiness-evaluator.ts
src/governance/replay/replay-diff-model.ts
src/governance/replay/replay-report.ts
src/cli/commands/governance-replay.ts
```

Pure modules:

```text
counterfactual-readiness-evaluator.ts
replay-diff-model.ts
replay-report.ts
```

Store-reading boundary:

```text
replay-input-assembler.ts
CLI command handler
```

Forbidden imports in pure modules:

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

## 14. CLI Shape

Suggested command group:

```bash
alix governance replay assemble <lifecycleId>
alix governance replay evaluate <lifecycleId> --scenario <scenarioId>
alix governance replay report <lifecycleId> --scenario <scenarioId>
alix governance replay report <lifecycleId> --scenario <scenarioId> --json
```

Optional scenario flags:

```bash
--strict-evidence
--strict-handoff
--closure-risk-sensitive
--require-complete-review
```

The CLI must be read-only.

It may print reports.

It may not write live governance records.

If report export is added later, it must write only to an explicit report/output path and must not update governance stores.

---

## 15. Report Requirements

The replay report should show:

```text
- replay id
- source lifecycle id
- scenario name
- source records used
- original outcome summary
- counterfactual outcome summary
- diff category
- risk delta
- changed readiness signals
- changed handoff quality signals
- changed closure risk signals
- candidate lessons
- boundary verification footer
```

Required footer:

```text
P23 replay report is read-only.
No policy, approval, readiness, handoff, closure, audit, or execution state was mutated.
Counterfactual outputs are advisory and require governed human review before any future adoption.
```

---

## 16. Determinism

P23 should be deterministic.

For the same replay dataset and same scenario, the evaluator must produce the same output.

Sorting rules:

```text
- records sorted by timestamp ascending
- ties sorted by stable id ascending
- candidate lessons sorted by appliesTo, then lessonId
- diff details sorted by category, then source id
```

No randomness.

No model calls.

No external calls.

---

## 17. Safety Invariants

Every P23 implementation slice must preserve:

```text
readOnly: true
createdForReplayOnly: true
requiresHumanReview: true
```

Every counterfactual output must clearly state:

```text
- original records remain authoritative
- counterfactual output is not live governance state
- no policy was changed
- no readiness threshold was changed
- no approval was changed
- no handoff was changed
- no closure review was changed
- no execution occurred
```

---

## 18. Testing Requirements

P23.0 should create the design spec and checkpoint plan.

Later implementation slices should test:

```text
Replay Input Assembler:
- assembles records from allowed sources only
- handles missing optional records
- preserves immutable source ids
- does not mutate source objects
- sorts deterministically

Counterfactual Readiness Evaluator:
- produces deterministic outcomes
- applies scenario assumptions only inside replay
- does not mutate readiness thresholds
- does not mutate source readiness records
- handles missing evidence safely

Replay Diff Model:
- detects unchanged outcomes
- detects readiness changes
- detects handoff quality changes
- detects closure risk changes
- detects evidence gap changes
- sorts diffs deterministically

Replay Report + CLI:
- prints original vs counterfactual outcomes
- supports JSON output
- includes read-only boundary footer
- performs no writes to live governance stores
- imports no execution adapters
- imports no audit emitters
```

---

## 19. Acceptance Criteria for P23.0

P23.0 is complete when:

```text
- design spec exists
- replay purpose is defined
- replay boundaries are explicit
- counterfactual scope is defined
- input sources are listed
- no-mutation guarantees are documented
- proposed module boundaries are documented
- CLI shape is documented
- test strategy is documented
- checkpoint criteria are documented
```

P23.0 must not implement replay execution yet.

---

## 20. Proposed Slice Plan

```text
P23.0 — Design Spec
  Define replay scope, boundaries, counterfactual assumptions, no-mutation guarantees, module plan, CLI plan, and tests.

P23.1 — Replay Input Assembler
  Build read-only replay datasets from P17–P22 source records.

P23.2 — Counterfactual Readiness Evaluator
  Evaluate declared hypothetical readiness/evidence/handoff/closure assumptions in memory only.

P23.3 — Replay Diff Model
  Compare original lifecycle outcomes against counterfactual outcomes.

P23.4 — Replay Report + CLI
  Print replay reports and JSON output with boundary verification.

P23.5 — Checkpoint
  Verify no execution, no mutation, no auto-adoption, no ranking, and seal P23.
```

---

## 21. P23 Seal Criteria

P23 may be sealed only when:

```text
- all P23 tests pass
- no execution adapter imports exist
- no shell/network/tool execution exists
- no policy writer imports exist
- no readiness threshold writer imports exist
- no approval writer imports exist
- no handoff writer imports exist
- no closure writer imports exist
- no audit emitter imports exist from replay pure modules
- counterfactuals are not persisted as live governance state
- reports clearly mark outputs as read-only
- operator ranking is absent
- productivity scoring is absent
- auto-adoption is absent
- auto-close is absent
```

Final seal tag:

```text
alix-p23-governance-replay-counterfactual-readiness-review-complete
```

---

## 22. Next Steps

```text
P23.0 — Governance Replay & Counterfactual Readiness Review Design Spec
```

This document is P23.0.

Proceed to P23.1 — Replay Input Assembler implementation.
