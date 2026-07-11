I incorporated the refinements: clearer A0/X4 boundary, evolution lineage invariant, evidence contract decoupling, append-only lifecycle history, and the governance authority invariant.

# A0 — Evolution Contract Design Specification

**Date:** 2026-07-11
**Status:** Design Specification
**Phase:** A0 — Evolution Contract

**Depends On:**

* P14 — Governance Infrastructure
* P15 — Governance Intelligence
* X1 — Execution Intent Contract
* X2 — Execution Evidence Capture
* X3b — Execution Evidence Persistence
* X4 — Governed Execution Runtime

**Checkpoint Target:** `alix-a0-evolution-contract-design-complete`

---

# 1. Purpose

A0 defines the **rules, artifacts, and boundaries** for ALiX evolution.

The X-series established governed execution:

* explicit intent
* deterministic lifecycle transitions
* evidence capture
* durable persistence
* controlled execution

A0 extends these principles to **system evolution**.

A0 defines how ALiX may evolve policies, agents, workflows, runtime configuration, and governance capabilities while preserving:

* explainability
* auditability
* reversibility
* governance authority
* evidence lineage

A0 answers:

> How does ALiX change itself safely while remaining explainable, governed, and reversible?

---

# 2. Primary Invariant

> **ALiX may observe, propose, and execute approved evolution workflows; ALiX may not silently evolve outside an explicit governance contract.**

This invariant creates five enforceable rules.

---

## 2.1 Evidence-backed Evolution

No capability or behavior change may occur without traceable origin.

Every evolution must reference:

* originating evidence
* triggering signals
* rationale
* expected effect

---

## 2.2 Contract-first Evolution

New behavior requires explicit contracts before implementation.

Evolution must define:

* target
* constraints
* lifecycle
* validation requirements
* rollback expectations

---

## 2.3 Governance-bound Evolution

Evolution inherits all governance boundaries.

New:

* agents
* policies
* workflows
* execution paths
* runtime capabilities

must enter through governed workflows.

Evolution cannot bypass governance.

---

## 2.4 Immutable Evolution Artifacts

Evolution artifacts are append-only evidence.

Every evolution records:

* why it happened
* what triggered it
* who approved it
* what changed
* what validation occurred
* final outcome

Historical artifacts are never modified.

Corrections create new linked artifacts.

---

## 2.5 No Autonomous Authority

ALiX may:

* detect opportunities
* generate proposals
* model possible improvements

ALiX may not:

* self-approve changes
* bypass governance review
* silently modify production behavior

Governance authority remains external.

---

# 3. Architectural Position

A0 completes the path from intelligence to governed evolution.

```
P10 Executive Intelligence
        |
P13 Cross-run Learning
        |
P14 Governance Infrastructure
        |
P15 Governance Intelligence
        |
        v
A0 Evolution Contract
        |
        v
Governed Evolution Workflow
        |
        v
X4 Governed Execution Runtime
        |
        v
X2/X3b Evidence Pipeline
        |
        v
P14 Governance Audit
```

A0 does not replace existing layers.

It composes them.

---

# 4. Architectural Responsibilities

## P10 / P13

Provide evolution inputs:

* intelligence signals
* learning outcomes
* recurring patterns
* improvement opportunities

They identify possibilities.

They do not authorize changes.

---

## P14 / P15

Provide governance control:

* audit trail
* review boundaries
* effectiveness signals
* compliance evidence

They determine whether evolution is acceptable.

---

## X1-X4

Provide execution discipline:

* execution intent
* execution lifecycle
* evidence capture
* governed runtime

They execute approved evolution activities.

---

# 5. Evolution Intent Contract

Every evolution begins with an explicit intent.

The contract mirrors X1 `ExecutionIntent`.

```typescript
interface EvolutionIntent {
  evolutionId: string;

  origin: EvolutionOrigin;

  target: EvolutionTarget;

  rationale: EvidenceReference[];

  expectedEffect: string;

  riskClass:
    | "low"
    | "medium"
    | "high";

  constraints: EvolutionConstraint[];

  createdAt: string;
}
```

---

## 5.1 Evolution Origin

```typescript
type EvolutionOrigin =
  | "operator"
  | "governance_signal"
  | "learning_outcome"
  | "system_observation";
```

Origin identifies motivation.

