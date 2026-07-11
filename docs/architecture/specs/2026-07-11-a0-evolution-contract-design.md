# A0 — Evolution Contract Design Specification

**Date:** 2026-07-11
**Status:** Design Specification
**Phase:** A0 — Evolution Contract
**Depends On:**
- P14 — Governance Infrastructure
- P15 — Governance Intelligence
- X1 — Execution Intent Contract
- X2 — Execution Evidence Capture
- X3b — Execution Evidence Persistence
- X4 — Governed Execution Runtime

**Checkpoint Target:** `alix-a0-evolution-contract-design-complete`

---

## 1. Purpose

A0 defines the **rules, artifacts, and boundaries** for ALiX evolution — the contract that governs how the system changes itself while remaining explainable, auditable, and reversible.

The X-series established governed execution: every action follows an explicit lifecycle with deterministic transitions and durable evidence. A0 extends this same discipline to **evolution itself** — changes to policies, agents, workflows, and runtime configuration.

A0 answers:

> How does ALiX change itself safely while remaining explainable, governed, and reversible?

---

## 2. Primary Invariant

> ALiX may observe, propose, and execute approved evolution workflows; ALiX may not silently evolve outside an explicit governance contract.

This invariant has five enforceable consequences:

1. **Evidence-backed** — No capability change without traceable origin. Every evolution must reference the evidence that triggered it.
2. **Contract-first** — New behavior requires explicit interfaces before implementation.
3. **Governance-bound** — New agents, policies, workflows, or execution paths inherit governance boundaries. Evolution cannot bypass governance.
4. **Immutable artifacts** — Every evolution produces immutable evidence: why it happened, what evidence triggered it, who approved it, what changed, what validation occurred, and what the outcome was.
5. **Not self-modification** — ALiX may propose and model evolution paths, but governance authority remains external.

---

## 3. Evolutionary Position in Architecture

```
P10 Executive Intelligence
P13 Cross-run Learning
P14 Governance Infrastructure
P15 Governance Intelligence
        ↓
X0–X4 Governed Execution Runtime
        ↓
A0 Evolution Contract
        ↓
  A0.1 — Evolution Intent Types
  A0.2 — Evolution Lifecycle State Machine
  A0.3 — Evolution Evidence Bridge
  A0.4 — Evolution Governance Surface
```

A0 sits at the top of the stack. It uses every layer below it:

- **P10/P13** — inputs for evolution proposals (intelligence signals, learning outcomes)
- **P14/P15** — governance boundaries, operator signals, audit trail
- **X1** — evolution intent modeled as an execution intent
- **X2/X3b** — evolution evidence captured and persisted via the same evidence pipeline
- **X4** — evolution executed through the governed execution runtime

---

## 4. Evolution Intent Contract

Every evolution begins with an explicit intent, mirroring X1's `ExecutionIntent`.

```typescript
interface EvolutionIntent {
  /** Unique identifier for this evolution. */
  evolutionId: string;

  /** What triggered this evolution proposal. */
  origin: EvolutionOrigin;

  /** What the evolution targets. */
  target: EvolutionTarget;

  /** Evidence references supporting this evolution. */
  rationale: EvidenceReference[];

  /** Description of the expected effect. */
  expectedEffect: string;

  /** Risk classification. */
  riskClass: "low" | "medium" | "high";

  /** Constraints governing how this evolution may be carried out. */
  constraints: EvolutionConstraint[];

  /** When the intent was created. */
  createdAt: string;
}

type EvolutionOrigin =
  | "operator"
  | "governance_signal"
  | "learning_outcome"
  | "system_observation";

interface EvolutionTarget {
  /** What kind of component the evolution targets. */
  kind: EvolutionTargetKind;
  /** Identifier of the target (policy ID, agent name, etc.). */
  id: string;
  /** Optional before-state hash for integrity verification. */
  currentHash?: string;
}

type EvolutionTargetKind =
  | "policy"
  | "agent_behavior"
  | "workflow"
  | "runtime_config"
  | "governance_rule"
  | "evidence_filter"
  | "execution_intent";
```

### Invariant

> No evolution exists without an explicit intent.

An evolution without a traceable `EvolutionIntent` is considered incomplete or invalid.

---

## 5. Evolution Artifact Model

Every evolution follows a defined artifact lifecycle, mirroring the X-series execution lifecycle.

### Lifecycle

```
EvolutionIntent
      |
      v
EvolutionProposal
      |
      v
EvolutionReview
      |
      v
EvolutionApproval
      |
      v
EvolutionImplementation
      |
      v
EvolutionValidation
      |
      v
EvolutionActivation
```

### Artifact Types

