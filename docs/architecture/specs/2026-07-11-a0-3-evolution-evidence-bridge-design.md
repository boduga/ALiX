# A0.3 — Evolution Evidence Bridge Design Specification

**Date:** 2026-07-11
**Status:** Final Design Specification
**Phase:** A0 — Evolution Contract
**Slice:** A0.3 — Evolution Evidence Bridge

**Depends On:**

* A0.1 — Evolution Contract Types
* A0.2 — Evolution Lifecycle State Machine
* X2 — Execution Evidence Capture
* X3b — Execution Evidence Persistence
* X4.5 — Persistence Evidence Emitter

**Checkpoint Target:** `alix-a0-3-evolution-evidence-bridge-complete`

---

# 1. Purpose

A0.3 bridges evolution lifecycle events into the existing X2/X3b evidence pipeline.

It translates `EvolutionTransitionEvent` objects produced by A0.2 into standard `ExecutionEvidence` records defined by X2 and forwards them through the existing evidence emitter.

A0.3 introduces no new evidence model, persistence format, audit trail, or storage mechanism.

---

# 2. Primary Invariant

> Every evolution lifecycle transition becomes standard `ExecutionEvidence` using the existing X2/X3b evidence pipeline. No evolution-specific evidence store, persistence format, or audit model is introduced.

---

# 3. Architectural Position

```
A0.2 Evolution State Machine
        │
        ▼
EvolutionTransitionEvent
        │
        ▼
A0.3 Evolution Evidence Bridge
        │
        ▼
ExecutionEvidence (X2)
        │
        ▼
ExecutionEvidenceEmitter (X4.5)
        │
        ▼
PersistenceEvidenceEmitter
        │
        ▼
X3b ExecutionEvidenceStore
        │
        ▼
P14 Governance Audit
```

A0.3 is a pure translation layer.

It performs no persistence, auditing, governance logic, or state mutation.

---

# 4. Responsibilities

## Provides

* `evolutionEventToEvidence()` pure translation function
* `EvolutionEvidenceBridge`
* integration wiring between A0.2 and X4.5

## Does Not Provide

* evidence persistence
* audit trail generation
* governance logic
* CLI commands
* lifecycle state management
* new evidence contracts
* bulk processing

---

# 5. Translation Contract

```typescript
function evolutionEventToEvidence(
  event: EvolutionTransitionEvent,
  options?: EvidenceOptions,
): ExecutionEvidence;
```

The translator is pure.

It shall:

* never mutate the supplied event
* always return a newly constructed `ExecutionEvidence`
* produce identical output for identical inputs (except generated IDs)

---

# 6. Translation Mapping

| ExecutionEvidence    | Source                             |
| -------------------- | ---------------------------------- |
| `evidenceId`         | generated `"evoe-" + randomSuffix` |
| `intentId`           | `event.evolutionId`                |
| `startedAt`          | `event.timestamp`                  |
| `completedAt`        | `event.timestamp`                  |
| `summary`            | `event.summary`                    |
| `outcome`            | derived from target state          |
| `artifacts`          | `[]`                               |
| `verificationPassed` | see Verification Mapping           |
| `evidenceHash`       | `""` (computed by X3b persistence) |
| `metadata`           | evolution transition metadata      |

---

# 7. Outcome Mapping

| Target EvolutionState | ExecutionOutcome |
| --------------------- | ---------------- |
| `ACTIVE`              | `SUCCESS`        |
| `REJECTED`            | `FAILED`         |
| `WITHDRAWN`           | `FAILED`         |
| `ROLLED_BACK`         | `FAILED`         |
| `FAILED_VALIDATION`   | `FAILED`         |
| all remaining states  | `PARTIAL`        |

This mapping intentionally reflects lifecycle completion rather than validation status.

---

# 8. Verification Mapping

`verificationPassed` represents successful validation—not lifecycle completion.

| Target State        | verificationPassed |
| ------------------- | ------------------ |
| `ACTIVE`            | `true`             |
| `FAILED_VALIDATION` | `false`            |
| all other states    | `false`            |

States such as `DRAFT`, `PENDING_APPROVAL`, or `ROLLED_BACK` are not considered successful validation events.

---

# 9. Metadata Preservation

The bridge shall preserve transition metadata inside the generated evidence.

Example:

```typescript
metadata: {
    evolutionStateFrom: event.from,
    evolutionStateTo: event.to,
    transitionType: event.transition,
}
```

This metadata is informational only.

It does not modify the X2 evidence contract and exists solely to improve downstream governance reporting and lineage analysis.

---

# 10. Evidence Options