Origin does not grant authority.

---

## 5.2 Evolution Target

```typescript
interface EvolutionTarget {

  kind: EvolutionTargetKind;

  id: string;

  currentHash?: string;
}
```

```typescript
type EvolutionTargetKind =
  | "policy"
  | "agent_behavior"
  | "workflow"
  | "runtime_config"
  | "governance_rule"
  | "evidence_filter"
  | "execution_intent";
```

---

## Intent Invariant

> No evolution exists without an explicit EvolutionIntent.

An evolution without intent is invalid.

---

# 6. Evolution Artifact Model

Every evolution produces a linked artifact chain.

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

---

## Artifact Definitions

| Artifact                | Purpose                       |
| ----------------------- | ----------------------------- |
| EvolutionIntent         | Defines trigger and rationale |
| EvolutionProposal       | Describes intended change     |
| EvolutionReview         | Governance evaluation         |
| EvolutionApproval       | Authorization record          |
| EvolutionImplementation | Actual change evidence        |
| EvolutionValidation     | Outcome verification          |
| EvolutionActivation     | Live-state record             |

---

# 7. Evolution Lineage Invariant

Every artifact MUST preserve the originating `evolutionId`.

```
EvolutionIntent
      |
      +-- Proposal
      |
      +-- Review
      |
      +-- Approval
      |
      +-- Implementation
      |
      +-- Validation
      |
      +-- Activation
```

No evolution artifact may exist without lineage to an originating intent.

---

# 8. Evolution Lifecycle State Machine

Evolution follows a deterministic lifecycle.

```
DRAFT
 |
 v
PROPOSED
 |
 v
UNDER_REVIEW
 |
 +-------------+-------------+
 |             |             |
 v             v             v
APPROVED    REJECTED    WITHDRAWN
 |
 v
IMPLEMENTING
 |
 v
VALIDATING
 |
 +-------------+-------------+
 |             |             |
 v             v             v
ACTIVE   FAILED_VALIDATION ROLLED_BACK
```

---

# 9. State Contract

```typescript
type EvolutionState =
  | "draft"
  | "proposed"
  | "under_review"
  | "approved"
  | "implementing"
  | "validating"
  | "active"
  | "rejected"
  | "withdrawn"
  | "failed_validation"
  | "rolled_back";
```

---

# 10. Transition Rules

| From              | To                | Trigger                     |
| ----------------- | ----------------- | --------------------------- |
| DRAFT             | PROPOSED          | Proposal finalized          |
| DRAFT             | WITHDRAWN         | Originator cancels          |
| PROPOSED          | UNDER_REVIEW      | Governance review requested |
| PROPOSED          | REJECTED          | Governance rejects          |
| UNDER_REVIEW      | APPROVED          | Approval granted            |
| UNDER_REVIEW      | REJECTED          | Approval denied             |
| UNDER_REVIEW      | WITHDRAWN         | Proposal withdrawn          |
| APPROVED          | IMPLEMENTING      | Execution begins            |
| IMPLEMENTING      | VALIDATING        | Implementation complete     |
| IMPLEMENTING      | FAILED_VALIDATION | Immediate failure           |
| VALIDATING        | ACTIVE            | Validation succeeds         |
| VALIDATING        | FAILED_VALIDATION | Validation fails            |
| FAILED_VALIDATION | ROLLED_BACK       | Rollback completes          |
| FAILED_VALIDATION | ACTIVE            | Explicit override approval  |

---

## State Invariants

* Invalid transitions fail.
* Every transition emits evidence.
* State history is append-only.
* Current state is derived from transition history.

---

# 11. Evolution Evidence Contract

Evolution evidence uses the existing evidence architecture.

A0 consumes the evidence contract.

A0 does not couple to storage internals.

```typescript
interface EvolutionEvidence {

  evidenceId: string;

  evolutionId: string;

  stage: EvolutionStage;

  rationale: EvidenceReference[];

  triggerEvidenceId: string | null;

  approvedBy: string | null;

  change: EvolutionChange;

  validation: EvolutionValidation | null;

  outcome: EvolutionOutcome;

  executionEvidenceId: string | null;

  createdAt: string;
}
```

---

# 12. Evidence Flow

