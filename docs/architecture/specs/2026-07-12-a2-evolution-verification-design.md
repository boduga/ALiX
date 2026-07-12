# A2 — Evolution Verification Framework Design Specification

**Date:** 2026-07-12
**Status:** Design Specification
**Phase:** A2 — Evolution Verification Framework

**Depends On:**
- A0 — Evolution Contract (types, lifecycle, evidence bridge, CLI)
- A1 — Pattern Discovery Engine (detection, candidates, proposals)
- X2/X3b — Execution Evidence
- P14 — Governance Audit Trail

**Checkpoint Target:** `alix-a2-evolution-verification-design-complete`

---

## 1. Primary Invariant

> Evolution proposals are never evaluated directly against the live governance system.

Instead, every proposal is transformed into **Verification Evidence** produced by deterministic replay of historical execution under controlled conditions. Only verified evidence may influence adaptation.

This extends ALiX's core evidence-first principle into the future: the system does not require real-world deployment to assess a proposal's impact. It constructs projected futures from historical evidence and evaluates those.

---

## 2. Architectural Position

```
Observed Execution
        │
        ▼
Execution Evidence (X2/X3b)
        │
        ▼
Governance Intelligence (P14/P15)
        │
        ▼
Pattern Discovery (A1)
        │
        ▼
Evolution Proposal (A0.1)
        │
        ▼
════════════════════════════════╗
║  A2 Verification Boundary     ║
║                                ║
║  ┌─────────────────────────┐   ║
║  │ Sandbox Replay          │   ║
║  │ Historical Context      │   ║
║  │ Counterfactual Execution│   ║
║  └─────────┬───────────────┘   ║
║            ▼                   ║
║  ┌─────────────────────────┐   ║
║  │ Verification Evidence   │   ║
║  └─────────────────────────┘   ║
╚═══════════════════════════════╝
        │
        ▼
Governance Decision
        │
        ▼
A3 Governed Adaptation
```

The key architectural shift across phases:

| Phase | Produces | Confidence |
|-------|----------|------------|
| **X** (Execution Runtime) | Observed evidence | `observed` — immutable, highest |
| **P14/P15** (Governance Intelligence) | Derived signals | `analytical` — computed from observation |
| **A1** (Pattern Discovery) | Hypotheses + proposals | `inferred` — statistical, survey-based |
| **A2** (Evolution Verification) | Projected evidence | `projected` — computed via deterministic simulation |
| **A3** (Governed Adaptation) | Mutation + outcome evidence | `observed` — after deployment, back to highest |

The system has no shortcut. Projected evidence is never promoted to observed confidence without real-world execution.

---

## 3. Evidence Classes

Formally separate all ALiX evidence into three categories with distinct trust properties.

### 3.1 Observed Evidence

**Produced by:** Execution runtime (X2/X3b), Adaptation executor (A3/A4)

**Properties:**
- Records what actually happened
- Immutable once committed
- Highest confidence tier
- Admissible as ground truth for all downstream analysis

```
evidence_class: "observed"
confidence: 1.0 (by definition — real execution is the reference frame)
```

### 3.2 Derived Evidence

**Produced by:** Governance Intelligence (P14/P15), Pattern Discovery (A1)

**Properties:**
- Computed from observed evidence through analytical transforms
- Inherits confidence from source evidence, modified by transform fidelity
- Includes statistical confidence intervals
- Examples: pattern frequency, denial rate, governance gap count, recommendation score

```
evidence_class: "derived"
confidence: computed from source × transform_fidelity
```

### 3.3 Projected Evidence

**Produced by:** Evolution Verification (A2)

**Properties:**
- Computed via deterministic simulation over historical data
- Represents a counterfactual future — what WOULD happen, not what DID happen
- Explicit confidence model capturing replay fidelity, coverage, and determinism
- Never promoted to `observed` without real-world execution

```
evidence_class: "projected"
confidence: computed from replay × coverage × determinism × similarity
```

### 3.4 Confidence Hierarchy

Downstream consumers MUST respect evidence class precedence:
`observed > derived > projected`

A governance decision MUST NOT treat projected evidence as equivalent to observed evidence when both are available for the same metric. When projected evidence contradicts observed evidence, observed evidence takes precedence.

---

## 4. Deterministic Verification Contract

This is the foundational contract that makes A2 trustworthy.

### 4.1 Core Invariant

> A verification run is valid iff identical inputs always produce identical outputs.