```typescript
interface EvidenceOptions {

    /**
     * Overrides generated evidenceId.
     * Used for deterministic testing.
     */
    evidenceId?: string;

}
```

---

# 11. Bridge Interface

```typescript
class EvolutionEvidenceBridge {

    constructor(
        private readonly emitter: ExecutionEvidenceEmitter,
    );

    emitTransitionEvent(
        event: EvolutionTransitionEvent,
    ): void;

}
```

The bridge shall:

1. translate the transition event
2. emit the resulting `ExecutionEvidence`
3. perform no persistence itself

---

# 12. Emission Contract

The bridge forwards evidence using the existing X4.5 `ExecutionEvidenceEmitter`.

No new emitter interface is introduced.

The bridge emits the standard execution evidence event already defined by X4.5.

A0.3 does not define new emitter event types.

---

# 13. Evidence Flow

```
EvolutionStateMachine
        │
        │ transition(...)
        ▼
EvolutionTransitionEvent
        │
        │ evolutionEventToEvidence()
        ▼
ExecutionEvidence
        │
        │ emitter.emit(...)
        ▼
PersistenceEvidenceEmitter
        │
        ▼
ExecutionEvidenceStore
        │
        ▼
Governance Audit
```

---

# 14. Hash Responsibility

The bridge never computes `evidenceHash`.

It shall always initialize:

```text
evidenceHash = ""
```

Hash computation remains the exclusive responsibility of X3b persistence.

This guarantees a single authoritative hash implementation across the system.

---

# 15. Integration Points

| Component                  | Integration                 | Direction   |
| -------------------------- | --------------------------- | ----------- |
| `EvolutionStateMachine`    | source of transition events | A0.2 → A0.3 |
| `EvolutionTransitionEvent` | translator input            | A0.2        |
| `ExecutionEvidence`        | translator output           | X2          |
| `ExecutionEvidenceEmitter` | emission target             | A0.3 → X4.5 |
| `ExecutionEvidenceStore`   | persistence                 | X4.5 → X3b  |
| `P14 Governance`           | evidence consumer           | X3b → P14   |

---

# 16. Non-Goals

A0.3 explicitly excludes:

* new evidence models
* evolution-specific persistence
* audit generation
* governance reporting
* CLI commands
* lifecycle management
* state validation
* bulk translation APIs
* modifications to X2 contracts
* modifications to X3b persistence
* modifications to X4.5 emitters

Future governance enrichment is deferred to A0.4.

---

# 17. Testing Requirements

| #  | Test                                        | Verification                |
| -- | ------------------------------------------- | --------------------------- |
| 1  | Transition event maps to evidence correctly | all fields populated        |
| 2  | ACTIVE maps to SUCCESS                      | outcome correct             |
| 3  | REJECTED maps to FAILED                     | outcome correct             |
| 4  | Non-terminal states map to PARTIAL          | outcome correct             |
| 5  | ACTIVE sets verificationPassed              | true                        |
| 6  | FAILED_VALIDATION sets verificationPassed   | false                       |
| 7  | Other states set verificationPassed false   | correct                     |
| 8  | Summary preserved                           | exact match                 |
| 9  | Empty artifacts                             | `[]`                        |
| 10 | Deterministic evidenceId override           | respected                   |
| 11 | Bridge emits through existing emitter       | emitter invoked correctly   |
| 12 | Translator does not mutate source event     | input unchanged             |
| 13 | Unknown future states default to PARTIAL    | forward compatibility       |
| 14 | Metadata preserved                          | transition metadata present |
| 15 | evidenceHash initialized empty              | X3b computes later          |

---

# 18. Architectural Guarantees

A0.3 guarantees:

* Evolution events become first-class execution evidence.
* Existing X2/X3b infrastructure is reused without modification.
* Evidence persistence remains centralized.
* Governance consumes a single evidence model.
* The bridge is deterministic, side-effect free (except emission), and forward compatible with future lifecycle states.

---

## Final Architecture Summary

```
                 A0.2
      Evolution State Machine
               │
               ▼
    EvolutionTransitionEvent
               │
               ▼
   A0.3 Evolution Evidence Bridge
               │
               ▼
        ExecutionEvidence (X2)
               │
               ▼
     ExecutionEvidenceEmitter (X4.5)
               │
               ▼
     PersistenceEvidenceEmitter
               │
               ▼
     X3b ExecutionEvidenceStore
               │
               ▼
        P14 Governance Audit
```

**Final Status:** **Approved for Implementation**

A0.3 is a minimal, pure translation layer that cleanly integrates the Evolution lifecycle into the existing execution evidence architecture. It introduces no parallel governance infrastructure, preserves clear separation of responsibilities, and maintains a single evidence pipeline for execution and evolution events.

