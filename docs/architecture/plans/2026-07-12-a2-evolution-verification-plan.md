I will consolidate all approved refinements into a single canonical document. The final version below removes inconsistencies, aligns file counts, adds explicit test paths, defines the environment contract, and preserves all A2 architectural invariants.

---

# A2 — Evolution Verification Framework Implementation Plan

**Date:** 2026-07-12
**Branch:** `feat/a2-evolution-verification`
**Specification:** `docs/architecture/specs/2026-07-12-a2-evolution-verification-design.md`

---

# 1. Objective

A2 introduces the **Evolution Verification Framework**.

Its purpose is to transform an A1-generated evolution proposal into **projected evidence** through deterministic counterfactual evaluation.

A2 answers:

> "What would happen if this proposal were applied?"

A3 answers:

> "Should this change be allowed?"

A2 MUST:

* produce evidence
* preserve lineage
* maintain deterministic reproducibility
* remain policy-independent

A2 MUST NOT:

* deploy changes
* mutate production state
* approve evolution proposals
* bypass governance validation

---

# 2. Milestone Dependency Graph

```text
A2.0 Verification Contract Foundation
        |
        v
A2.1 Replay Dataset Contract
        |
        v
A2.2 Deterministic Verification Runtime
        |
        v
A2.3 Counterfactual Evaluation Engine
        |
        v
A2.4 Verification Evidence Bridge
        |
        v
A2.5 Governance Recommendation Engine
```

Dependency rules:

* Each milestone depends only on previous milestones.
* A2.0 is the foundation layer.
* A2.5 consumes evidence but does not become a governance authority.

---

# 3. Directory Structure

```text
src/evolution/verification/

  contracts/
    verification-contract.ts
    confidence-contract.ts
    replay-contract.ts
    counterfactual-contract.ts
    recommendation-contract.ts
    environment-contract.ts

  replay/
    logical-clock.ts
    seeded-prng.ts
    deterministic-scheduler.ts
    deterministic-event-merge.ts
    replay-engine.ts

  evaluation/
    historical-similarity.ts
    counterfactual-evaluator.ts

  evidence/
    verification-report.ts
    verification-evidence.ts
    evidence-ledger.ts
    lineage-tracker.ts

  confidence/
    confidence-calculator.ts

  recommendation/
    recommendation-engine.ts

  index.ts
```

Tests:

```text
tests/evolution/verification/

  contracts/

  replay/

  evaluation/

  evidence/

  confidence/

  recommendation/

  invariants/

  integration/
```

---

# 4. Existing Artifacts Reused

| Existing Artifact                      | Usage                                                  |
| -------------------------------------- | ------------------------------------------------------ |
| `evolution-contract.ts` (A0.1)         | EvolutionProposal, EvidenceReference, ValidationResult |
| `pattern-discovery-contract.ts` (A1.0) | Pure confidence calculation pattern                    |
| `evolution-state-machine.ts` (A0.2)    | Lifecycle pattern only — NOT reused                    |
| `evolution-evidence-bridge.ts` (A0.3)  | Evidence translation pattern                           |
| `execution-intent-contract.ts` (X1)    | Evidence compatibility                                 |
| `canonical-json.ts` (P4.3)             | canonicalStringify + SHA-256                           |

---

# A2.0 — Verification Contract Foundation

## Purpose

Define immutable verification artifacts, evidence hierarchy, confidence contracts, and failure taxonomy.

---

## Files

| File                                  | Purpose                         |
| ------------------------------------- | ------------------------------- |
| `contracts/verification-contract.ts`  | Run, Report, Evidence contracts |
| `contracts/confidence-contract.ts`    | Confidence structures           |
| `contracts/environment-contract.ts`   | Verification environment        |
| `confidence/confidence-calculator.ts` | Confidence computation          |
| `index.ts`                            | Public exports                  |

Tests:

```text
tests/evolution/verification/contracts/
```

---

# Evidence Hierarchy

```typescript
type EvidenceClass =
    | "observed"
    | "derived"
    | "projected";
```

Precedence:

```text
Observed
   >
Derived
   >
Projected
```

Projected evidence cannot override observed evidence.

---

# Verification Status

```typescript
type VerificationStatus =
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
```

---

# Verification Failure Taxonomy

```typescript
type VerificationFailureKind =
    | "ReplayConstructionFailure"
    | "ReplayIntegrityFailure"
    | "SandboxInitializationFailure"
    | "ProposalExecutionFailure"
    | "DeterminismFailure"
    | "CoverageFailure"
    | "MetricCollectionFailure"
    | "PolicyEvaluationFailure"
    | "ResourceConstraintFailure"
    | "TimeoutFailure";
```

Failure types MUST never collapse into generic verification errors.

---

# Verification Environment Contract

```typescript
interface VerificationEnvironment {

    environmentId: string;

    environmentHash: string;

    runtimeVersions:
        Readonly<Record<string,string>>;

    configurationHash: string;

}
```

The environment participates in deterministic hashing.

---

# Verification Run

