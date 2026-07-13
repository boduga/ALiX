# ADR-0011: Evolution Verification Model

**Status:** Accepted (2026-07-13)
**Deciders:** Architecture team
**Scope:** A2 verification framework — counterfactual evaluation, evidence construction, confidence model, reproducibility, recommendations

---

## 1. Context

Before ALiX applies a change, it needs to answer: **what will happen if we apply this change?** The A2 verification framework answers this question through counterfactual evaluation — replaying the change against historical data to project its effects.

The verification model must address:

- **Evidence construction:** How is projection evidence assembled from evaluation results?
- **Confidence calibration:** How trustworthy is a projection? The model must express epistemic confidence — how well the replay represents reality — not the probability of success.
- **Reproducibility:** Can the evaluation be repeated with the same results?
- **Recommendation:** Should the governance layer be advised to approve, reject, or monitor?
- **Evidence freshness:** Projections decay over time. When does evidence expire?

The verification framework is the bridge between raw observation (A1) and governance (A3). It must produce evidence that A3 can evaluate without knowing how the evidence was produced.

---

## 2. Decision

ALiX adopts a **counterfactual verification model** with replay-based evaluation, dimensional confidence computation, reproducibility levels, and advisory recommendations.

### 2.1 Architecture

```
Evolution Proposal
        │
        ▼
CounterfactualEvaluator
        │
        ├── Replay historical dataset
        ├── Apply proposal as if-clause
        ├── Compare baseline vs candidate
        │
        ▼
VerificationReport
        │
        ├── MetricResults (baseline vs candidate deltas)
        ├── ExecutionLogs
        └── Diagnostics
        │
        ▼
EvidenceBuilder
        │
        ├── MetricResults → MetricDeltas
        ├── Behavioral change detection
        └── ConfidenceProfile computation
        │
        ▼
VerificationEvidence (evidenceClass: "projected")
        │
        ├── evidenceId, proposalId, replayDatasetId
        ├── baselineMetrics / candidateMetrics / metricDeltas
        ├── behavioralChanges
        ├── confidenceProfile
        ├── reproducibilityLevel
        ├── lineage
        ├── verifiedAt / expiresAt / reverificationRequired
        └── integrityHash
```

### 2.2 Counterfactual Evaluation

The `CounterfactualEvaluator` runs a replay-based simulation:

1. Load the historical replay dataset identified by `replayDatasetId`
2. Reconstruct the execution context that produced the historical data
3. Apply the proposal's changes as an if-clause
4. Execute the replay under the projected conditions
5. Compare baseline (historical) vs candidate (projected) metrics
6. Detect behavioral changes from the metric deltas

**Key invariant:** The evaluator never mutates real system state. It runs in an isolated replay context.

### 2.3 Evidence Class

Verification evidence carries `evidenceClass: "projected"`. This is the second tier in the evidence hierarchy:

```
observed  >  projected  >  executed
```

**Rationale:** Projected evidence is a counterfactual estimate — informed by replay data and historical similarity, but not a direct measurement of reality. Observed evidence (A5) outranks it because observation measures what actually happened. Executed evidence (A4) ranks below because execution records action, not outcome.

### 2.4 Confidence Model

Confidence is epistemic — it represents **how trustworthy the projection is**, not the probability that the proposal succeeds.

The confidence profile uses four dimensional inputs:

```typescript
interface ConfidenceProfile {
  replayFidelity: number;        // How faithfully replay reproduced execution context (0–1)
  coverage: number;              // Proportion of relevant scenarios exercised (0–1)
  determinism: number;           // How verifiably deterministic the run was (0–1)
  historicalSimilarity: number;  // Similarity between replay conditions and current production (0–1)
  overallConfidence: number;     // Computed: min(replayFidelity, coverage, determinism) × historicalSimilarity
}
```

The formula is non-compensatory: a low score on any dimension cannot be compensated by high scores on others. This prevents a highly deterministic but poorly covered run from reporting high confidence.

