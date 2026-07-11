X4.1 — Execution State Machine Implementation Plan

Phase: X4 — Governed Execution Runtime
Slice: X4.1 — Execution State Machine
Design Spec: "docs/architecture/specs/2026-07-10-x4-governed-execution-runtime-design.md"

Checkpoint Target:

"alix-x4-1-execution-state-machine-complete"

---

1. Purpose

X4.1 delivers the foundational execution lifecycle controller for the Governed Execution Runtime.

This slice introduces:

- deterministic execution states
- validated state transitions
- execution context tracking
- lifecycle APIs
- evidence emission boundaries

X4.1 does not execute external actions. It establishes the runtime control plane required for future execution capabilities.

---

2. Scope Alignment

The X4 design specification defines the complete governed execution runtime.

This implementation slice delivers only:

Execution Lifecycle Control
+
State Transition Enforcement
+
Evidence Emission Contract

Future X4 slices extend this foundation with retries, cancellation infrastructure, rollback execution, and persistence.

---

3. Implementation Tasks

---

Task 1 — Define Execution Runtime Contracts

Create:

src/runtime/contracts/execution-runtime-contract.ts

---

Required Types

ExecutionState

enum ExecutionState {
  CREATED,
  VALIDATING,
  READY,
  RUNNING,
  SUCCEEDED,
  FAILED,
  CANCELLED,
  ROLLED_BACK
}

---

ExecutionContext

interface ExecutionContext {
  executionId: string

  intentId: string

  state: ExecutionState

  attemptNumber: number

  createdAt: Date

  startedAt?: Date

  completedAt?: Date

  metadata: Record<string, unknown>
}

---

ExecutionResult

interface ExecutionResult {

  executionId: string

  intentId: string

  state: ExecutionState

  evidenceId?: string

}

---

Evidence Event Contract

Define the runtime boundary:

interface ExecutionEvidenceEmitter {

  emit(
    evidence: ExecutionEvidence
  ): void

}

X4.1 emits evidence but does not persist it.

---

ExecutionRuntime Interface

interface ExecutionRuntime {

  execute(
    intent: ExecutionIntent
  ): Promise<ExecutionResult>


  cancel(
    executionId: string
  ): Promise<void>


  rollback(
    executionId: string
  ): Promise<void>


  getStatus(
    executionId: string
  ): ExecutionState

}

---

Task 2 — Implement Execution State Machine

Create:

src/runtime/execution-state-machine.ts

---

Responsibilities

The state machine must:

- create execution contexts
- validate transitions
- reject invalid transitions
- enforce terminal state immutability
- track execution lifecycle
- emit evidence on transitions

---

Allowed Transitions

Implement exactly:

CREATED
  |
  v
VALIDATING
  |
  +----------------+
  |                |
  v                v
READY            FAILED


READY
  |
  +--------------+
  |              |
  v              v
RUNNING      CANCELLED


RUNNING
  |
  +-------------------+
  |                   |
  v                   v
SUCCEEDED           FAILED


FAILED
  |
  v
ROLLED_BACK

---

Forbidden Transitions

Reject:

SUCCEEDED -> *
CANCELLED -> *
ROLLED_BACK -> *

and all undefined transitions.

---

Task 3 — Implement Runtime Lifecycle APIs

---

execute()

Required lifecycle:

CREATED
   |
VALIDATING
   |
READY
   |
RUNNING
   |
SUCCEEDED

Failure path:

RUNNING
   |
FAILED

Requirements:

- generate execution ID
- create execution context
- emit evidence for transitions
- return terminal execution result

---

cancel()

Allowed:

READY -> CANCELLED

RUNNING -> CANCELLED

Requirements:

- validate execution exists
- reject terminal states
- emit cancellation evidence

---

rollback()

Allowed:

FAILED -> ROLLED_BACK

Requirements:

- validate execution exists
- reject non-failed states
- emit rollback transition evidence

---

getStatus()

Returns:

ExecutionState

Requirements:

- unknown execution throws typed error

---

Task 4 — Typed Error Model

Create runtime errors:

IllegalStateTransitionError

UnknownExecutionError

DuplicateExecutionError

Errors must include:

- execution ID
- current state
- requested transition

---

Task 5 — Evidence Emission

Every state transition emits an evidence record.

Required event types:

ExecutionCreated

ExecutionValidationStarted

ExecutionReady

ExecutionStarted

ExecutionCompleted

ExecutionFailed

ExecutionCancelled

ExecutionRollbackCompleted

---

Evidence requirements:

Include:

- executionId
- intentId
- previous state
- new state
- timestamp
- transition metadata

---

Task 6 — Unit Tests

Create:

tests/runtime/execution-state-machine.vitest.ts

---

Required Coverage

Minimum:

State transitions

- valid transition accepted
- invalid transition rejected
- terminal state immutability

Lifecycle

- successful execution lifecycle
- failed execution lifecycle
- cancellation lifecycle
- rollback lifecycle

Errors

- unknown execution
- duplicate execution
- illegal transition

Evidence

- evidence emitted on every transition
- emitted evidence contains correct execution identity

---

Deferred Scope

The following remain intentionally excluded from X4.1.

---

X4.2 — Retry Controller

Adds:

- RetryPolicy
- attempt tracking
- backoff strategy
- retry boundaries

---

X4.3 — Cancellation Infrastructure

Adds:

- external cancellation signaling
- cooperative stopping
- runtime interruption handling

---

X4.4 — Rollback Intent Execution

Adds:

- RollbackIntent contract
- rollback execution lifecycle
- rollback evidence lineage

---

X4.5 — Runtime Persistence Integration

Adds:

- execution state persistence
- restart recovery
- X3b evidence store integration

---

Architecture Invariants

X4.1 must preserve:

Deterministic Lifecycle

Every execution follows explicit state transitions.

---

Terminal Immutability

Terminal states cannot change.

---

Evidence Boundary

Runtime emits evidence.

Persistence consumes evidence.

---

Governance Separation

X4:

- controls execution mechanics
- does not approve execution
- does not evaluate policy
- does not make governance decisions

---

Contract Stability

Must not modify:

- X1 ExecutionIntent contract
- X2 ExecutionEvidence contract
- X3a governance bridge contracts
- X3b persistence contracts

---

File Changes

Action| File
CREATE| "src/runtime/contracts/execution-runtime-contract.ts"
CREATE| "src/runtime/execution-state-machine.ts"
CREATE| "tests/runtime/execution-state-machine.vitest.ts"

---

Completion Criteria

X4.1 is complete when:

- [ ] ExecutionState contract exists
- [ ] All transitions are enforced
- [ ] Terminal states are immutable
- [ ] Runtime lifecycle APIs exist
- [ ] Typed runtime errors exist
- [ ] Evidence emission interface exists
- [ ] Unit tests cover lifecycle matrix
- [ ] "tsc --noEmit" passes
- [ ] Full Vitest suite passes
- [ ] Checkpoint created:

alix-x4-1-execution-state-machine-complete

---

Architectural Outcome

After X4.1:

ExecutionIntent
       |
       v
Execution State Machine
       |
       +--> Lifecycle Control
       |
       +--> Evidence Events
       |
       v
Future X4.x Runtime Capabilities

X4.1 establishes the deterministic execution foundation required for controlled retries, cancellation, rollback, and durable runtime integration.