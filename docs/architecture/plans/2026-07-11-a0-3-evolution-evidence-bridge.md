# A0.3 — Evolution Evidence Bridge Implementation Plan

**Phase:** A0 — Evolution Contract
**Slice:** A0.3 — Evolution Evidence Bridge
**Design Spec:** `docs/architecture/specs/2026-07-11-a0-3-evolution-evidence-bridge-design.md`

**Depends On:**

* A0.1 — Evolution Contract Types
* A0.2 — Evolution Lifecycle State Machine
* X2 — Execution Evidence Capture
* X3b — Execution Evidence Persistence
* X4.5 — `ExecutionEvidenceEmitter`

**Checkpoint Target:** `alix-a0-3-evolution-evidence-bridge-complete`

---

# 1. Purpose

A0.3 integrates Evolution lifecycle transitions into the existing execution evidence pipeline.

It translates `EvolutionTransitionEvent` objects produced by A0.2 into standard `ExecutionEvidence` records defined by X2 and forwards them through the existing `ExecutionEvidenceEmitter`.

A0.3 is intentionally a thin translation layer. It performs no persistence, auditing, governance, or lifecycle management.

---

# 2. Scope

## Implemented

* `evolutionEventToEvidence()` pure translation function
* `evolutionStateToOutcome()` helper
* `EvolutionEvidenceBridge`
* emission through existing `ExecutionEvidenceEmitter`
* preservation of transition metadata
* deterministic `evidenceId` override for testing
* comprehensive unit tests

## Deferred

| Capability                       | Deferred To               |
| -------------------------------- | ------------------------- |
| Governance audit integration     | A0.4 — Governance Surface |
| Evolution CLI commands           | A0.4                      |
| Bulk evidence translation        | Future                    |
| Additional governance enrichment | Future governance slices  |

---

# 3. File Changes

| Action | File                                                |
| ------ | --------------------------------------------------- |
| CREATE | `src/evolution/evolution-evidence-bridge.ts`        |
| CREATE | `tests/evolution/evolution-evidence-bridge.test.ts` |

No existing X2, X3b, or X4 contracts are modified.

---

# 4. Implementation Tasks

## Task 1 — Implement Outcome Mapping

Implement a private helper:

```typescript
function evolutionStateToOutcome(
    state: EvolutionState,
): ExecutionOutcome
```

Mapping:

| Evolution State      | Execution Outcome |
| -------------------- | ----------------- |
| ACTIVE               | SUCCESS           |
| REJECTED             | FAILED            |
| WITHDRAWN            | FAILED            |
| ROLLED_BACK          | FAILED            |
| FAILED_VALIDATION    | FAILED            |
| All remaining states | PARTIAL           |

Unknown future states shall safely default to `PARTIAL` to preserve forward compatibility.

---

## Task 2 — Implement Translation Function

Implement:

```typescript
export function evolutionEventToEvidence(
    event: EvolutionTransitionEvent,
    options?: {
        evidenceId?: string;
    },
): ExecutionEvidence
```

The translator shall:

* be a pure function
* never mutate the supplied event
* always return a newly constructed `ExecutionEvidence`
* preserve the original summary
* preserve transition metadata
* initialize `evidenceHash` to an empty string
* leave evidence hashing to X3b persistence

Field mapping:

| ExecutionEvidence Field | Source                                      |
| ----------------------- | ------------------------------------------- |
| `evidenceId`            | override or generated `evoe-*` identifier   |
| `intentId`              | `event.evolutionId`                         |
| `startedAt`             | `event.timestamp`                           |
| `completedAt`           | `event.timestamp`                           |
| `summary`               | `event.summary`                             |
| `outcome`               | `evolutionStateToOutcome(event.to)`         |
| `artifacts`             | `[]`                                        |
| `verificationPassed`    | `true` only for `ACTIVE`; otherwise `false` |
| `evidenceHash`          | `""`                                        |
| `metadata`              | transition metadata                         |

Transition metadata shall include:

* source state
* destination state
* transition type

---

## Task 3 — Implement EvolutionEvidenceBridge

Implement:

```typescript
export class EvolutionEvidenceBridge
```

