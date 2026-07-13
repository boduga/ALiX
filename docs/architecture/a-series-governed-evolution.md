# A-Series: Governed Evolution Architecture

> **Status:** Active (A0–A5 complete)
> **Last updated:** 2026-07-13
> **Scope:** The governed evolution pipeline — ALiX's primary architectural subsystem for evidence-driven, deterministically governed system change.

---

## 1. Purpose

ALiX evolves itself through governed mutations: proposals to change its own configuration, policies, agent behavior, workflows, or governance rules. The A-series defines the **safe path from observation to mutation to verification** — a deterministic pipeline where every change is supported by evidence, authorized by governance, executed under control, and measured for outcome.

Without this pipeline, evolution would be ad-hoc: proposals without evidence, changes without authorization, mutations without audit, outcomes without feedback. The A-series makes evolution **governed, auditable, and evidence-driven** rather than opportunistic.

The core problem it solves:

> How does a system that changes itself do so without becoming untrustworthy?

---

## 2. Architectural Principles

### 2.1 Evidence-Driven Governance

Governance decisions are made from **evidence**, not implementation details. A3 consumes `VerificationEvidence` without knowing whether it came from projection (A2), execution (A4), or observation (A5). This keeps governance logic independent of evidence provenance.

### 2.2 Deterministic Decision Making

Every phase in the pipeline is deterministic given the same inputs:
- Same proposal + same evidence → same governance decision
- Same decision + same plan → same execution trace
- Same observations + same timestamp → same evidence hash

### 2.3 Separation of Concerns

Each phase owns exactly one responsibility and communicates only through typed contracts. No phase calls another phase's internals. This prevents accidental coupling between observation, prediction, execution, and governance.

### 2.4 Immutable Evidence Lineage

Evidence, once emitted, is never modified. Each evidence artifact carries its own provenance chain (`lineage`), linking it back through all prior phases. This enables audit queries across the full pipeline without centralized state.

### 2.5 Phase Isolation

A phase may fail without cascading to other phases. A verification failure does not corrupt governance. A rollback during execution does not invalidate prior evidence. An inconclusive observation does not erase the execution record.

---

## 3. Pipeline Overview

```
Observed Reality
        │
        ▼
A1 Pattern Discovery ──────► Observational Patterns
        │
        ▼
A2 Evolution Verification ──► Projected Evidence (VerificationEvidence)
        │
        ▼
A3 Governance Decision  ────► GovernanceDecision
        │                              │
        ▼                              ▼
A4 Governed Execution  ─────► Executed Evidence (EvolutionExecutionEvidence)
        │
        ▼
A5 Outcome Observation ────► Observed Evidence (VerificationEvidence)
        │
        ▼
            Governance Feedback
```

Each phase is gated by the previous phase's output artifact:

| Transition | Gate |
|------------|------|
| A1 → A2 | A proposal must reference evidence for its expected effect |
| A2 → A3 | Verification must produce a complete `VerificationEvidence` |
| A3 → A4 | Governance must produce an `APPROVE` decision |
| A4 → A5 | Execution must produce an `ExecutionReport` |
| A5 → feedback | Observation must produce `VerificationEvidence` |

---

## 4. Phase Responsibilities

### A0 — Evolution Contract

The foundation. Defines the vocabulary, lifecycle states, validation boundaries, and lineage rules shared by all downstream phases.

**Key artifacts:**
- `EvolutionState` — complete lifecycle (DRAFT → PROPOSED → UNDER_REVIEW → APPROVED → IMPLEMENTING → VALIDATING → ACTIVE, with rejection and rollback paths)
- `EvolutionIntent` / `EvolutionProposal` — the "what" and "why" of a change
- `ValidationResult` — shared across all phase validators
- `EvolutionArtifactSet` / `validateEvolutionLineage` — cross-phase lineage invariant

### A1 — Pattern Discovery

Observational phase. Discovers patterns in system behavior, evidence history, and governance outcomes. Produces the signals that trigger evolution intents.

**Key capability:** `PatternDiscoveryEngine` — identifies recurring patterns and generates evidence-based evolution triggers.

### A2 — Evolution Verification

Predictive phase. Runs a **counterfactual evaluation** of a proposed change — what would happen if this change were applied? Produces `VerificationEvidence` with `evidenceClass: "projected"`.

**Key capabilities:**
- `CounterfactualEvaluator` — replay-based simulation of proposed changes
- `VerificationEvidence` — metrics, deltas, confidence profile, behavioral changes
- `RecommendationEngine` — A2.5 advisory recommendations for governance

### A3 — Governance Decision

Decisional phase. Evaluates verification evidence (and optionally A2.5 recommendations) against governance policy to produce a binding `GovernanceDecision`.

