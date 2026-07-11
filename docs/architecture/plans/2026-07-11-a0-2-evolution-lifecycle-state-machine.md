# A0.2 — Evolution Lifecycle State Machine Implementation Plan

**Phase:** A0 — Evolution Contract
**Slice:** A0.2 — Evolution Lifecycle State Machine
**Design Spec:** `docs/architecture/specs/2026-07-11-a0-2-evolution-lifecycle-state-machine-design.md`
**Depends On:** A0.1 — Evolution Contract Types

**Checkpoint Target:** `alix-a0-2-evolution-lifecycle-state-machine-complete`

---

## 1. Purpose

A0.2 delivers a deterministic lifecycle state machine for evolution workflows. Every state transition is validated, terminal states are immutable, and every transition generates a typed transition event.

A0.2 owns lifecycle behavior. It does not persist evidence — transition events are consumed by A0.3 to produce X2/X3b-compatible evidence records.

Pattern reference: X4.1 execution state machine (`src/runtime/execution-state-machine.ts`).

---

## 2. Scope

### Implemented

- `EvolutionStateMachine` class
- All 15 allowed transitions from the transition table
- Terminal state immutability (ACTIVE, REJECTED, WITHDRAWN, ROLLED_BACK)
- Evolution tracking by `evolutionId`
- `transition(evolutionId, to)` — validated state transition, returns `EvolutionTransitionResult`
- `getStatus(evolutionId)` — current state lookup
- `getHistory(evolutionId)` — transition history as `EvolutionTransitionEvent[]`
- Transition event generation on every successful transition
- `createTransitionEvent()` — maps (from, to) to typed event
- `validateTransition()` — pure helper for transition legality
- `IllegalEvolutionTransitionError` — typed error for illegal transitions
- `UnknownEvolutionError` — typed error for unknown evolution IDs
- `DuplicateEvolutionError` — typed error for duplicate evolution registration

### Deferred

| Capability | Reason |
|------------|--------|
| Evidence persistence | A0.3 — Evidence Bridge |
| X2/X3b evidence pipeline | A0.3 — Evidence Bridge |
| CLI surface | A0.4 — Governance Surface |
| Automatic proposal generation | A1 |

---

## 3. File Changes

| Action | File |
|--------|------|
| CREATE | `src/evolution/evolution-state-machine.ts` |
| CREATE | `tests/evolution/evolution-state-machine.test.ts` |

---

## 4. Ownership Boundary

```
A0.1  Contracts                    owns types
  ↓
A0.2  Lifecycle + Events           owns state machine + transition events
  ↓
A0.3  Evidence Bridge              owns translating events → evidence
  ↓
X2/X3b  Pipeline                   owns capturing + persisting evidence
  ↓
P14  Audit                         owns governance audit trail
```

A0.2 does **not**:
- Persist evidence
- Store audit records
- Execute governance workflows
- Mutate runtime
- Generate evolution proposals

---

## 5. Implementation Tasks

### Task 1 — EvolutionTransitionEvent Type

```typescript
interface EvolutionTransitionEvent {
  evolutionId: string;
  from: EvolutionState;
  to: EvolutionState;
  eventType: string;
  timestamp: string;
  summary: string;
}
```

### Task 2 — Error Types

```typescript
class IllegalEvolutionTransitionError extends Error {
  readonly kind = "IllegalEvolutionTransitionError";
  readonly evolutionId: string;
  readonly currentState: EvolutionState;
  readonly requestedState: EvolutionState;
}

class UnknownEvolutionError extends Error {
  readonly kind = "UnknownEvolutionError";
  readonly evolutionId: string;
}

class DuplicateEvolutionError extends Error {
  readonly kind = "DuplicateEvolutionError";
  readonly evolutionId: string;
}
```

### Task 3 — Transition Table

```typescript
const ALLOWED_TRANSITIONS: Record<EvolutionState, EvolutionState[]> = {
  [EvolutionState.DRAFT]: [EvolutionState.PROPOSED, EvolutionState.WITHDRAWN],
  [EvolutionState.PROPOSED]: [EvolutionState.UNDER_REVIEW, EvolutionState.REJECTED],
  [EvolutionState.UNDER_REVIEW]: [EvolutionState.APPROVED, EvolutionState.REJECTED, EvolutionState.WITHDRAWN],
  [EvolutionState.APPROVED]: [EvolutionState.IMPLEMENTING, EvolutionState.REJECTED],
  [EvolutionState.REJECTED]: [],
  [EvolutionState.WITHDRAWN]: [],
  [EvolutionState.IMPLEMENTING]: [EvolutionState.VALIDATING, EvolutionState.FAILED_VALIDATION],
  [EvolutionState.VALIDATING]: [EvolutionState.ACTIVE, EvolutionState.FAILED_VALIDATION],
  [EvolutionState.ACTIVE]: [],
  [EvolutionState.FAILED_VALIDATION]: [EvolutionState.ROLLED_BACK, EvolutionState.ACTIVE],
  [EvolutionState.ROLLED_BACK]: [],
};
```

