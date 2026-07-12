# A2 — Evolution Verification Framework Implementation Plan

**Date:** 2026-07-12
**Branch:** `feat/a2-evolution-verification`
**Spec:** `docs/architecture/specs/2026-07-12-a2-evolution-verification-design.md`

---

## Milestone Dependency Graph

```
A2.0 Verification Contract Foundation
  │
  ▼
A2.1 Replay Dataset Contract
  │
  ▼
A2.2 Deterministic Verification Runtime
  │
  ▼
A2.3 Counterfactual Evaluation Engine
  │
  ▼
A2.4 Verification Evidence Bridge
  │
  ▼
A2.5 Governance Recommendation Engine
```

Each milestone depends strictly on the one before it. A2.0 is the sole leaf dependency; A2.5 consumes everything prior.

---

## Directory Structure

```
src/evolution/verification/
  contracts/
    verification-contract.ts          # A2.0 — core types, evidence hierarchy, failure taxonomy
    confidence-contract.ts            # A2.0 — confidence model types
    replay-contract.ts                # A2.1 — ReplayDataset contract
    counterfactual-contract.ts        # A2.3 — counterfactual evaluation types
    recommendation-contract.ts        # A2.5 — recommendation types
  replay/
    logical-clock.ts                  # A2.2 — controlled timeline
    seeded-prng.ts                    # A2.2 — deterministic seeded PRNG
    deterministic-scheduler.ts        # A2.2 — deterministic task ordering
    deterministic-event-merge.ts      # A2.2 — parallel event merge
    replay-engine.ts                  # A2.2 — orchestrating replay engine
  evaluation/
    historical-similarity.ts          # A2.1 — historical similarity assessment
    counterfactual-evaluator.ts       # A2.3 — counterfactual evaluation
  evidence/
    verification-report.ts            # A2.4 — report construction
    verification-evidence.ts          # A2.4 — evidence construction + integrity hashing
    evidence-ledger.ts                # A2.4 — ledger persistence
    lineage-tracker.ts                # A2.4 — lineage tracking
  confidence/
    confidence-calculator.ts          # A2.0 — confidence computation
  recommendation/
    recommendation-engine.ts          # A2.5 — recommendation engine
  index.ts                            # barrel exports
```

Tests mirror this under `tests/evolution/verification/`.

---

## Existing Artifacts to Reuse

| Module | What A2 Reuses |
|--------|---------------|
| `evolution-contract.ts` (A0.1) | `EvolutionProposal`, `EvidenceReference`, `ValidationResult`, `EvolutionState` |
| `pattern-discovery-contract.ts` (A1.0) | `computeConfidence` pattern for pure function confidence |
| `evolution-state-machine.ts` (A0.2) | Lifecycle pattern (NOT reused directly — A2 has own lifecycle) |
| `evolution-evidence-bridge.ts` (A0.3) | Evidence emission translation pattern |
| `execution-intent-contract.ts` (X1) | `ExecutionEvidence` type, canonical hashing via `canonicalStringify` + SHA-256 |
| `canonical-json.ts` (P4.3) | `canonicalStringify` for integrity hashing |

---

## A2.0 — Verification Contract Foundation (~5 files)

### Files

| File | Purpose |
|------|---------|
| `src/evolution/verification/contracts/verification-contract.ts` | Core types: `VerificationRun`, `VerificationReport`, `VerificationEvidence`, `EvidenceClass`, `VerificationStatus`, `VerificationFailureKind`, lineage types |
| `src/evolution/verification/contracts/confidence-contract.ts` | `ConfidenceProfile`, `HistoricalSimilarityAssessment` |
| `src/evolution/verification/confidence/confidence-calculator.ts` | `computeOverallConfidence()` — pure function for §9.1 formula |
| `src/evolution/verification/index.ts` | Barrel exports |
| `tests/evolution/verification/verification-contract.test.ts` | Type validation, status/failure-kind rejection, boundary cases |
| `tests/evolution/verification/confidence-contract.test.ts` | Profile structural validation |

### Key Types

```typescript
type EvidenceClass = "observed" | "derived" | "projected";

type VerificationStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

type VerificationFailureKind =
  | "ReplayConstructionFailure" | "ReplayIntegrityFailure"
  | "SandboxInitializationFailure" | "ProposalExecutionFailure"
  | "DeterminismFailure" | "CoverageFailure"
  | "MetricCollectionFailure" | "PolicyEvaluationFailure"
  | "ResourceConstraintFailure" | "TimeoutFailure";

interface VerificationRun {
  verificationId: string; proposalId: string; replayDatasetId: string;
  environmentId: string; startedAt: string; completedAt: string | null;
  status: VerificationStatus; failureReason: VerificationFailureKind | null;
}

interface VerificationEvidence {
  evidenceId: string; verificationId: string; proposalId: string;
  replayDatasetId: string;
  baselineMetrics: Record<string, number>;
  candidateMetrics: Record<string, number>;
  metricDeltas: Record<string, number>;
  behavioralChanges: string[];
  confidenceProfile: ConfidenceProfile;
  reproducibilityLevel: "deterministic" | "non_deterministic" | "unknown";
  lineage: LineageRecord[];
  verifiedAt: string; expiresAt: string;
  reverificationRequired: boolean; integrityHash: string;
}
```