**Key capabilities:**
- `generateDecision()` — 9-step decision flow (freshness, confidence thresholds, regression limits, reproducibility, escalation)
- `GovernanceDecisionBridge` — persists decision and transitions evolution lifecycle
- `InMemoryGovernanceDecisionStore` — append-only decision storage

### A4 — Governed Execution

Mutational phase. Applies an approved change under deterministic control with full rollback capability and integrity-hashed evidence.

**Key capabilities:**
- `authorizeExecution()` — 7-check gate (exists, APPROVE, integrity hash, proposal match, expiry, revocation, duplicates)
- `createExecutionPlan()` — deterministic plan generation with SHA-256 integrity
- `GovernedExecutionRuntime` — sequential step execution, checkpointing, precondition/postcondition validation
- `buildExecutionEvidence()` — report-to-evidence bridge with transient field exclusion

### A5 — Outcome Observation

Measurement phase. Observes system state after execution to determine whether the intended effect materialized. Produces `VerificationEvidence` with `evidenceClass: "observed"`.

**Key capabilities:**
- `ObservationEngine` — provider registration, deterministic dispatch, bounded concurrency
- `CliObservationProvider` / `FilesystemObservationProvider` / `GitObservationProvider` / `LedgerObservationProvider` — observation primitives
- `buildObservationEvidence()` — aggregates observation results into evidence with faithful behavioral change projections

---

## 5. Evidence Architecture

### 5.1 Evidence Producers and Consumers

```
Producer          Artifact                    Class         Consumer
─────────────────────────────────────────────────────────────────────
A2 Verification   VerificationEvidence        "projected"   A3 Governance
A4 Execution      EvolutionExecutionEvidence  "executed"    Evidence Store
A5 Observation    VerificationEvidence        "observed"    A3 Governance, Learning
```

A2 and A5 both produce `VerificationEvidence` — the universal governance artifact. A3 consumes it without knowing the origin. This convergence is intentional: it prevents evidence-type proliferation and keeps governance independent of provenance.

### 5.2 Evidence Class Hierarchy

Three evidence classes form a strict precedence hierarchy:

```
observed
    >
projected
    >
executed
```

| Class | What it represents | Why it ranks where it does |
|-------|-------------------|---------------------------|
| `observed` | Measurement of actual system state after execution | Highest — measures reality directly |
| `projected` | Counterfactual estimate of what would happen | Medium — informed prediction |
| `executed` | Record of what was changed | Lowest — records action, not outcome |

**Rule:** Projected evidence MUST NOT override observed evidence for the same metric. Executed evidence MUST NOT override projected or observed evidence.

### 5.3 Evidence Integrity Contract

All evidence artifacts follow the same integrity hashing pattern:

```
SHA-256(domain_prefix + canonicalStringify(evidence_without_integrityHash))
```

Each evidence type uses a distinct domain prefix:

| Evidence | Prefix | Producer |
|----------|--------|----------|
| Projected | `alix-evolution-v2:` | A2 |
| Executed | `alix-evolution-execution-v1:` | A4 |
| Observed | `alix-evolution-observed-v1:` | A5 |

The hash covers all fields except `integrityHash` (self-referencing). A4 additionally excludes transient runtime metadata (`runtimeMetadata`, `lastHeartbeat`).

### 5.4 Evidence Lifecycle

Every evidence artifact carries:
- `verifiedAt` — when it was produced
- `expiresAt` — when it must be refreshed
- `reverificationRequired` — flag for forced re-verification
- `lineage` — ordered chain of provenance records linking back to prior phases

---

## 6. Architectural Invariants

These invariants apply to the A-series as a whole. Every future A-series feature must preserve them.

### 6.1 Phase Boundaries

1. **Each phase owns exactly one invariant.** No phase spans multiple concerns.
2. **Phases communicate only through typed contracts.** No phase calls another phase's internals.
3. **Contracts are shared schemas, not shared implementations.** Two phases may reference the same type without sharing code.

### 6.2 Evidence

4. **Evidence is immutable once emitted.** No phase modifies evidence produced by another phase.
5. **Evidence carries its own provenance.** Every evidence artifact has a `lineage` linking it to prior phases.
6. **Evidence has an explicit lifecycle.** Every evidence artifact carries `verifiedAt`, `expiresAt`, `reverificationRequired`.

### 6.3 Governance

7. **Governance depends on evidence, not implementation.** A3 evaluates evidence quality regardless of evidence origin.
8. **Execution never bypasses governance.** A4 requires a `GovernanceDecision` with kind `APPROVE`.
9. **Observation never mutates execution history.** A5 reads system state; it does not modify evidence from prior phases.

### 6.4 Execution