Terminal states: `ACTIVE`, `REJECTED`, `WITHDRAWN`, `ROLLED_BACK`

### Task 4 — Transition Event Mapping

```typescript
function createTransitionEvent(to: EvolutionState): string {
  switch (to) {
    case EvolutionState.DRAFT: return "EvolutionDrafted";
    case EvolutionState.PROPOSED: return "EvolutionProposed";
    case EvolutionState.UNDER_REVIEW: return "EvolutionSentForReview";
    case EvolutionState.APPROVED: return "EvolutionApproved";
    case EvolutionState.REJECTED: return "EvolutionRejected";
    case EvolutionState.WITHDRAWN: return "EvolutionWithdrawn";
    case EvolutionState.IMPLEMENTING: return "EvolutionImplementationBegan";
    case EvolutionState.VALIDATING: return "EvolutionValidationBegan";
    case EvolutionState.ACTIVE: return "EvolutionActivated";
    case EvolutionState.FAILED_VALIDATION: return "EvolutionFailedValidation";
    case EvolutionState.ROLLED_BACK: return "EvolutionRolledBack";
  }
}
```

### Task 5 — EvolutionStateMachine

```typescript
class EvolutionStateMachine {
  private readonly evolutions = new Map<string, EvolutionState>();
  private readonly history = new Map<string, EvolutionTransitionEvent[]>();

  createEvolution(evolutionId: string, initialState?: EvolutionState): void;

  transition(evolutionId: string, to: EvolutionState): EvolutionTransitionResult;

  getStatus(evolutionId: string): EvolutionState;

  getHistory(evolutionId: string): EvolutionTransitionEvent[];
}

interface EvolutionTransitionResult {
  previous: EvolutionState;
  current: EvolutionState;
  event: EvolutionTransitionEvent;
}
```

### Task 6 — Validation Helpers

```typescript
private isTransitionAllowed(from: EvolutionState, to: EvolutionState): boolean;

private validateTransition(evolutionId: string, to: EvolutionState): void;
```

### Task 7 — Tests

| # | Test | Verification |
|---|------|-------------|
| 1 | DRAFT → PROPOSED accepted | Valid transition |
| 2 | DRAFT → WITHDRAWN accepted | Valid transition |
| 3 | DRAFT → UNDER_REVIEW rejected | Invalid transition |
| 4 | PROPOSED → UNDER_REVIEW accepted | Valid transition |
| 5 | PROPOSED → REJECTED accepted | Valid transition |
| 6 | UNDER_REVIEW → APPROVED accepted | Valid transition |
| 7 | UNDER_REVIEW → REJECTED accepted | Valid transition |
| 8 | UNDER_REVIEW → WITHDRAWN accepted | Valid transition |
| 9 | APPROVED → IMPLEMENTING accepted | Valid transition |
| 10 | APPROVED → REJECTED accepted | Approval revocation |
| 11 | IMPLEMENTING → VALIDATING accepted | Valid transition |
| 12 | VALIDATING → ACTIVE accepted | Valid transition |
| 13 | VALIDATING → FAILED_VALIDATION accepted | Failed validation |
| 14 | FAILED_VALIDATION → ROLLED_BACK accepted | Rollback |
| 15 | FAILED_VALIDATION → ACTIVE accepted | Override |
| 16 | ACTIVE → any rejected | Terminal immutability |
| 17 | REJECTED → any rejected | Terminal immutability |
| 18 | WITHDRAWN → any rejected | Terminal immutability |
| 19 | ROLLED_BACK → any rejected | Terminal immutability |
| 20 | Unknown evolutionId throws | Error path |
| 21 | Duplicate creation throws | Error path |
| 22 | getStatus returns correct state | State tracking |
| 23 | getHistory returns ordered transition log | History ordering |
| 24 | Failed transition does not change state | Append-only invariant |
| 25 | Failed transition does not append to history | History immutability |
| 26 | Transition result contains correct event | Event correctness |
| 27 | Repeated identical transition attempt | Stability |
| 28 | Multiple distinct evolutions coexist | Isolation |

---

## 6. Invariants

- **Terminal immutability**: Terminal states cannot transition further
- **Event per transition**: Every successful transition generates a `EvolutionTransitionEvent`
- **No side effects on failure**: Failed transitions do not change state or append to history
- **Deterministic lookup**: Transitions validated against defined table
- **No persistence**: State machine is in-memory
- **No contract changes**: A0.1 types remain unmodified