### 4.2 Inputs to the Deterministic Contract

A verification run receives:

| Input | Source | Description |
|-------|--------|-------------|
| `proposal` | A0.1 | The evolution proposal to verify |
| `historical_dataset` | X2/X3b/P14 | Execution evidence + governance events for replay |
| `dataset_hash` | Content hash | Deterministic hash of the replay dataset |
| `proposal_hash` | Content hash | Deterministic hash of the proposal being verified |
| `replay_seed` | Generated | Seed for any pseudo-random behaviour during replay |
| `scheduler_policy` | Config | Scheduling algorithm (FIFO, round-robin, etc.) |
| `resource_quotas` | Config | Memory, CPU, time limits for the sandbox |
| `verification_policy` | Config | Which checks to run, thresholds to enforce |
| `environment_snapshot` | Captured | Policy versions, config hashes, governance state |

### 4.3 Outputs

| Output | Description |
|--------|-------------|
| `verification_id` | Unique run identifier |
| `baseline_metrics` | Metrics from replaying the CURRENT system on historical data |
| `candidate_metrics` | Metrics from replaying the PROPOSED system on historical data |
| `delta` | Structured comparison between baseline and candidate |
| `replay_metadata` | Determinism proof: seed, scheduler version, dataset hash, proposal hash |
| `risk_assessment` | Risk class + contributing factors |
| `confidence_profile` | Per-metric confidence scores |
| `coverage_report` | What historical scenarios were exercised |

### 4.4 Determinism Requirements

A verification runtime MUST control:

| Source of non-determinism | Control mechanism |
|---------------------------|-------------------|
| Wall clock | Injected logical clock |
| Thread/process scheduling | Recorded scheduler ordering |
| Random number generation | Seeded PRNG (seed included in report) |
| Event ordering | Deterministic merge of concurrent event streams |
| System resources | Quota-enforced, non-divergent under quota pressure |
| Network I/O | Recorded/replayed responses |
| Timeouts | Logical-time timeout, not wall-clock |
| Hashing | Deterministic canonical serialization (existing X2 contract) |

### 4.5 Verification Metadata

Every `VerificationReport` MUST contain sufficient metadata to reproduce the run:

```yaml
verification_context:
  seed: 42
  scheduler_version: "alix-scheduler-v1"
  replay_version: "alix-replay-v1"
  logical_clock: 1720800000
  dataset_hash: "sha256:abc123..."
  proposal_hash: "sha256:def456..."
  environment_hash: "sha256:789ghi..."
  resource_quotas:
    max_memory_mb: 512
    max_cpu_ms: 60000
    max_wall_clock_ms: 120000
```

---

## 5. Sandbox Runtime

### 5.1 Responsibilities

| Responsibility | Description |
|---------------|-------------|
| Isolated execution | Proposal logic runs in a contained environment with no live system access |
| Deterministic replay | Same inputs always produce same outputs |
| Resource enforcement | Hard limits on memory, CPU, and wall-clock time |
| Synthetic inputs | Generate inputs that exercise proposal logic across historical scenarios |
| Replay historical evidence | Feed past execution evidence through the proposed change |
| Timeout handling | Kill runaway verifications with deterministic timeout |
| No live mutation | Sandbox traverses no code path that modifies the running system |
| Report generation | Package verification results into structured evidence |

### 5.2 Isolation Boundary

