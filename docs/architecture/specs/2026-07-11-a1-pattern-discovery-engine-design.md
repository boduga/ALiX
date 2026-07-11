# A1 — Pattern Discovery Engine Design Specification

**Date:** 2026-07-11
**Status:** Design Specification
**Phase:** A1 — Pattern Discovery Engine

**Depends On:**
- A0 — Evolution Contract (types, lifecycle, evidence bridge, CLI)
- X3b — ExecutionEvidenceStore
- P14 — Governance Audit Trail
- P15 — Governance Intelligence

**Checkpoint Target:** `alix-a1-pattern-discovery-engine-design-complete`

---

## 1. Purpose

A1 introduces candidate evolution discovery — consuming execution evidence, governance signals, and historical outcomes to identify repeatable improvement patterns and produce evolution proposals.

A1 is proposal-only. It detects and recommends; it does not execute.

---

## 2. Primary Invariant

> Pattern discovery may recommend evolution but must never perform evolution.

This means:

- A1 may analyze evidence and generate `EvolutionProposal` artifacts
- A1 may not call `EvolutionStateMachine.transition()` automatically
- A1 may not modify runtime behavior, policies, or governance rules
- A1 may not self-approve its own proposals

Proposals enter the A0 lifecycle at the **PROPOSED** state and require governance review.

---

## 3. Architectural Position

```
X3b ExecutionEvidence      P14 Governance Audit      P15 Intelligence
        |                          |                       |
        +--------------------------+-----------------------+
                                   |
                                   v
                    A1 Pattern Discovery Engine
                                   |
                   +---------------+---------------+
                   |               |               |
                   v               v               v
             Failure          Performance      Governance
             Patterns         Patterns         Signals
                   |               |               |
                   +-------+-------+---------------+
                           |
                           v
                   EvolutionCandidate
                           |
                           v
                   EvolutionProposal (A0.1 contract)
                           |
                           v
                   A0.2 EvolutionStateMachine
                           |
                           v
                      PROPOSED
```

---

## 4. Responsibilities

### Provides

- `PatternObservation` — what was discovered
- `EvolutionCandidate` — a proposed evolution derived from a pattern
- Detection strategies (failure clustering, approval friction, performance)
- Confidence scoring per candidate
- `PatternDiscoveryEngine` — orchestrates detection → candidate generation
- `EvolutionProposalGenerator` — transforms candidates into A0 proposals

### Does Not Provide

- Automatic state transitions
- Runtime mutation
- Governance bypass
- Self-approval
- Persistent storage (candidates are ephemeral until proposed)
- CLI or UI

---

## 5. Non-Goals

A1 does **not** include:

| Capability | Reason |
|------------|--------|
| Automatic execution | A1 is proposal-only |
| Policy or runtime mutation | A2/A3 |
| Self-approval | Governance authority invariant |
| Persistent candidate storage | Candidates are derived from evidence, not stored |
| Web UI or dashboard | Future |
| Automated rollback | A3 |
| Multi-pattern correlation | Future enhancement |

---

## 6. Data Model

### PatternObservation

```typescript
interface PatternObservation {
  /** Unique pattern identifier. */
  patternId: string;

  /** Category of the observed pattern. */
  category: PatternCategory;

  /** Number of times this pattern was observed. */
  frequency: number;

  /** Confidence in the pattern (0–1). */
  confidence: number;

  /** Evidence references supporting this pattern. */
  evidenceIds: string[];

  /** Human-readable description of the pattern. */
  description: string;

  /** When the pattern was first observed. */
  firstObserved: string;

  /** When the pattern was last observed. */
  lastObserved: string;
}

type PatternCategory =
  | "execution_failure"
  | "approval_friction"
  | "performance_degradation"
  | "policy_ineffectiveness"
  | "governance_gap"
  | "agent_misbehavior";
```

### EvolutionCandidate

```typescript
interface EvolutionCandidate {
  /** Unique candidate identifier. */
  candidateId: string;

  /** Source pattern that generated this candidate. */
  sourcePatternId: string;

  /** Confidence that this evolution would improve outcomes (0–1). */
  confidence: number;

  /** Target of the proposed evolution. */
  target: EvolutionTarget;

  /** Description of the proposed change. */
  description: string;

  /** Expected effect of the change. */
  expectedEffect: string;

  /** Risk assessment. */
  riskClass: "low" | "medium" | "high";

  /** Evidence supporting this candidate. */
  evidenceIds: string[];
}
```

---

## 7. Detection Strategies

### 7.1 Execution Failure Clustering

**Input:** ExecutionEvidence records from X3b with `outcome === "FAILED"`.

**Detection:** Group failed executions by `intentId` prefix, agent, or target. If the same target fails more than N times in a window, emit a pattern.

**Example candidate:**

> "Execution step X has failed 12 times in 7 days. Retry policy may require adjustment."

### 7.2 Approval Friction Detection

**Input:** P14 audit events with `eventType === "action_denied"` or `"human_approval_denied"`.

**Detection:** If a specific policy or action type shows elevated denial rate over a window, emit a pattern.

**Example candidate:**