10. **Execution is deterministic and sequential.** Same inputs + same plan = same execution trace.
11. **Every forward step has a corresponding rollback step.** Rollback coverage is structural, not advisory.
12. **Execution produces verifiable evidence.** `EvolutionExecutionEvidence` is integrity-hashed.

### 6.5 Observation

13. **Providers never mutate the system.** Observation is read-only by construction.
14. **Providers never throw.** Every execution path returns a structured `ObservationResult`.
15. **Observation is separate from interpretation.** The bridge projects measurement outcomes faithfully without inferring governance conclusions.

---

## 7. Extension Points

The pipeline is closed at A5 — no additional core phases are needed for governed evolution. Future capabilities enrich the system by consuming and analyzing evidence rather than extending the control flow.

### 7.1 What consumes evidence (not pipeline phases)

```
Evidence Stream (VerificationEvidence + EvolutionExecutionEvidence)
        │
        ├── Adaptive Confidence Calibration
        │     Compare A2 projected confidence vs A5 observed outcomes
        │     across runs. Adjust projection models without changing
        │     the verification pipeline.
        │
        ├── Provider Reliability Scoring
        │     Mine historical observations for per-provider confidence
        │     calibration, timeout optimization, and resolution tuning.
        │
        ├── Governance Analytics
        │     Correlate decision outcomes with policy parameters.
        │     surface policies that are overly conservative or permissive.
        │
        ├── Cross-Run Learning
        │     Discover which proposal characteristics correlate with
        │     observed success or failure across executions.
        │
        ├── Recommendation Refinement
        │     Track A2.5 recommendation accuracy against observed
        │     outcomes. Improve recommendation models without
        │     modifying the governance pipeline.
        │
        └── ML Component Integration
              ML models consume evidence rather than integrating with
              individual phases, preserving phase isolation.
```

### 7.2 Integration pattern

New capabilities should follow this pattern:

```
Existing A-series phase
        │
        ▼
  Evidence artifact
        │
        ▼
  New capability (reads evidence, produces recommendations or signals)
        │
        ▼
  Feeds back into A1 (pattern discovery) or A3 (governance)
        │
        ▼
  Pipeline executes normally with improved inputs
```

This preserves the pipeline's determinism and auditability while allowing the system to become progressively more informed through accumulated observations.

---

## 8. Why the Pipeline Ends at A5

A5 completes the cycle: **observe → discover → verify → govern → execute → observe**. Every subsequent capability should look like:

```
Evidence
     │
     ▼
Analytics / Calibration / Learning / Optimization / Automation
```

—not:

```
Evidence
     │
     ▼
New Core Pipeline Phase
```

The reasons are architectural:

1. **The loop is closed.** A5 returns to observation, completing the governance cycle. Adding more phases between A5 and feedback would mean the loop spans multiple observations, which conflates measurement cycles with governance cycles.

2. **Phase isolation would degrade.** Each new phase would either duplicate existing capabilities (extending the pipeline indefinitely) or need to call multiple prior phases (breaking the single-invariant rule).

3. **The evidence model is stable.** Three evidence producers feed one governance consumer. Adding a fourth producer (e.g., external audit) is a provider addition, not a new pipeline phase. Adding a new governance model (e.g., risk-weighted voting) is a consumer change, not a new phase.

4. **Future capabilities are evidence consumers, not pipeline extenders.** Everything after A5 — calibration, analytics, learning, optimization — should read evidence streams. Adding them as pipeline phases would couple learning to execution, which is the opposite of the separation the architecture intentionally establishes.

**The boundary:** A phase is something the pipeline **waits for** before proceeding to the next gate. Analytics and learning should never block the pipeline. They consume evidence asynchronously and feed improved signals back into A1 or A3.

---

## 9. References

| Resource | Location |
|----------|----------|
| ADR-0006 (A-series decision record) | `docs/architecture/adrs/ADR-0006-a-series-governed-evolution-pipeline.md` |
| A0 Evolution Contract | `src/evolution/contracts/evolution-contract.ts` |
| A2 Verification | `src/evolution/verification/` |
| A3 Governance | `src/evolution/governance/` |
| A4 Execution | `src/evolution/execution/` |
| A5 Observation | `src/evolution/observation/` |
| A5 Design Spec | `docs/architecture/specs/2026-07-12-a5-outcome-observation-design.md` |
| A5 Implementation Plan | `docs/superpowers/plans/2026-07-12-a5-outcome-observation-plan.md` |
| Evidence Contract | `src/evolution/verification/contracts/verification-contract.ts` |
| Confidence Contract | `src/evolution/verification/contracts/confidence-contract.ts` |
| Evolution CLI | `src/governance/evolution-cli.ts` |
