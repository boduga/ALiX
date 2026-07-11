# A0.2 — Evolution Lifecycle State Machine Implementation Plan

**Phase:** A0 — Evolution Contract
**Slice:** A0.2 — Evolution Lifecycle State Machine
**Design Spec:** `docs/architecture/specs/2026-07-11-a0-2-evolution-lifecycle-state-machine-design.md`
**Depends On:** A0.1 — Evolution Contract Types

**Checkpoint Target:** `alix-a0-2-evolution-lifecycle-state-machine-complete`

---

## 1. Purpose

A0.2 delivers a deterministic lifecycle state machine for evolution workflows. Every state transition is validated, terminal states are immutable, and every transition emits an evidence record.

Pattern reference: X4.1 execution state machine (`src/runtime/execution-state-machine.ts`).

---

## 2. Scope

### Implemented

- `EvolutionStateMachine` class
- All 15 allowed transitions from the transition table
- Terminal state immutability (ACTIVE, REJECTED, WITHDRAWN, ROLLED_BACK)
- Evolution tracking by `evolutionId`
- `transition(evolutionId, to)` — validated state transition
- `getStatus(evolutionId)` — current state lookup
- Evidence emission on every transition (via summary/event-type mapping)
- `IllegalEvolutionTransitionError` — typed error for illegal transitions
- `UnknownEvolutionError` — typed error for unknown evolution IDs
- `DuplicateEvolutionError` — typed error for duplicate evolution registration
- Public `transitionTo()` method for testing

### Deferred

| Capability | Reason |
|------------|--------|
| Persistence | A0.3 — Evidence Bridge |
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

## 4. Implementation Tasks

### Task 1 — Error Types

Add to `evolution-state-machine.ts`:

```typescript
class IllegalEvolutionTransitionError extends Error {
  readonly evolutionId: string;
  readonly currentState: EvolutionState;
  readonly requestedState: EvolutionState;
}

class UnknownEvolutionError extends Error {
  readonly evolutionId: string;
}

class DuplicateEvolutionError extends Error {
  readonly evolutionId: string;
}
```

---

### Task 2 — Transition Table

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

---

### Task 3 — Evidence Event Mapping

```typescript
function transitionToEventType(to: EvolutionState): string {
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

---

### Task 4 — EvolutionStateMachine

```typescript
class EvolutionStateMachine {
  private readonly evolutions = new Map<string, EvolutionState>();
  private readonly history = new Map<string, Array<{ from: EvolutionState; to: EvolutionState; timestamp: string }>>();

  createEvolution(evolutionId: string, initialState?: EvolutionState): void;

  transition(evolutionId: string, to: EvolutionState): void;

  getStatus(evolutionId: string): EvolutionState;

  getHistory(evolutionId: string): Array<{ from: EvolutionState; to: EvolutionState; timestamp: string }>;
}
```

---

### Task 5 — Tests

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
| 23 | getHistory returns transition log | History tracking |
| 24 | Bad input type rejected | Safety |

---

## 5. Invariants

- **Terminal immutability**: Terminal states cannot transition further
- **Evidence per transition**: Every transition records evidence
- **Deterministic lookup**: Transitions validated against defined table
- **No persistence**: State machine is in-memory
- **No contract changes**: A0.1 types remain unmodified