```typescript
interface VerificationRun {

    verificationId:string;

    proposalId:string;

    proposalSnapshotHash:string;

    replayDatasetId:string;

    environmentId:string;

    environmentHash:string;

    startedAt:string;

    completedAt:string | null;

    status:VerificationStatus;

    failureReason:
        VerificationFailureKind | null;

}
```

---

# Verification Report

Operational artifact.

```typescript
interface VerificationReport {

    reportId:string;

    verificationId:string;

    evidenceClass:EvidenceClass;

    replayMetadata:
        Readonly<Record<string,unknown>>;

    executionLogs:
        readonly string[];

    metricResults:
        readonly MetricResult[];

    diagnostics:
        readonly Record<string,unknown>[];

}
```

---

# Verification Evidence

Governance artifact.

```typescript
interface VerificationEvidence {

    evidenceId:string;

    verificationId:string;

    proposalId:string;

    proposalSnapshotHash:string;

    replayDatasetId:string;

    evidenceClass:"projected";

    baselineMetrics:
        Readonly<Record<string,number>>;

    candidateMetrics:
        Readonly<Record<string,number>>;

    metricDeltas:
        Readonly<Record<string,number>>;

    behavioralChanges:
        readonly string[];

    confidenceProfile:
        ConfidenceProfile;

    reproducibilityLevel:
        ReproducibilityLevel;

    lineage:
        readonly LineageRecord[];

    verifiedAt:string;

    expiresAt:string;

    reverificationRequired:boolean;

    integrityHash:string;

}
```

---

# Confidence Contract

```typescript
interface ConfidenceProfile {

    replayFidelity:number;

    coverage:number;

    determinism:number;

    historicalSimilarity:number;

    overallConfidence:number;

}
```

Formula:

```text
overallConfidence =
min(
 replayFidelity,
 coverage,
 determinism
)
*
historicalSimilarity
```

Confidence is epistemic.

It measures trustworthiness, not success probability.

---

# Reproducibility Contract

```typescript
type ReproducibilityLevel =
    | 0
    | 1
    | 2
    | 3;
```

| Level | Guarantee                          |
| ----- | ---------------------------------- |
| 0     | Same metrics                       |
| 1     | Same report                        |
| 2     | Same evidence artifact             |
| 3     | Cryptographically identical output |

A2 targets Level 2.

---

# A2.1 — Replay Dataset Contract

## Purpose

Create immutable historical reality snapshots.

---

## Files

```text
contracts/replay-contract.ts

evaluation/historical-similarity.ts
```

Tests:

```text
tests/evolution/verification/evaluation/historical-similarity.test.ts

tests/evolution/verification/contracts/replay-contract.test.ts
```

---

# Replay Dataset

```typescript
interface ReplayDataset {

    datasetId:string;

    datasetHash:string;

    historicalWindow:{
        startTime:string;
        endTime:string;
        durationMs:number;
    };

    evidenceSources:
        readonly EvidenceSource[];

    evidenceCount:number;

    policySnapshot:PolicySnapshot;

    topologySnapshot:TopologySnapshot;

    telemetrySnapshot:TelemetrySnapshot;

    agentConfigurationSnapshot:
        AgentConfigurationSnapshot;

    constructionMetadata:
        ConstructionMetadata;

    createdAt:string;

}
```

---

# Dataset Hash

Uses:

```text
canonicalStringify()

        +

SHA-256

        +

"alix-evolution-v2:"
```

---

# Historical Similarity

```typescript
interface HistoricalSimilarityAssessment {

    workloadSimilarity:number;

    topologySimilarity:number;

    policySimilarity:number;

    resourceSimilarity:number;

    agentCompositionSimilarity:number;

    trafficSimilarity:number;

    failurePatternSimilarity:number;

    overallSimilarity:number;

    coverageGaps:
        readonly string[];

}
```

---

# A2.2 — Deterministic Verification Runtime

## Purpose

Execute proposals against replay datasets deterministically.

---

## Files

```text
replay/logical-clock.ts

replay/seeded-prng.ts

replay/deterministic-scheduler.ts

replay/deterministic-event-merge.ts

replay/replay-engine.ts
```

---

# Determinism Controls

Mandatory:

```text
Logical Clock

+

Seeded PRNG

+

Deterministic Scheduler

+

Deterministic Event Merge
```

---

# Logical Clock

```typescript
class LogicalClock {

    tick():number;

    now():number;

    reset():void;

    snapshot():LogicalClockSnapshot;

    restore(snapshot):void;

}
```

---

# Seeded PRNG

```typescript
class SeededPRNG {

    next():number;

    nextInt(
        min:number,
        max:number
    ):number;

}
```

---

# Deterministic Scheduler

```typescript
class DeterministicScheduler {

    schedule(task:ScheduledTask):void;

    drain():Promise<void>;

}
```

---

# Event Merge

Ordering:

```text
tick ascending

sourceId lexicographic

sequenceNumber ascending
```

---

# Replay Engine

```typescript
class ReplayEngine {

    execute(
        dataset:ReplayDataset,
        proposal:EvolutionProposal
    ):Promise<ReplayResult>;

}
```

