# ADR-0008: A-Series Governed Evolution Pipeline

**Status:** Accepted (2026-07-13)
**Deciders:** Architecture team
**Scope:** A0–A5 evolution architecture

---

## 1. Context

Evolution capabilities were developed incrementally across phases A0 through A5. Each phase was designed independently, but the emergent architecture forms a unified governed evolution pipeline with specific properties that should be preserved by future development.

The goal was to create a deterministic, evidence-driven evolution loop where:

- Every mutation is governed by an explicit decision
- Every decision is supported by verifiable evidence
- Every execution produces auditable evidence
- Every outcome feeds back into the governance model

Six phases emerged, each owning a single responsibility:

| Phase | Name | Responsibility |
|-------|------|---------------|
| A0 | Evolution Contract | Define vocabulary, lifecycle states, and lineage rules |
| A1 | Pattern Discovery | Observe existing system behavior |
| A2 | Verification | Project the effects of a proposed change |
| A3 | Governance Decision | Accept or reject change proposals based on evidence |
| A4 | Governed Execution | Apply approved changes under deterministic control |
| A5 | Outcome Observation | Measure the actual effects post-execution |

---

## 2. Decision

ALiX adopts a six-phase governed evolution pipeline:

```
Observe → Discover → Verify → Govern → Execute → Observe Outcome
```

Each phase produces or consumes a well-defined artifact. Governance operates exclusively on `VerificationEvidence`, independent of evidence origin. The pipeline is linear and deterministic — no phase bypasses a prior phase.

### 2.1 Pipeline Flow

```
Observed Reality
        │
        ▼
A1 Pattern Discovery ──────► Observational Evidence
        │
        ▼
A2 Verification ────────────► Projected Evidence (VerificationEvidence)
        │
        ▼
A3 Governance Decision ─────► GovernanceDecision
        │                              │
        ▼                              ▼
A4 Governed Execution ───────► Executed Evidence (EvolutionExecutionEvidence)
        │
        ▼
A5 Outcome Observation ──────► Observed Evidence (VerificationEvidence)
        │
        ▼
                    Governance Feedback
```

### 2.2 Evidence Convergence

Three evidence producers intentionally converge into a single evidence model:

```
A2 Projected Evidence
        │
        ├──────────────┐
A4 Executed Evidence   │
        │              │
        ▼              ▼
  VerificationEvidence
        ▲
        │
A5 Observed Evidence
```

`VerificationEvidence` is the universal governance artifact. A3 consumes it without knowing whether it came from projection, execution, or observation. This prevents evidence-type proliferation and keeps governance logic independent of evidence provenance.

---

## 3. Architectural Invariants

### 3.1 Phase Boundaries

1. **Each phase owns exactly one invariant.** No phase spans multiple concerns.
2. **Phases communicate only through typed contracts.** No phase calls another phase's internals.
3. **Contracts are shared schemas, not shared implementations.** Two phases may reference the same type without sharing code.
4. **A phase's output is another phase's input.** The pipeline is a chain of artifact transformations.

### 3.2 Evidence

5. **Evidence is immutable once emitted.** No phase modifies evidence produced by another phase.
6. **Evidence has an explicit lifecycle.** Every evidence artifact carries `verifiedAt`, `expiresAt`, and `reverificationRequired`.
7. **Evidence carries its own provenance.** Every evidence artifact has a `lineage` linking it to prior phases.

### 3.3 Governance

8. **Governance depends on evidence, not implementation.** A3 evaluates evidence quality regardless of evidence origin (projected, executed, observed).
9. **Execution never bypasses governance.** A4 requires a GovernanceDecision with kind `APPROVE`.
10. **Observation never mutates execution history.** A5 reads system state; it does not modify evidence from prior phases.

### 3.4 Execution

11. **Execution is deterministic and sequential.** Same inputs + same plan = same execution trace.
12. **Every mutation has a rollback strategy.** Rollback steps cover every forward step.
13. **Execution produces verifiable evidence.** `EvolutionExecutionEvidence` is integrity-hashed with SHA-256.

### 3.5 Observation

14. **Providers never mutate the system.** Observation is read-only by construction.
15. **Providers never throw.** Every execution path returns a structured `ObservationResult`.
16. **Observation is separate from interpretation.** The bridge projects measurement outcomes faithfully without inferring governance conclusions.

---

## 4. Evidence Model

### 4.1 Evidence Class Hierarchy

Three evidence classes form a precedence hierarchy:

```
observed
    >
projected
    >
executed
```

| Class | Producer | What it represents | Precedence |
|-------|----------|-------------------|------------|
| `observed` | A5 | Measurement of actual system state | Highest |
| `projected` | A2 | Counterfactual estimate of future state | Medium |
| `executed` | A4 | Record of what was changed | Lowest |