```
Evolution Intent
        |
        v
Evolution Evidence
        |
        v
X2 Evidence Contract
        |
        v
X3b Persistence
        |
        v
P14 Audit Trail
        |
        v
P29 Compliance Packages
```

---

## Evidence Invariant

Every evolution evidence package must answer:

* Why did this happen?
* What triggered it?
* Who approved it?
* What changed?
* What validation occurred?
* What was the outcome?

---

# 13. Evolution Boundaries

The following are prohibited:

| Forbidden                           | Reason                        |
| ----------------------------------- | ----------------------------- |
| Autonomous production mutation      | Violates governance authority |
| Silent capability expansion         | Violates explainability       |
| Untracked policy changes            | Violates auditability         |
| Learning directly modifying runtime | Bypasses governance           |
| Self-approval                       | Removes independent authority |

---

# 14. Evolution Authority Invariant

> Evolution consumes governance evidence; it does not create governance authority.

Correct flow:

```
Governance Signal
        |
        v
Evolution Proposal
        |
        v
Governance Decision
        |
        v
Approved Execution
        |
        v
Validation Evidence
```

Incorrect flow:

```
Governance Signal
        |
        v
Automatic Change
```

---

# 15. Non-Goals

A0 does not include:

| Capability                  | Deferred To                  |
| --------------------------- | ---------------------------- |
| Automatic policy generation | A1                           |
| Pattern discovery           | A1                           |
| Evolution sandbox           | A2                           |
| Adaptation loop             | A3                           |
| Production mutation         | Future governed phases       |
| Persistence implementation  | Future infrastructure phases |
| CLI mutation commands       | Future governance phases     |

---

# 16. Implementation Phases

## A0.1 — Evolution Contract Types

Scope:

* EvolutionIntent
* EvolutionTarget
* EvolutionOrigin
* EvolutionEvidence
* EvolutionState
* validation rules

Deliver:

```
src/evolution/contracts/
    evolution-contract.ts
```

Constraints:

* pure module
* no stores
* no mutation

---

## A0.2 — Evolution Lifecycle State Machine

Scope:

* deterministic transitions
* transition validation
* transition evidence generation

Deliver:

```
src/evolution/
    evolution-state-machine.ts
```

---

## A0.3 — Evolution Evidence Bridge

Scope:

* connect evolution evidence to X2 contract
* persist through X3b
* expose governance audit linkage

Deliver:

```
src/evolution/
    evolution-evidence-bridge.ts
```

---

## A0.4 — Evolution Governance Surface

Scope:

Read-only visibility:

```bash
alix evolution list

alix evolution inspect <id>

alix evolution evidence <id>

alix evolution --json
```

No mutation commands.

---

# 17. Testing Requirements

## Contract Tests

Required coverage:

* valid EvolutionIntent creation
* invalid origin rejection
* invalid target rejection
* missing rationale rejection
* constraint validation
* lineage validation

---

## Lifecycle Tests

Required coverage:

* full valid lifecycle
* every invalid transition
* rollback paths
* evidence emission

---

## Integration Tests

Required:

* evolution evidence → X2 contract
* X3b persistence path
* P14 audit linkage

---

# 18. Completion Criteria

A0 is complete when:

* [ ] Evolution contracts implemented
* [ ] Evolution invariants enforced
* [ ] State machine implemented
* [ ] Transition matrix tested
* [ ] Evidence lineage preserved
* [ ] X2/X3b evidence compatibility verified
* [ ] Governance boundaries preserved
* [ ] Read-only governance surface implemented
* [ ] TypeScript clean
* [ ] All tests passing
* [ ] Checkpoint created:

```
alix-a0-evolution-contract-complete
```

---

# 19. Architectural Outcome

After A0:

```
Intelligence
(P10/P13)
     |
     v
Governance
(P14/P15)
     |
     v
Evolution Contract
(A0)
     |
     +----------------+
     |                |
     v                v
Evolution          Evidence
Artifacts          Lineage
     |                |
     +----------------+
              |
              v
      Governed Execution
              |
              v
       Audit & Compliance
```

A0 closes the architectural gap between governance intelligence and system evolution.

Final principle:

> **ALiX is not an autonomous agent framework. ALiX is a governed autonomous evolution platform.**

This is ready to checkpoint as the canonical A0 design specification. The next implementation artifact should be **A0.1 — Evolution Contract Types Implementation Plan**.