### Invariants
- Three artifacts are distinct: Run ≠ Report ≠ Evidence
- Evidence class is explicit on every artifact
- Failure taxonomy is typed — never collapses to "Verification Failed"
- All contracts are pure types with `Readonly<>` wrappers

---

## A2.1 — Replay Dataset Contract (~4 files)

### Files

| File | Purpose |
|------|---------|
| `src/evolution/verification/contracts/replay-contract.ts` | `ReplayDataset`, snapshots, `computeDatasetHash()` |
| `src/evolution/verification/evaluation/historical-similarity.ts` | `computeHistoricalSimilarity()` — pure function for §10 similarity |
| `tests/evolution/verification/replay-contract.test.ts` | Dataset validation, hash determinism |
| `tests/evolution/verification/historical-similarity.test.ts` | Similarity scoring: identical→1.0, orthogonal→0.0 |

### Key Types

```typescript
interface ReplayDataset {
  datasetId: string; datasetHash: string;
  historicalWindow: { startTime: string; endTime: string; durationMs: number };
  evidenceSources: { sourceId: string; sourceType: string; referenceCount: number }[];
  evidenceCount: number;
  policySnapshot: PolicySnapshot;
  topologySnapshot: TopologySnapshot;
  telemetrySnapshot: TelemetrySnapshot;
  agentConfigurationSnapshot: AgentConfigurationSnapshot;
  constructionMetadata: ConstructionMetadata;
  createdAt: string;
}
```

### Invariants
- Dataset is referenced by ID, never embedded in verification result
- Hash is deterministic: `canonicalStringify` + SHA-256 with `"alix-evolution-v2:"` prefix
- Snapshots are immutable (`Readonly<>`)
- Historical window is bounded: `startTime < endTime`

---

## A2.2 — Deterministic Verification Runtime (~10 files)

### Files

| File | Purpose |
|------|---------|
| `src/evolution/verification/replay/logical-clock.ts` | Tick-based controlled timeline |
| `src/evolution/verification/replay/seeded-prng.ts` | Deterministic mulberry32 PRNG |
| `src/evolution/verification/replay/deterministic-scheduler.ts` | Tick-based priority scheduler |
| `src/evolution/verification/replay/deterministic-event-merge.ts` | `mergeEvents()` — deterministic stream merge |
| `src/evolution/verification/replay/replay-engine.ts` | `ReplayEngine` orchestrator |
| 5 test files | Clock, PRNG, scheduler, event merge, engine |

### Key Types

```typescript
class LogicalClock {
  tick(): number; now(): number;
  reset(): void; snapshot(): LogicalClockSnapshot; restore(snapshot): void;
}

class SeededPRNG {
  constructor(seed: number);
  next(): number; nextInt(min: number, max: number): number;
  reset(): void; snapshot(); restore(snapshot);
}

class DeterministicScheduler {
  constructor(clock: LogicalClock);
  schedule(task: ScheduledTask): void;
  drain(): Promise<void>;
  pending(): number;
}

function mergeEvents(streams: DeterministicEvent[][]): DeterministicEvent[];
// Ordered by: tick ascending → sourceId lexicographic → sequenceNumber ascending

class ReplayEngine {
  constructor(config: ReplayEngineConfig);
  execute(dataset: ReplayDataset, proposal: EvolutionProposal): Promise<ReplayResult>;
  validateEnvironment(): boolean;
}
```

### Invariants
- Same (Dataset + Proposal + Environment + Controls) → equivalent results
- All 4 controls must be present: clock, PRNG, scheduler, merge
- No `Date.now()`, `Math.random()`, or `crypto.randomUUID()` leaks
- All errors carry `VerificationFailureKind`

---

## A2.3 — Counterfactual Evaluation Engine (~4 files)

### Files

| File | Purpose |
|------|---------|
| `src/evolution/verification/contracts/counterfactual-contract.ts` | `CounterfactualEvaluation`, `CounterfactualMetricEvaluation`, `OutcomeClassification` |
| `src/evolution/verification/evaluation/counterfactual-evaluator.ts` | `CounterfactualEvaluator` with `classifyMetric()` |
| 2 test files | Contract validation, evaluator edge cases |

### Key Types

```typescript
type OutcomeClassification = "improvement" | "neutral" | "regression" | "insufficient";

interface CounterfactualMetricEvaluation {
  metricName: string; baselineValue: number; candidateValue: number;
  delta: number; threshold: number;
  statisticalConfidence: number;  // 0-1
  classification: OutcomeClassification;
}
```