### 2.5 Reproducibility Levels

Verification runs are classified by reproducibility:

| Level | Name | Meaning |
|-------|------|---------|
| 0 | Metric | Same aggregate measurements |
| 1 | Report | Equivalent verification reports |
| 2 | Artifact | Byte-identical verification artifacts |
| 3 | Cryptographic | Identical hashes across all outputs |

A2 targets Level 2 (artifact-level) for all governance-facing verification runs. Level 3 is the ideal but may not be achievable across all replay environments.

### 2.6 Recommendation Engine (A2.5)

The `RecommendationEngine` produces advisory recommendations from verification evidence:

```typescript
type GovernanceRecommendationKind = "APPROVE" | "MONITOR" | "REQUEST_ADDITIONAL_EVIDENCE" | "REJECT" | "ESCALATE";
```

The recommendation is advisory only — it does not transition evolution state. Governance (A3) owns the binding decision. Recommendation kinds map to A3 decision kinds, with `ESCALATE` having no A3 equivalent (it signals human review is needed).

### 2.7 Evidence Lifecycle

Verification evidence expires after a configurable TTL (default: 90 days). A3's decision engine checks evidence freshness:

- **Fail-closed:** Expired evidence → REJECT (with configurable override)
- **Fail-soft:** Expired evidence → MONITOR (evidence quality degraded)

The `reverificationRequired` flag forces re-verification before the evidence can be used for a new governance decision.

---

## 3. Architectural Invariants

1. **Evidence is `"projected"`.** A2 produces only projected-class evidence. It never observes real outcomes.
2. **Confidence is epistemic.** Confidence represents replay trustworthiness, not proposal success probability.
3. **The evaluator is read-only.** It never mutates system state.
4. **Recommendations are advisory.** A2.5 generates recommendations; A3 makes decisions.
5. **Evidence is immutable once emitted.** No component modifies verification evidence after construction.
6. **Reproducibility is measured.** Every verification run has an explicit reproducibility level.
7. **Evidence expires.** Projections have a shelf life; governance must not act on stale evidence.

---

## 4. Consequences

### 4.1 Positive

- **Principled confidence:** The non-compensatory formula prevents inflated confidence from a single high dimension masking others.
- **Clear provenance:** Every evidence artifact links back to its replay dataset and proposal through `evidenceId`, `proposalId`, and `replayDatasetId`.
- **Governance-agnostic evidence:** A3 evaluates evidence without knowing whether it's projected (A2), executed (A4), or observed (A5).
- **Freshness guarantees:** Evidence expiry forces re-verification for long-running proposals, preventing governance from acting on stale projections.

### 4.2 Negative

- **Replay dependency:** Evidence quality depends on replay dataset quality. Poor replay data produces low-confidence projections regardless of the evaluator's correctness.
- **No in situ verification:** The verification runs against historical replay data, not the live system. It cannot detect issues that only manifest in production.
- **Expiry is a heuristic:** The 90-day default is a reasonable heuristic but may be too conservative for slow-evolving systems or too permissive for fast-changing ones.

---

## 5. Key References

- `src/evolution/verification/contracts/verification-contract.ts` — VerificationEvidence, VerificationReport, VerificationRun types
- `src/evolution/verification/contracts/confidence-contract.ts` — ConfidenceProfile and validation
- `src/evolution/verification/shared.ts` — Regression inference utilities
- `src/evolution/verification/evidence/` — Evidence construction and integrity hashing
- `src/evolution/verification/evaluation/` — Counterfactual evaluator
- `src/evolution/verification/replay/` — Replay dataset management
- `src/evolution/verification/recommendation/` — A2.5 recommendation engine
- `src/evolution/verification/index.ts` — Verification module barrel
- `src/evolution/governance/decision-engine.ts` — A3 decision engine (consumer of verification evidence)
- `docs/architecture/adrs/ADR-0006-a-series-governed-evolution-pipeline.md` — A-series pipeline context