Responsibilities:

1. Receive an `EvolutionTransitionEvent`.
2. Convert the event into `ExecutionEvidence`.
3. Emit the translated evidence using the existing `ExecutionEvidenceEmitter`.

The bridge shall perform no persistence or governance logic.

---

## Task 4 — Integrate with Existing Evidence Pipeline

Wire the bridge into the A0.2 lifecycle state machine so that every successful transition produces standard execution evidence.

Reuse the existing X4.5 emitter without modification.

Do not modify:

* `ExecutionEvidence`
* `ExecutionEvidenceEmitter`
* `PersistenceEvidenceEmitter`
* `ExecutionEvidenceStore`

---

## Task 5 — Unit Tests

Implement comprehensive unit tests covering translation, mapping, and bridge behavior.

| #  | Test                                       | Expected Result               |
| -- | ------------------------------------------ | ----------------------------- |
| 1  | ACTIVE → SUCCESS                           | SUCCESS                       |
| 2  | REJECTED → FAILED                          | FAILED                        |
| 3  | WITHDRAWN → FAILED                         | FAILED                        |
| 4  | ROLLED_BACK → FAILED                       | FAILED                        |
| 5  | FAILED_VALIDATION → FAILED                 | FAILED                        |
| 6  | DRAFT → PARTIAL                            | PARTIAL                       |
| 7  | PENDING_APPROVAL → PARTIAL                 | PARTIAL                       |
| 8  | Unknown future state → PARTIAL             | PARTIAL                       |
| 9  | verificationPassed for ACTIVE              | true                          |
| 10 | verificationPassed for FAILED_VALIDATION   | false                         |
| 11 | verificationPassed for non-terminal states | false                         |
| 12 | evidenceId override respected              | provided value used           |
| 13 | generated evidenceId                       | generated with `evoe-` prefix |
| 14 | intentId mapping                           | matches `evolutionId`         |
| 15 | timestamp mapping                          | preserved                     |
| 16 | summary mapping                            | preserved exactly             |
| 17 | artifacts initialized                      | empty array                   |
| 18 | evidenceHash initialized                   | empty string                  |
| 19 | transition metadata preserved              | metadata populated            |
| 20 | translator purity                          | input event unchanged         |
| 21 | bridge emits translated evidence           | emitter invoked once          |
| 22 | emitted evidence matches translator output | payload identical             |

---

# 5. Acceptance Criteria

Implementation is complete when:

* `evolutionEventToEvidence()` is fully implemented.
* Outcome mapping matches the approved design specification.
* Transition metadata is preserved.
* No new evidence contracts are introduced.
* No persistence logic exists within the bridge.
* Existing X2, X3b, and X4 components remain unchanged.
* All unit tests pass.
* The checkpoint tag `alix-a0-3-evolution-evidence-bridge-complete` can be created.

---

# 6. Non-Goals

This implementation does **not** include:

* governance reporting
* audit generation
* CLI commands
* bulk translation APIs
* lifecycle state management
* evidence persistence
* evidence hash computation
* modifications to X2, X3b, or X4 contracts

These capabilities remain the responsibility of later governance slices.

---

# 7. Completion Checklist

* [ ] Implement `evolutionStateToOutcome()`.
* [ ] Implement `evolutionEventToEvidence()`.
* [ ] Preserve transition metadata.
* [ ] Support deterministic `evidenceId` overrides.
* [ ] Implement `EvolutionEvidenceBridge`.
* [ ] Wire bridge into the A0.2 lifecycle state machine.
* [ ] Verify no persistence occurs within the bridge.
* [ ] Add comprehensive unit tests.
* [ ] Confirm all tests pass.
* [ ] Create checkpoint `alix-a0-3-evolution-evidence-bridge-complete`.

---

## Deliverables

Upon completion, A0.3 will provide:

* A pure, deterministic translation layer from `EvolutionTransitionEvent` to `ExecutionEvidence`.
* Seamless integration with the existing X2/X3b evidence pipeline.
* Reuse of the existing `ExecutionEvidenceEmitter` without introducing new contracts.
* A forward-compatible implementation that preserves the architecture's single evidence model and single persistence pipeline.