Invariant:

```text
Same dataset hash

+

Same proposal hash

+

Same environment hash

+

Same controls

=

Equivalent evidence
```

---

# A2.3 — Counterfactual Evaluation Engine

## Files

```text
contracts/counterfactual-contract.ts

evaluation/counterfactual-evaluator.ts
```

---

# Outcome Classification

```typescript
type OutcomeClassification =
    | "improvement"
    | "neutral"
    | "regression"
    | "insufficient";
```

---

# Metric Evaluation

```typescript
interface CounterfactualMetricEvaluation {

    metricName:string;

    baselineValue:number;

    candidateValue:number;

    delta:number;

    threshold:number;

    statisticalConfidence:number;

    classification:
        OutcomeClassification;

}
```

---

Invariant:

```text
A2 determines behavioral difference.

A3 determines acceptability.
```

---

# A2.4 — Verification Evidence Bridge

## Files

```text
evidence/verification-report.ts

evidence/verification-evidence.ts

evidence/evidence-ledger.ts

evidence/lineage-tracker.ts
```

---

# Artifact Flow

```text
Verification Run

        |

        v

Verification Report

        |

        v

Verification Evidence
```

---

# Integrity Hash

Contract:

```text
canonicalStringify()

        |

        v

SHA-256

        |

        v

integrityHash
```

Excluded:

* integrityHash
* transient runtime values
* nondeterministic metadata

---

# Freshness Enforcement

Bridge MUST reject:

```text
current_time >= expires_at
```

Expired evidence:

* remains auditable
* remains queryable historically
* cannot be consumed by A3

---

# A2.5 — Governance Recommendation Engine

## Files

```text
contracts/recommendation-contract.ts

recommendation/recommendation-engine.ts
```

---

# Recommendation Types

```typescript
type GovernanceRecommendationKind =
    | "APPROVE"
    | "MONITOR"
    | "REQUEST_ADDITIONAL_EVIDENCE"
    | "REJECT"
    | "ESCALATE";
```

---

# Recommendation Contract

```typescript
interface GovernanceRecommendation {

    recommendationId:string;

    evidenceId:string;

    proposalId:string;

    kind:
        GovernanceRecommendationKind;

    confidence:number;

    reasoning:string;

    supportingEvidence:
        readonly string[];

    risks:
        readonly string[];

    createdAt:string;

}
```

---

# Governance Boundary

RecommendationEngine:

MUST:

* provide advisory output
* reference evidence
* remain deterministic

MUST NOT:

* transition EvolutionState
* deploy changes
* mutate system state
* bypass A3 validation

---

# Integration Tests

Location:

```text
tests/evolution/verification/integration/
```

| Test                               | Purpose                  |
| ---------------------------------- | ------------------------ |
| `verification-lifecycle.test.ts`   | Complete A2 pipeline     |
| `determinism-verification.test.ts` | Evidence reproducibility |

---

# Invariant Tests

Location:

```text
tests/evolution/verification/invariants/
```

| Test                          | Purpose              |
| ----------------------------- | -------------------- |
| `evidence-hierarchy.test.ts`  | Evidence precedence  |
| `determinism.test.ts`         | Hash reproducibility |
| `expiration.test.ts`          | TTL enforcement      |
| `policy-independence.test.ts` | A2/A3 separation     |

---

# Final File Count

| Area        | Source |  Tests |
| ----------- | -----: | -----: |
| A2.0        |      5 |      3 |
| A2.1        |      2 |      2 |
| A2.2        |      5 |      5 |
| A2.3        |      2 |      2 |
| A2.4        |      4 |      5 |
| A2.5        |      2 |      2 |
| Invariants  |      0 |      4 |
| Integration |      0 |      2 |
| **Total**   | **20** | **25** |

---

# Test Execution

Recommended:

```bash
npm run test -- tests/evolution/verification
```

Runner guidance:

| Test Type                    | Runner           |
| ---------------------------- | ---------------- |
| Pure contracts               | Node test runner |
| Pure deterministic functions | Node test runner |
| Async replay runtime         | Vitest           |
| Integration                  | Vitest           |

---

# Architecture Invariants Summary

| Invariant                                   | Enforcement                   |
| ------------------------------------------- | ----------------------------- |
| A2 never mutates system state               | No deployment paths           |
| A2 produces evidence, not decisions         | Recommendation boundary       |
| Evidence hierarchy explicit                 | EvidenceClass                 |
| Replay deterministic                        | Four replay controls          |
| Verification ≠ Validation                   | Policy-independent evaluation |
| Evidence integrity compatible with X-series | canonicalStringify + SHA-256  |
| Evidence freshness enforced                 | Bridge rejection              |
| Full lineage preserved                      | Artifact hashes               |
| Recommendations advisory only               | A3 authority boundary         |

---

# Status

**Canonical Implementation Plan**

Branch:

```text
feat/a2-evolution-verification
```

First implementation milestone:

```text
A2.0 — Verification Contract Foundation
```

Ready for implementation.