```
                        ┌──────────────────────────────┐
                        │    Live Governance System     │
                        │  (not reachable from sandbox) │
                        └──────────────────────────────┘
                                    ▲
                                    │ (evidence only)
                                    │
┌───────────────────────────────────┴─────────────────────┐
│                    Sandbox Runtime                       │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Replay       │  │ Proposal     │  │ Metric        │  │
│  │ Engine       │──▶ Executor     │──▶ Collector     │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Historical   │  │ Policy       │  │ Coverage      │  │
│  │ Context      │  │ Checker      │  │ Tracker       │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 5.3 Execution Model

The sandbox:

1. Receives an approved evolution proposal
2. Loads the replay dataset (historical evidence)
3. Constructs the baseline execution context (current system)
4. Constructs the candidate execution context (proposal applied)
5. Replays both contexts against historical scenarios
6. Collects metrics from both runs
7. Computes deltas
8. Packages results as VerificationEvidence
9. Destroys both contexts (no state leaks)

---

## 6. Evidence Replay

### 6.1 Replay vs Playback

Replay is **not** simple event playback. Replay reconstructs the execution context in which events occurred, preserving temporal structure that affects outcomes.

### 6.2 Preserved Context

| Context dimension | Preserves | Why it matters |
|-------------------|-----------|----------------|
| Event ordering | Causal relationships between execution steps | A proposal that reorders operations may break dependencies |
| Temporal spacing | Time between events | Latency-sensitive proposals need realistic timing |
| Dependency timing | When external calls complete | Timeout-sensitive logic depends on this |
| Governance state | Policy versions, active rules | A proposal that changes a policy must be replayed against the conditions that policy governs |
| Resource pressure | Memory/CPU availability at each point | Proposals that reduce resource usage must be tested under realistic pressure |
| Execution lineage | Parent-child relationships between intents | Workflow changes affect downstream executions |
| Error conditions | Which failures occurred and when | Resilience proposals must encounter the same failure patterns |

### 6.3 Replay Dataset

A replay dataset is a structured collection of:

- ExecutionEvidence records (X3b)
- GovernanceAuditEvent records (P14)
- Evidence chain relationships
- Resource usage telemetry
- Policy snapshots
- Governance state snapshots

The dataset is identified by content hash for determinism verification.

### 6.4 Replay Modes

| Mode | Purpose | Dataset |
|------|---------|---------|
| **Full** | Production verification | All historical evidence within window |
| **Regression** | Targeted regression check | Evidence around known failure patterns |
| **Stress** | Edge-case characterization | Synthetic high-load scenarios |
| **Governance** | Policy compliance check | Governance-heavy evidence slices |
| **Mutation** | Boundary testing | Deliberately perturbed evidence |

---

## 7. Comparative Evaluation

### 7.1 Baseline vs Candidate

Every verification run produces two metric sets:

**Baseline:** Replay the current system against historical data.
**Candidate:** Replay the proposed system against the same data.

### 7.2 Metric Dimensions

| Dimension | Baseline | Candidate | Delta |
|-----------|----------|-----------|-------|
| Execution success rate | 94.2% | 96.1% | +1.9 pp |
| P50 latency (ms) | 245 | 230 | -15 ms |
| P99 latency (ms) | 1890 | 2100 | +210 ms |
| Memory per execution (MB) | 128 | 132 | +4 MB |
| Policy compliance | 99.1% | 98.7% | -0.4 pp |
| Failure rate by category | {...} | {...} | {...} |
| Governance decisions | {...} | {...} | {...} |

### 7.3 Delta Classification

Every delta is classified as:

| Class | Label | Meaning |
|-------|-------|---------|
| `🟢` | improvement | Statistically significant improvement |
| `🟡` | neutral | No significant change |
| `🔴` | regression | Statistically significant degradation |
| `⚪` | insufficient_data | Cannot determine significance |

### 7.4 Evidence Package

The comparison is packaged as `VerificationEvidence`:

```yaml
verification_evidence:
  evidence_id: "ver-ev-001"
  evidence_class: "projected"
  proposal_id: "prop-002"
  verification_id: "ver-run-042"

  baseline_metrics:
    success_rate: 0.942
    latency_p50_ms: 245
    latency_p99_ms: 1890
    memory_per_exec_mb: 128

  candidate_metrics:
    success_rate: 0.961
    latency_p50_ms: 230
    latency_p99_ms: 2100
    memory_per_exec_mb: 132

  deltas:
    success_rate:
      value: 0.019
      direction: "improvement"
      significance: "p < 0.01"
    latency_p99_ms:
      value: 210
      direction: "regression"
      significance: "p < 0.05"

  confidence_profile:
    replay_fidelity: 0.97
    coverage_score: 0.85
    determinism_score: 1.0
    overall_confidence: 0.83
```

---

## 8. Coverage Model

### 8.1 Tracking

Coverage tracks how much of the historical evidence space the verification exercised:

| Dimension | Tracked |
|-----------|---------|
| Executions replayed | Count and proportion of available execution evidence |
| Failure paths exercised | Number of distinct failure modes encountered |
| Policy branches visited | Number of distinct policy rules triggered |
| Governance decisions replayed | Count of governance events included |
| Recommendation categories covered | Which discovery categories were verified |
| Temporal coverage | Date range of replayed evidence |

### 8.2 Coverage Thresholds

Verification evidence MUST include coverage scores. Evidence with coverage below configured thresholds MUST be flagged with reduced confidence.

```
coverage:
  execution_coverage: 0.92    (9200 / 10000 eligible executions)
  failure_path_coverage: 0.78 (18 / 23 known failure modes)
  policy_coverage: 0.65       (13 / 20 applicable policy rules)
  governance_coverage: 0.88   (440 / 500 governance events)
  temporal_coverage:
    start: "2026-05-01"
    end: "2026-07-01"
  overall_coverage: 0.81
