# Evolution Verification Framework (A2)

## Overview

The A2 verification framework for evolution proposals: pure contracts, a non-compensatory confidence calculator, deterministic replay controls, counterfactual evaluation, evidence packaging with an integrity-checked ledger, and an advisory recommendation engine that hands evidence to A3 governance.

This directory holds only two direct source files — the barrel and a shared regression-inference helper. The framework itself lives in child directories whose contracts are linked below.

## Interface

- Barrel re-exports the whole A2 surface (contracts, confidence, replay, evaluation, evidence, recommendation, shared) [index.ts]
- `inferRegressionsFromChanges(changes)` — counts behavioral-change descriptions containing `" regression: "` [shared.ts:inferRegressionsFromChanges]
- `inferRegressions(evidence)` — same count applied to `VerificationEvidence.behavioralChanges` [shared.ts:inferRegressions]
- [Confidence Calculator](./confidence/README.md) — non-compensatory overall confidence and comparable-dimension similarity
- [Verification Contracts](./contracts/README.md) — run/report/evidence types, evidence classes, reproducibility levels, replay dataset, environment snapshot, recommendation vocabulary
- [Verification Evidence](./evidence/README.md) — report builder, integrity-hashed evidence, ledger, and lineage tracker
- [Recommendation Engine](./recommendation/README.md) — evidence-to-advisory-recommendation ladder and append-only store
- `evaluation/` — `CounterfactualEvaluator` and `computeHistoricalSimilarity`: [./evaluation/README.md](./evaluation/README.md) [evaluation/counterfactual-evaluator.ts:CounterfactualEvaluator] [evaluation/historical-similarity.ts:computeHistoricalSimilarity]
- `replay/` — `LogicalClock`, `SeededPRNG`, `DeterministicScheduler`, `mergeEvents`, and `ReplayEngine`: [./replay/README.md](./replay/README.md) [replay/logical-clock.ts:LogicalClock] [replay/seeded-prng.ts:SeededPRNG] [replay/deterministic-event-merge.ts:mergeEvents] [replay/replay-engine.ts:ReplayEngine]

## Invariants

- Regression inference is a string-pattern count on `" regression: "`, matching the format emitted by the counterfactual evaluator; it makes no metric-level judgement [shared.ts:inferRegressionsFromChanges]
- The shared helper exists so A2.5 recommendation and A3 decision do not duplicate regression inference [shared.ts]
- Replay determinism is enforced at the API level: a missing or misconfigured control rejects execution rather than degrading to wall-clock or unseeded randomness [replay/replay-engine.ts:ReplayEngine]
- `ReplayEngine` never calls `Date.now()`, `Math.random()`, or `crypto.randomUUID()`, and every error carries a typed `VerificationFailureKind` [replay/replay-engine.ts:ReplayEngine]
- `LogicalClock` advances only on an explicit tick or `advance(steps)`, rejects non-finite or negative steps, and round-trips `snapshot()`/`restore()` [replay/logical-clock.ts:LogicalClock]
- Counterfactual evaluation is policy-independent: it classifies what changed, never whether the change is acceptable [evaluation/counterfactual-evaluator.ts:CounterfactualEvaluator]
- Every metric in the union of baseline and candidate keys receives an outcome classification [evaluation/counterfactual-evaluator.ts:CounterfactualEvaluator]
- Historical similarity records incomparable dimensions in `coverageGaps` rather than scoring them [evaluation/historical-similarity.ts:computeHistoricalSimilarity]
- Evidence-class precedence is downstream law: `observed > derived > projected > executed` [contracts/verification-contract.ts:EvidenceClass]
- A2-generated reports and evidence are always `evidenceClass: "projected"` [contracts/verification-contract.ts:VerificationEvidence]
- The recommendation engine is advisory only — it never transitions evolution state, invokes deployment, or bypasses A3 validation [recommendation/recommendation-engine.ts:RecommendationEngine]

## Side Effects

- `inferRegressionsFromChanges` and `inferRegressions` are pure: no I/O, no store access, no mutation [shared.ts:inferRegressions]
- The barrel is a re-export surface and performs no work on import beyond module evaluation [index.ts]
- Side effects of the child subsystems are documented in their own contracts: evidence ids from `randomUUID()`, a process-local evidence ledger, and JSONL appends to `.alix/verification/recommendations.jsonl` [evidence/README.md] [recommendation/README.md]
- Replay execution performs no disk or network I/O; the caller supplies the `ReplayExecutor` [replay/replay-engine.ts:ReplayExecutor]

## Verification

- Run: `pnpm test`