| Artifact | Description | Produced By |
|----------|-------------|-------------|
| `EvolutionIntent` | The trigger and rationale for the evolution | Origin system (operator, signal, learning) |
| `EvolutionProposal` | Concrete description of what changes and how | Planner (human or automated) |
| `EvolutionReview` | Governance review of the proposal before approval | Human operator |
| `EvolutionApproval` | Record of who approved the evolution and when | Governance authority |
| `EvolutionImplementation` | Evidence of what actually changed (diff, before/after) | Execution runtime |
| `EvolutionValidation` | Evidence that the change produces the expected effect | Validation system |
| `EvolutionActivation` | Record that the evolution is live and its scope | Activation system |

### Invariant

> Every evolution artifact is immutable after creation. Corrections or updates create new linked artifacts.

---

## 6. Evolution State Machine

Evolution proposals follow a defined state machine, mirroring X4's `ExecutionState`.

### States

```
DRAFT
  |
  v
PROPOSED
  |
  v
UNDER_REVIEW
  |
  +---------+---------+
  |         |         |
  v         v         v
APPROVED REJECTED  WITHDRAWN
  |
  v
IMPLEMENTING
  |
  v
VALIDATING
  |
  +---------+---------+
  |         |         |
  v         v         v
ACTIVE  FAILED_     ROLLED_BACK
        VALIDATION
```

### Transition Rules

| From | To | Trigger |
|------|----|---------|
| `DRAFT` | `PROPOSED` | Proposal finalized |
| `DRAFT` | `WITHDRAWN` | Originator cancels |
| `PROPOSED` | `UNDER_REVIEW` | Queued for governance review |
| `PROPOSED` | `REJECTED` | Governance rejects before review |
| `UNDER_REVIEW` | `APPROVED` | Governance approves |
| `UNDER_REVIEW` | `REJECTED` | Governance rejects |
| `UNDER_REVIEW` | `WITHDRAWN` | Originator withdraws during review |
| `APPROVED` | `IMPLEMENTING` | Execution begins |
| `APPROVED` | `REJECTED` | Approval expires or is revoked |
| `IMPLEMENTING` | `VALIDATING` | Implementation completes |
| `IMPLEMENTING` | `FAILED_VALIDATION` | Validation fails immediately |
| `VALIDATING` | `ACTIVE` | Validation passes |
| `VALIDATING` | `FAILED_VALIDATION` | Validation fails |
| `FAILED_VALIDATION` | `ROLLED_BACK` | Rollback executed |
| `FAILED_VALIDATION` | `ACTIVE` | Override (explicit approval) |

### Terminal States

`ACTIVE`, `REJECTED`, `WITHDRAWN`, `ROLLED_BACK`

### Invariant

> Every state transition emits an evolution evidence record. No implicit transitions.

---

## 7. Evolution Boundaries

A0 explicitly prohibits:

| Forbidden | Reason |
|-----------|--------|
| **Autonomous production mutation** | Breaks governance boundary. Production changes require explicit approval. |
| **Silent capability expansion** | Destroys explainability. Every change must have a traceable intent. |
| **Untracked policy changes** | Destroys auditability. Policy is governance — changes must be immutable events. |
| **Learning directly modifying runtime** | Bypasses review. Learning outputs are inputs to proposals, not mutations. |
| **Self-approval** | No system may approve its own evolution. Requires distinct governance authority. |

These are not implementation restrictions — they are **contract-level invariants** that all downstream A-series phases must respect.

---

## 8. Evolution Evidence Requirements

Every evolution artifact must produce evidence that connects back through the chain.

### Evidence Package

Every evolution transition produces an evidence record containing:

```typescript
interface EvolutionEvidence {
  /** Unique evidence identifier. */
  evidenceId: string;
  /** Reference to the evolution intent. */
  evolutionId: string;
  /** What lifecycle step produced this evidence. */
  stage: EvolutionStage;
  /** Why this change happened. */
  rationale: EvidenceReference[];
  /** What evidence triggered it. */
  triggerEvidenceId: string | null;
  /** Who approved it (null for pre-approval stages). */
  approvedBy: string | null;
  /** What changed (diff, description, or reference). */
  change: EvolutionChange;
  /** What validation occurred. */
  validation: EvolutionValidation | null;
  /** What was the outcome. */
  outcome: EvolutionOutcome;
  /** Link to the execution evidence if executed via X4. */
  executionEvidenceId: string | null;
  /** Timestamp. */
  createdAt: string;
}
```

### Evidence Flow

```
EvolutionIntent → EvolutionEvidence → X2 Capture → X3b Persist → P14 Audit
        ↓                                                               ↓
   Governance consumers                                          P29 Compliance
```

Evolution evidence flows through the same pipeline as execution evidence:

- **X2** captures the evolution evidence record
- **X3b** persists it durably
- **P14** incorporates it into the governance audit trail
- **P29** packages it for compliance

### Invariant

> Every evolution produces an evidence package containing: why, trigger, approver, change, validation, outcome.

---

## 9. Non-Goals