```

### 8.3 Coverage-Adjusted Confidence

`overall_confidence = min(replay_fidelity, coverage_score, determinism_score) × historical_similarity`

Where:
- `replay_fidelity` (0–1): How faithfully the sandbox reproduces execution context
- `coverage_score` (0–1): Proportion of relevant historical scenarios exercised
- `determinism_score` (0–1): Verifiability of deterministic execution
- `historical_similarity` (0–1): How similar the test conditions are to current production state

---

## 9. Verification Confidence Model

Every projected evidence item carries explicit confidence information distinguishing how certain the verifier is about its own projections.

### 9.1 Confidence Dimensions

| Dimension | Range | Meaning |
|-----------|-------|---------|
| `replay_fidelity` | 0–1 | How faithfully the sandbox reproduced execution context |
| `coverage_score` | 0–1 | Proportion of relevant scenarios exercised |
| `determinism_score` | 0–1 | How verifiably deterministic the run was |
| `statistical_confidence` | 0–1 | Statistical significance of observed deltas |
| `historical_similarity` | 0–1 | Similarity between test conditions and current production |

### 9.2 Overall Confidence

`overall_confidence = derived` (computed from individual dimensions)

The confidence model ensures that:
- A high-coverage, high-fidelity run with strong statistical significance receives higher confidence
- A low-coverage or low-fidelity run is explicitly flagged as uncertain
- Historical similarity anchors confidence to current production state
- Downstream consumers can weight verification evidence by its own stated confidence

---

## 10. Verification Lineage

### 10.1 Lineage Chain

Every verification report preserves complete lineage:

```
Historical Evidence (X2/X3b/P14)
         │
         ▼
Replay Dataset ───── dataset_hash
         │
         ├── proposal_hash ─── Evolution Proposal (A0.1)
         │
         ▼
Verification Run ────── seed, scheduler_version, environment_hash
         │
         ▼
Verification Evidence (projected)
         │
         ▼
