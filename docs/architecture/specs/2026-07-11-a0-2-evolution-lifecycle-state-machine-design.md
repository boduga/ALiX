# A0.2 — Evolution Lifecycle State Machine Design Specification

**Date:** 2026-07-11
**Status:** Design Specification
**Phase:** A0 — Evolution Contract
**Slice:** A0.2 — Evolution Lifecycle State Machine

**Depends On:**

* A0.1 — Evolution Contract Types
* X4.1 — Execution State Machine (pattern reference)

**Checkpoint Target:**
`alix-a0-2-evolution-lifecycle-state-machine-complete`

---

# 1. Purpose

A0.2 introduces the deterministic lifecycle state machine for ALiX evolution workflows.

The X-series established governed execution through:

* explicit intent
* deterministic transitions
* lifecycle validation
* evidence generation

A0.2 applies the same discipline to evolution.

This slice manages the lifecycle of evolution proposals from initial drafting through:

* approval
* implementation
* validation
* activation

or failure paths:

* rejection
* withdrawal
* rollback

A0.2 defines **state behavior only**.

It does not execute changes.

---

# 2. Primary Invariant

> Every evolution follows a deterministic lifecycle with explicit state transitions. No implicit, skipped, or spontaneous transitions are permitted.

This means:

* every transition has a defined source state
* every transition has a defined destination state
* invalid transitions fail
* state history is deterministic
* transition events are emitted

---

# 3. Architectural Boundary

A0.2 owns lifecycle behavior.

It does not own evidence persistence or execution.

```text
A0.1
Evolution Contracts
        |
        v
A0.2
Evolution Lifecycle State Machine
        |
        v
Evolution Transition Events
        |
        v
A0.3
Evidence Bridge
        |
        v
X2/X3b Evidence Pipeline
        |
        v
P14 Governance Audit
```

---

# 4. Responsibilities

A0.2 provides:

* state transition validation
* allowed transition map
* lifecycle management
* transition event generation
* deterministic state changes
* invalid transition handling

A0.2 does not provide:

* persistence
* evidence storage
* CLI
* governance approval workflows
* runtime mutation
* automatic evolution

---

# 5. Evolution States

The lifecycle consists of eleven states.

```text
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

# 6. State Definitions

| State               | Meaning                                      |
| ------------------- | -------------------------------------------- |
| `DRAFT`             | Evolution intent accepted and being prepared |
| `PROPOSED`          | Evolution proposal finalized                 |
| `UNDER_REVIEW`      | Governance evaluation in progress            |
| `APPROVED`          | Governance authorized implementation         |
| `REJECTED`          | Governance declined evolution                |
| `WITHDRAWN`         | Originator cancelled evolution               |
| `IMPLEMENTING`      | Approved change is being applied             |
| `VALIDATING`        | Change outcome is being verified             |
| `ACTIVE`            | Evolution is live                            |
| `FAILED_VALIDATION` | Validation did not succeed                   |
| `ROLLED_BACK`       | Change was reverted                          |

---

# 7. Terminal States

The following states are terminal:

```text
ACTIVE
REJECTED
WITHDRAWN
ROLLED_BACK
```

Terminal states cannot transition further.

Examples:

Forbidden:

```text
ACTIVE → IMPLEMENTING

REJECTED → APPROVED

WITHDRAWN → PROPOSED

ROLLED_BACK → ACTIVE
```

---

# 8. Allowed Transition Map

```typescript
const evolutionTransitions = {

  DRAFT: [
    "PROPOSED",
    "WITHDRAWN"
  ],

  PROPOSED: [
    "UNDER_REVIEW",
    "REJECTED"
  ],

  UNDER_REVIEW: [
    "APPROVED",
    "REJECTED",
    "WITHDRAWN"
  ],

  APPROVED: [
    "IMPLEMENTING",
    "REJECTED"
  ],

  IMPLEMENTING: [
    "VALIDATING",
    "FAILED_VALIDATION"
  ],

  VALIDATING: [
    "ACTIVE",
    "FAILED_VALIDATION"
  ],

  FAILED_VALIDATION: [
    "ROLLED_BACK",
    "ACTIVE"
  ]
};
```

Any transition not explicitly listed is invalid.

---

# 9. Transition Rules

| From              | To                | Trigger                      |
| ----------------- | ----------------- | ---------------------------- |
| DRAFT             | PROPOSED          | Proposal finalized           |
| DRAFT             | WITHDRAWN         | Originator cancels           |
| PROPOSED          | UNDER_REVIEW      | Review requested             |
| PROPOSED          | REJECTED          | Governance rejects           |
| UNDER_REVIEW      | APPROVED          | Governance approves          |
| UNDER_REVIEW      | REJECTED          | Governance rejects           |
| UNDER_REVIEW      | WITHDRAWN         | Originator withdraws         |
| APPROVED          | IMPLEMENTING      | Implementation begins        |
| APPROVED          | REJECTED          | Approval expires or revoked  |
| IMPLEMENTING      | VALIDATING        | Implementation completes     |
| IMPLEMENTING      | FAILED_VALIDATION | Immediate failure            |
| VALIDATING        | ACTIVE            | Validation succeeds          |
| VALIDATING        | FAILED_VALIDATION | Validation fails             |
| FAILED_VALIDATION | ROLLED_BACK       | Rollback completes           |
| FAILED_VALIDATION | ACTIVE            | Explicit governance override |

---

# 10. Transition Invariant

A transition is valid only when:

1. Current state exists
2. Target state exists
3. Transition exists in the allowed transition map
4. Evolution lineage is preserved
5. Transition event is generated

Invalid transitions:

* must not modify state
* must return validation failure
* must provide deterministic errors

---

# 11. Failed Validation Override

The transition:

```text
FAILED_VALIDATION → ACTIVE
```

is allowed only through:

* explicit governance authority
* recorded justification
* validation override evidence

It represents controlled exception handling.

It is not a bypass mechanism.

---

# 12. Transition Event Contract

A0.2 emits transition events.

A0.3 converts these events into evidence compatible with X2/X3b.

```typescript
interface EvolutionTransitionEvent {