> "Policy P has denied 85% of requests in the last 30 days. Policy review recommended."

### 7.3 Performance Degradation

**Input:** ExecutionEvidence records with `outcome === "SUCCESS"` and timestamps.

**Detection:** Compare execution latency or resource usage over time. If a monotonic increase is detected, emit a pattern.

**Example candidate:**

> "Execution latency for workflow W has increased 40% over 14 days. Resource allocation review recommended."

### 7.4 Governance Gap Detection

**Input:** P15 effectiveness signals, operator decisions, escalations.

**Detection:** If operator decisions are consistently overridden or escalated without resolution, emit a pattern.

**Example candidate:**

> "12 decisions escalated to governance in 7 days with no resolution. Approval workflow may require adjustment."

---

## 8. Pattern Discovery Engine

```typescript
interface PatternDiscoveryEngine {
  /**
   * Run all registered detection strategies against the available
   * evidence and return discovered patterns.
   */
  runDiscovery(): Promise<DiscoveryResult>;
}

interface DiscoveryResult {
  patterns: PatternObservation[];
  candidates: EvolutionCandidate[];
  metadata: {
    evidenceScanned: number;
    detectionDurationMs: number;
    strategiesRun: number;
  };
}
```

### Pipeline

```
Evidence Loader
      |
      v
Detection Strategy 1    Detection Strategy 2    Detection Strategy N
      |                       |                       |
      +-------+-------+-------+-------+
              |                       |
              v                       v
       PatternObservation      PatternObservation
              |                       |
              +----------+------------+
                         |
                         v
             Candidate Generator
                         |
                         v
              EvolutionCandidate[]
                         |
                         v
             EvolutionProposalGenerator
                         |
                         v
              EvolutionProposal
```

---

## 9. Confidence Scoring

Each candidate receives a confidence score 0–1.

```
confidence = (evidenceCount / baselineCount) * patternStrength * recencyFactor
```

Where:

- `evidenceCount` — number of supporting evidence records
- `baselineCount` — expected baseline for the metric
- `patternStrength` — 0–1 based on how clearly the pattern matches (1.0 for exact match, 0.5 for partial)
- `recencyFactor` — 0–1 based on how recent the evidence is (more recent = higher)

Scores are informational. Governance makes the final decision.

---

## 10. Proposal Generation

```typescript
interface EvolutionProposalGenerator {
  /**
   * Transform an EvolutionCandidate into an A0 EvolutionProposal.
   * The proposal enters the A0 lifecycle at PROPOSED state.
   */
  generateProposal(candidate: EvolutionCandidate): EvolutionProposal;
}
```

### Mapping

| EvolutionProposal field | Source |
|------------------------|--------|
| `proposalId` | Generated |
| `evolutionId` | Generated (new evolution tracked in state machine) |
| `title` | Derived from `candidate.description` |
| `description` | `candidate.description` |
| `change` | Derived from `candidate.target` |
| `beforeHash` | `null` (will be set at implementation) |
| `afterHash` | `null` (will be set at implementation) |
| `createdAt` | Current timestamp |

After generation, the proposal creator calls:

```typescript
stateMachine.createEvolution(evolutionId, EvolutionState.PROPOSED, {
  targetKind: candidate.target.kind,
  targetId: candidate.target.id,
  origin: "pattern_discovery",
  createdAt: now,
});
```

This preserves the A0 invariant: **no evolution exists without an explicit intent**.

---

## 11. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| `ExecutionEvidenceStore` | Evidence input | X3b → A1 |
| `PatternDiscoveryEngine` | Orchestration | A1 |
| `EvolutionStateMachine` | Proposal registration | A1 → A0.2 |
| `EvolutionEvidenceBridge` | Pattern evidence emission | A1 → A0.3 |
| `EvolutionProposal` | Output artifact | A1 → A0.1 |

---

## 12. Implementation Slices

### A1.0 — Pattern Discovery Contract

- Types: `PatternObservation`, `EvolutionCandidate`, `PatternCategory`
- Confidence scoring function
- Validation rules

### A1.1 — Detection Pipeline

- `PatternDiscoveryEngine` interface and implementation
- Detection strategies (min 2: failure clustering, approval friction)
- Evidence loader from X3b store
- Pattern emission

### A1.2 — Proposal Generator

- `EvolutionProposalGenerator`
- Mapping from candidate to A0 proposal
- State machine integration (create PROPOSED evolution)

### A1.3 — Governance Report Integration

- Surface discovered patterns through CLI
- Link to A0.4 evolution CLI for viewing candidates

---

## 13. Testing Requirements

| # | Test | Verification |
|---|------|-------------|
| 1 | Failure clustering detects repeated failures | Pattern emitted |
| 2 | No failures → no pattern emitted | Empty result |
| 3 | Approval friction above threshold | Pattern emitted |
| 4 | Confidence scoring in range [0, 1] | Validated |
| 5 | Candidate → Proposal mapping | All fields correct |
| 6 | Proposal enters state machine at PROPOSED | State verified |
| 7 | Empty evidence → empty discovery | Graceful |
| 8 | Proposal generator does not call transition() | Invariant |