Governance Decision ─── consumes verification_id
```

### 10.2 Traceability Requirements

- Every `VerificationEvidence` MUST reference its source `proposal_id`
- Every `VerificationEvidence` MUST reference its source `verification_id`
- Every `VerificationEvidence` MUST include `dataset_hash` and `proposal_hash`
- Every verification run MUST record its complete input state
- Nothing may be anonymous
- Everything MUST be traceable to its evidence sources

---

## 11. Risk Classification

### 11.1 Classification

Verification classifies proposals, not merely accept/reject:

| Risk Class | Meaning | Typical Criteria |
|------------|---------|------------------|
| `LOW` | Projected improvements dominate | All significant deltas are improvements; no regressions |
| `MEDIUM` | Mixed or uncertain outcomes | Improvements offset by minor regressions; confidence > 0.5 |
| `HIGH` | Significant regressions projected | One or more critical-metric regressions; confidence > 0.5 |
| `UNKNOWN` | Insufficient evidence | Coverage < threshold; confidence < 0.3 |

### 11.2 Contributing Factors

Risk classification considers multiple factors:

- Projected regressions (type, magnitude, affected metrics)
- Confidence interval width
- Replay coverage score
- Deterministic confidence
- Policy compliance delta
- Historical similarity

---

## 12. Governance Recommendation

### 12.1 Recommendation from Verification

Rather than a simple `PASS` / `FAIL`, verification recommendations become policy-aware:

| Recommendation | Meaning | Required Conditions |
|---------------|---------|---------------------|
| `APPROVE` | Proceed to adaptation | LOW risk, all checks pass, coverage adequate |
| `APPROVE_WITH_MONITORING` | Proceed with enhanced observation | MEDIUM risk, regressions are monitored |
| `REQUEST_MORE_EVIDENCE` | Insufficient coverage for decision | Coverage below threshold, UNKNOWN risk |
| `REJECT` | Do not adapt | HIGH risk, critical regressions |
| `ESCALATE` | Cannot determine; human review | UNKNOWN risk, conflicting signals |

### 12.2 Invariant

Governance owns the decision. Verification produces evidence and recommendations.

---

## 13. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| `EvolutionStateMachine` | Read proposal at APPROVED state | A2 → A0.2 |
| `ExecutionEvidenceStore` | Read historical execution evidence | A2 → X3b |
| `AuditStore` | Read historical governance events | A2 → P14 |
| `EvolutionEvidenceBridge` | Emit verification evidence | A2 → A0.3 |
| `GovernanceIntakeAdapter` | Submit verification reports | A2 → A0 lifecycle |
| `A3AdaptationEngine` | Consume verification evidence | A2 → A3 |

---

## 14. Implementation Slices

### A2.0 — Verification Contract Types

- `VerificationEvidence` type
- `VerificationReport` type
- `VerificationConfidence` model
- `RiskClassification` type
- `EvidenceClass` type (`observed | derived | projected`)
- Validation rules
- Coverage model types

### A2.1 — Sandbox Runtime

- Isolated execution environment
- Resource enforcement (memory, CPU, time)
- Deterministic execution contract
- Logical clock and seeded PRNG
- Timeout handling

### A2.2 — Evidence Replay

- Replay dataset construction from X3b + P14
- Execution context reconstruction
- Replay fidelity measurement
- Coverage tracking

### A2.3 — Comparative Evaluation

- Baseline vs candidate metrics
- Delta computation and significance testing
- Metric collection framework
- Regression detection

### A2.4 — Verification Confidence Model

- Confidence dimension computation
- Overall confidence derivation
- Coverage-adjusted confidence
- Historical similarity scoring

### A2.5 — Governance Recommendation Engine

- Policy-aware recommendation (APPROVE / MONITOR / REQUEST / REJECT / ESCALATE)
- Risk classification from verification evidence
- Recommendation → governance decision bridge

### A2.6 — Verification Report CLI

- Surface verification results
- Compare verification runs
- Reproduce verification runs from metadata
- Link to A0.4 evolution CLI

---

## 15. Testing Requirements

| # | Test | Verification |
|---|------|-------------|
| 1 | Deterministic: same inputs → same output | Byte-identical verification reports |
| 2 | Deterministic: different seed → different output allowed | Reports differ only in non-deterministic fields |
| 3 | Isolation: sandbox cannot reach live system | Network/FS access denied |
| 4 | Coverage tracking: partial replay → reduced confidence | `overall_confidence < 1.0` |
| 5 | Risk classification: all regressions identified | Delta comparison catches all metric regressions |
| 6 | Evidence class: projected evidence never marked observed | Type system enforces distinction |
| 7 | Lineage: every verification traceable to inputs | All hashes present and valid |
| 8 | Recommendation: low risk → `APPROVE`, high risk → `REJECT` | Policy check |
| 9 | Replay: temporal spacing preserved | Event timestamps match historical intervals |
| 10 | Resource enforcement: runaway killed | Timeout produces error report, not crash |

---

## 16. Relationship to A3

A2 produces evidence only. It does not mutate governance, modify the runtime, or trigger adaptations.

A3 (Governed Adaptation) consumes A2's verification evidence to:

- Select which approved, verified proposals to deploy
- Execute adaptations through the governed execution runtime
- Monitor rollout using live execution evidence
- Detect regressions and policy violations during rollout
- Support automatic pause and governed rollback
- Record a complete adaptation audit trail linking proposal → verification → deployment → monitoring → rollback (if any)

This completes the closed loop:

```
Observe
    ↓
Analyze
    ↓
Propose
    ↓
Approve
    ↓
Verify (A2)
    ↓
Adapt (A3)
    ↓
Observe
```

Adaptation is the only phase that mutates the system, and it occurs only after observation, analysis, governance approval, and verification have each contributed immutable evidence.

---

## 17. Non-Goals

A2 does NOT include:

| Capability | Reason |
|------------|--------|
| Automatic adaptation | A2 is evidence-only; A3 owns mutation |
| Runtime mutation | A2 sandbox is isolated by design |
| Governance bypass | A2 recommendations are advisory |
| Self-approval | A2 produces evidence, not authority |
| Persistent verification state | Verification runs are reproducible from inputs |
| UI or dashboard | Future |
| Automated rollback | A3 |
| Real-time verification | A2 is batch-oriented over historical data |