  evolutionId: string;

  from: EvolutionState;

  to: EvolutionState;

  eventType: EvolutionEventType;

  timestamp: string;

  summary: string;
}
```

---

# 13. Event Types

```typescript
type EvolutionEventType =
  | "EvolutionDrafted"
  | "EvolutionProposed"
  | "EvolutionSentForReview"
  | "EvolutionApproved"
  | "EvolutionRejected"
  | "EvolutionWithdrawn"
  | "EvolutionImplementationBegan"
  | "EvolutionImplementationCompleted"
  | "EvolutionValidationBegan"
  | "EvolutionValidationCompleted"
  | "EvolutionActivated"
  | "EvolutionFailedValidation"
  | "EvolutionRolledBack";
```

---

# 14. Lifecycle Contract

```typescript
interface EvolutionLifecycle {

  transition(
    evolutionId: string,
    to: EvolutionState
  ): EvolutionTransitionResult;

  getStatus(
    evolutionId: string
  ): EvolutionState;
}
```

---

# 15. Transition Result Contract

```typescript
interface EvolutionTransitionResult {

  success: boolean;

  previousState: EvolutionState;

  currentState: EvolutionState;

  event?: EvolutionTransitionEvent;

  errors: string[];
}
```

A failed transition returns:

* `success: false`
* unchanged state
* validation errors

---

# 16. Purity Boundary

A0.2 is an in-memory lifecycle validator.

It does not:

* persist state
* write audit records
* access stores
* call execution systems
* mutate policies
* modify agents
* modify runtime configuration

---

# 17. Implementation Files

Allowed:

```text
src/evolution/evolution-state-machine.ts

tests/evolution/evolution-state-machine.test.ts
```

Forbidden:

* store imports
* CLI imports
* runtime mutation code
* X2/X3b persistence dependencies

---

# 18. Testing Requirements

## Valid Transitions

Test:

* DRAFT → PROPOSED
* DRAFT → WITHDRAWN
* PROPOSED → UNDER_REVIEW
* UNDER_REVIEW → APPROVED
* APPROVED → IMPLEMENTING
* IMPLEMENTING → VALIDATING
* VALIDATING → ACTIVE

---

## Rejection Paths

Test:

* PROPOSED → REJECTED
* UNDER_REVIEW → REJECTED
* APPROVED → REJECTED

---

## Rollback Paths

Test:

* IMPLEMENTING → FAILED_VALIDATION
* VALIDATING → FAILED_VALIDATION
* FAILED_VALIDATION → ROLLED_BACK

---

## Override Path

Test:

* FAILED_VALIDATION → ACTIVE

Requires:

* explicit approval metadata
* deterministic result

---

## Forbidden Transitions

Test:

* ACTIVE → anything
* REJECTED → anything
* WITHDRAWN → anything
* ROLLED_BACK → anything

---

## Determinism

Given identical:

```text
current state
+
requested transition
```

the result must always be identical.

---

# 19. Deferred Scope

## A0.3 — Evolution Evidence Bridge

Adds:

* transition event conversion
* X2 evidence integration
* X3b persistence routing
* P14 audit linkage

---

## A0.4 — Evolution Governance Surface

Adds:

* CLI visibility
* JSON output
* inspection workflows

---

## A1+

Adds:

* proposal generation
* pattern discovery
* evolution intelligence

---

# 20. Completion Criteria

A0.2 is complete when:

* [ ] Evolution lifecycle state machine implemented
* [ ] Transition map implemented
* [ ] Invalid transitions rejected
* [ ] Transition results deterministic
* [ ] Transition events generated
* [ ] Terminal states enforced
* [ ] Override path protected
* [ ] Full transition matrix tested
* [ ] TypeScript clean
* [ ] No persistence dependencies
* [ ] Checkpoint created:

```text
alix-a0-2-evolution-lifecycle-state-machine-complete
```

---

# 21. Architectural Outcome

After A0.2:

```text
Evolution Intent
        |
        v
Evolution Contract Types
        |
        v
Evolution Lifecycle State Machine
        |
        v
Transition Events
        |
        v
Evidence Bridge
        |
        v
Governed Evolution Runtime
```

A0.2 establishes the rule:

> **Evolution is a controlled lifecycle, not an uncontrolled change event.**

This is ready as the canonical A0.2 design spec and keeps the same architectural discipline as X4.1.