**Rationale:** Observed evidence outranks projected because it measures reality rather than estimating it. Projected evidence outranks executed because it captures outcome quality, not just execution completeness. Executed evidence records that a change was applied but cannot, on its own, confirm the change had the intended effect.

### 4.2 Evidence Artifacts

```
VerificationEvidence (A2 + A5)
├── evidenceClass: "projected" | "observed"
├── baselineMetrics / candidateMetrics / metricDeltas
├── behavioralChanges
├── confidenceProfile (replayFidelity, coverage, determinism, historicalSimilarity)
├── lineage
└── integrityHash (SHA-256 + canonicalStringify + domain prefix)

EvolutionExecutionEvidence (A4)
├── evidenceClass: "executed"
├── executionPlan / executionReport / environment
├── decisionId / proposalId
├── lineage
└── integrityHash (SHA-256 + canonicalStringify + domain prefix + transient exclusions)
```

### 4.3 Integrity Hashing

All evidence artifacts follow the same integrity contract:

```
SHA-256(domain_prefix + canonicalStringify(evidence_without_integrityHash))
```

Each evidence type uses a distinct domain prefix to prevent cross-type hash collisions:

| Evidence | Prefix |
|----------|--------|
| A2 Projected | `alix-evolution-v2:` |
| A4 Executed | `alix-evolution-execution-v1:` |
| A5 Observed | `alix-evolution-observed-v1:` |

---

## 5. Consequences

### 5.1 Positive

- **Adaptive confidence calibration:** A2's projected confidence can be compared against A5's observed outcomes across runs, enabling accuracy measurement without new infrastructure.
- **Provider calibration:** Historical observation results can be mined for per-provider reliability scores, confidence calibration, and timeout optimization.
- **Governance analytics:** `decisionId` lineage across all three evidence producers enables queries like "how often did APPROVE decisions produce observed successes?"
- **Policy optimization:** The governance policy defaults can be tuned by correlating policy parameters with observed outcomes at scale.
- **Cross-run learning:** Evidence from all phases shares the same `proposalId`, making it possible to surface patterns — which proposal characteristics correlate with failed observations, which provider works best for which class of proposal.
- **Recommendation improvement:** A2.5 governance recommendations and observed outcomes share an evidence chain, enabling recommendation accuracy tracking.
- **Future ML integration:** ML components consume evidence rather than integrating with individual phases, maintaining phase isolation.

### 5.2 Negative

- **Strict phase ordering:** Adding a new phase between two existing phases requires updating contract types and downstream consumers.
- **Evidence bridge overhead:** Each evidence-producing phase requires a bridge that maps its internal artifact to `VerificationEvidence` or a compatible output type.
- **No cross-phase optimization:** Because phases are strictly isolated, cross-cutting optimizations (e.g., skipping verification for low-risk proposals) require explicit governance policy changes rather than implicit pipeline shortcuts.

---

## 6. Non-Goals

The A-series governed evolution pipeline is **not**:

- **An autonomous self-modifying system.** Every mutation requires a governance decision. The pipeline automates evidence production and decision support, not the decision itself.
- **A reinforcement learning loop.** Learning from observed outcomes is a separate capability that consumes evidence produced by the pipeline rather than controlling it.
- **A workflow engine.** The pipeline executes phases in a fixed order. It does not support branching, conditional phase execution, or dynamic phase insertion.
- **Provider-specific.** Observation (A5) and verification (A2) use provider abstractions, but the pipeline does not depend on any specific provider implementation.
- **Storage-backend-dependent.** Evidence stores are swappable implementations behind `ExecutionEvidenceStore` and `VerificationEvidenceLedger` interfaces.

---

## 7. Architectural Principle

> The A-series establishes that governance decisions are made from evidence rather than implementation details. New evolution capabilities should extend the evidence model instead of introducing new control paths. This preserves deterministic behavior while allowing the system to become progressively more informed through accumulated observations.

---

## 8. References

- A0: `src/evolution/contracts/evolution-contract.ts`
- A2: `src/evolution/verification/`
- A3: `src/evolution/governance/`
- A4: `src/evolution/execution/`
- A5: `src/evolution/observation/`
- Specs: `docs/architecture/specs/2026-07-12-a5-outcome-observation-design.md`
- Plans: `docs/superpowers/plans/2026-07-12-a5-outcome-observation-plan.md`
- Evidence contract: `src/evolution/verification/contracts/verification-contract.ts`
- Confidence contract: `src/evolution/verification/contracts/confidence-contract.ts`
- Evolution CLI: `src/governance/evolution-cli.ts`