### Invariants
- Policy-independent: `classifyMetric` determines behavioral difference, not acceptability
- Every metric is classified — no unclassified metrics
- Confidence is epistemic, not probabilistic

---

## A2.4 — Verification Evidence Bridge (~10 files)

### Files

| File | Purpose |
|------|---------|
| `src/evolution/verification/evidence/verification-report.ts` | `VerificationReportBuilder` |
| `src/evolution/verification/evidence/verification-evidence.ts` | `createVerificationEvidence()`, `computeEvidenceIntegrityHash()`, `isEvidenceExpired()` |
| `src/evolution/verification/evidence/evidence-ledger.ts` | `VerificationEvidenceLedger` (in-memory Map, swappable to X3b) |
| `src/evolution/verification/evidence/lineage-tracker.ts` | `LineageTracker` |
| 5 test files | Evidence, report, ledger, lineage, confidence |

### Invariants
- Integrity hash uses `canonicalStringify` + SHA-256 with `"alix-evolution-v2:"` prefix
- Hash excludes: self field, non-deterministic timestamps, transient metadata
- Bridge rejects expired evidence on read
- Ledger is append-only
- Reports are operational; evidence is governance

---

## A2.5 — Governance Recommendation Engine (~4 files)

### Files

| File | Purpose |
|------|---------|
| `src/evolution/verification/contracts/recommendation-contract.ts` | `GovernanceRecommendationKind`, `GovernanceRecommendation` |
| `src/evolution/verification/recommendation/recommendation-engine.ts` | `RecommendationEngine.generate()` |
| 2 test files | Contract validation, all 5 recommendation paths |

### Key Types

```typescript
type GovernanceRecommendationKind =
  | "APPROVE" | "MONITOR"
  | "REQUEST_ADDITIONAL_EVIDENCE" | "REJECT" | "ESCALATE";

interface GovernanceRecommendation {
  recommendationId: string; evidenceId: string; proposalId: string;
  kind: GovernanceRecommendationKind;
  confidence: number;  // 0-1
  reasoning: string; supportingEvidence: string[]; risks: string[]; createdAt: string;
}
```

### Recommendation Logic

| Kind | Trigger |
|------|---------|
| `APPROVE` | Confidence ≥ threshold AND no regression classifications |
| `MONITOR` | Confidence ≥ threshold AND mixed classifications |
| `REQUEST_ADDITIONAL_EVIDENCE` | Confidence < threshold OR many `insufficient` classifications |
| `REJECT` | Confidence below minimum OR critical regressions |
| `ESCALATE` | Unexpected patterns OR confidence indeterminable |

### Invariants
- Does not replace A3 decision authority — recommendations are inputs, not binding
- Same evidence + same config = same recommendation (deterministic)
- Every recommendation carries numeric confidence

---

## Integration Tests

| Test | What it verifies |
|------|------------------|
| `verification-lifecycle.test.ts` | End-to-end: A2.0→A2.1→A2.2→A2.3→A2.4→A2.5 |
| `determinism-verification.test.ts` | Same inputs = identical evidence (hash + fields) |

---

## File Summary

**39 files total** (37 new + 2 existing extended):

| Milestone | New files | Tests | Total |
|-----------|-----------|-------|-------|
| A2.0 | 4 | 2 | 6 |
| A2.1 | 2 | 2 | 4 |
| A2.2 | 5 | 5 | 10 |
| A2.3 | 2 | 2 | 4 |
| A2.4 | 5 | 5 | 10 |
| A2.5 | 2 | 2 | 4 |
| Integration | — | 2 | 2 |
| **Total** | **20 source** | **20 test** | **40** |

---

## Key Risks

| Risk | Mitigation |
|------|------------|
| Deterministic replay hard to achieve | 4 isolated controls, each independently testable |
| Historical similarity may be subjective | All dimensions are 0-1 numeric ratios with explicit formula |
| A2 depends on X3b for ledger persistence | In-memory `Map` first, swappable interface later |
| Confidence model may be misread as probability | Epistemic naming, never "probability," `min()` formula encodes non-compensatory behavior |
| A2 lifecycle may be conflated with A0 state machine | Verification runs have own lifecycle — don't reuse `EvolutionStateMachine` |

---

## Test Command

```bash
npx tsx --test tests/evolution/verification/**/*.test.ts
```

---

## Architecture Invariants Summary

| Invariant | Enforced By |
|-----------|-------------|
| A2 never mutates the system | No deploy/execution code in scope |
| A2 produces evidence, not decisions | Recommendation is advisory, not binding |
| Evidence class hierarchy explicit | `EvidenceClass` type on every artifact |
| Deterministic replay guaranteed | 4 controls (clock, PRNG, scheduler, merge) |
| Verification ≠ Validation | Outcome classification is policy-independent |
| Integrity hash matches X-series | Same `canonicalStringify` + SHA-256 contract |
| Evidence freshness enforced | Bridge rejects expired evidence on read |