A0 explicitly does **not** include:

| Capability | Reason for Exclusion |
|------------|---------------------|
| **Automatic policy generation** | A0 defines the contract. Evolution proposal logic is A1+. |
| **Pattern discovery** | A0 defines artifacts. Discovery is A1. |
| **Evolution sandbox** | A0 defines boundaries. Sandbox infrastructure is A2. |
| **Governed adaptation loop** | A0 defines the lifecycle. The loop is A3. |
| **Actual system mutation** | A0 is contract-only. No mutation code exists in A0. |
| **Store or persistence** | A0 defines types and interfaces. Persistence comes in A0.2+. |
| **CLI tools** | A0 is contract-first. CLI surface comes in A0.4. |

---

## 10. Implementation Phases

### Phase A0.1 — Evolution Contract Types

**Scope:**
- `EvolutionIntent`, `EvolutionTarget`, `EvolutionOrigin` types
- `EvolutionProposal`, `EvolutionReview`, `EvolutionApproval` types
- `EvolutionEvidence` type
- `EvolutionState` enum
- Validation rules

**Deliverables:**
- `src/evolution/contracts/evolution-contract.ts` — types and validation
- Tests for type validation and invariants

**Excluded:**
- State machine implementation
- Store infrastructure
- CLI

---

### Phase A0.2 — Evolution Lifecycle State Machine

**Scope:**
- `EvolutionStateMachine` — state transitions for the 10-state evolution lifecycle
- Transition validation
- Evidence emission for each transition

**Deliverables:**
- `src/evolution/evolution-state-machine.ts`
- Tests for full transition matrix

**Excluded:**
- Persistence
- Actual system mutation

---

### Phase A0.3 — Evolution Evidence Bridge

**Scope:**
- Connect evolution events to X2 evidence capture
- Route evolution evidence to X3b persistence
- Link evolution evidence to governance audit trail (P14)

**Deliverables:**
- `src/evolution/evolution-evidence-bridge.ts`
- Integration tests with X3b store

**Excluded:**
- Governance integration (deferred to A0.4)

---

### Phase A0.4 — Evolution Governance Surface

**Scope:**
- `alix evolution` CLI commands (read-only initially)
- List, inspect, evidence, status
- `--json` output

**Deliverables:**
- CLI handler for `alix evolution list`, `inspect`, `evidence`
- Human-readable + JSON output

**Excluded:**
- Mutation commands (approved-by-governance only, future)
- Automatic proposal generation (A1)

---

## 11. A-Series Roadmap

```
A0  Evolution Contract          ← this phase (contract-first, no mutation)
A1  Pattern Discovery Engine    ← consume failures/metrics, generate proposals
A2  Evolution Sandbox           ← test changes before production
A3  Governed Adaptation Loop    ← propose → review → approve → implement → validate → activate
```

Each phase builds on the previous. A0 establishes the contract that all downstream phases must respect.

---

## 12. Testing Requirements

### Unit Tests

| Area | Coverage |
|------|----------|
| Type validation | All `EvolutionIntent` fields validated |
| Invalid origins rejected | Unknown `EvolutionOrigin` values |
| Invalid targets rejected | Unknown `EvolutionTargetKind` values |
| Empty rationale rejected | Evolution with no evidence references |
| Constraint validation | EvolutionConstraint rules |

### Integration Tests (A0.3+)

- Evolution evidence → X3b persistence → P14 audit
- Evolution state transitions produce correct evidence

---

## 13. Completion Criteria

A0 is complete when:

- [ ] **A0.1** — Evolution contract types defined with validation
- [ ] **A0.1** — Primary invariant documented and enforceable
- [ ] **A0.2** — Evolution state machine with deterministic transitions
- [ ] **A0.2** — Full transition matrix tested
- [ ] **A0.3** — Evolution evidence bridge to X2/X3b
- [ ] **A0.4** — `alix evolution` CLI (read-only)
- [ ] **A0.4** — Human-readable + JSON output
- [ ] **All tests pass** — TypeScript clean
- [ ] **Checkpoint created** — `alix-a0-evolution-contract-complete`

---

## 14. Architectural Outcome

After A0:

```
P10 Intelligence        P13 Learning        P14/P15 Governance
        |                    |                    |
        +--------------------+--------------------+
                             |
                             v
                    A0 Evolution Contract
                             |
              +--------------+--------------+
              |              |              |
              v              v              v
        Evolution        Evolution      Evolution
         Intents         Artifacts       Evidence
              |              |              |
              +--------------+--------------+
                             |
                             v
                     X4 Governed Execution
                             |
                             v
                    X3b Evidence Persistence
                             |
                             v
                    P14 Governance Audit
```

A0 closes the gap between governance intelligence and system evolution. The system becomes:

> **ALiX is not an autonomous agent framework. It is a governed autonomous evolution platform.**
