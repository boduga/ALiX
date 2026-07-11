# A0.3 — Evolution Evidence Bridge Design Specification

**Date:** 2026-07-11
**Status:** Design Specification
**Phase:** A0 — Evolution Contract
**Slice:** A0.3 — Evolution Evidence Bridge

**Depends On:**
- A0.1 — Evolution Contract Types
- A0.2 — Evolution Lifecycle State Machine
- X2 — Execution Evidence Capture
- X3b — Execution Evidence Persistence
- X4.5 — Persistence Evidence Emitter

**Checkpoint Target:** `alix-a0-3-evolution-evidence-bridge-complete`

---

## 1. Purpose

A0.3 bridges evolution lifecycle events into the existing X2/X3b evidence pipeline. It translates `EvolutionTransitionEvent` objects (produced by A0.2) into `ExecutionEvidence` records compatible with the existing evidence architecture.

A0.3 does not introduce a new evidence model. It consumes the existing evidence contract.

---

## 2. Primary Invariant

> Evolution events become evidence through the existing X2/X3b pipeline. No evolution-specific evidence store, persistence format, or audit trail is created.

---

## 3. Architectural Position

```
A0.2 Evolution State Machine
        |
        v
EvolutionTransitionEvent
        |
        v
A0.3 Evolution Evidence Bridge
        |
        v
ExecutionEvidence (X2 contract)
        |
        v
ExecutionEvidenceEmitter (X4.5)
        |
        v
X3b ExecutionEvidenceStore
        |
        v
P14 Governance Audit
```

A0.3 is a translation layer. It does not store, persist, or audit — it converts and forwards.

---

## 4. Responsibilities

### Provides

- `evolutionEventToEvidence()` — pure function converting a transition event to an `ExecutionEvidence` record
- `EvolutionEvidenceBridge` — adapter that routes converted evidence through the existing emitter
- Integration wiring

### Does Not Provide

- New evidence model or storage layer
- Direct persistence logic
- Audit trail entries
- CLI commands
- State machine behavior

---

## 5. Translation Contract

```typescript
function evolutionEventToEvidence(
  event: EvolutionTransitionEvent,
  options?: EvidenceOptions,
): ExecutionEvidence;
```

### Mapping

| ExecutionEvidence field | Source |
|------------------------|--------|
| `evidenceId` | Generated `"elev-"` + random suffix |
| `intentId` | `event.evolutionId` |
| `startedAt` | `event.timestamp` |
| `completedAt` | `event.timestamp` |
| `outcome` | Derived from target state (see below) |
| `summary` | `event.summary` (preserves A0.2's format) |
| `artifacts` | `[]` (no artifacts at event level) |
| `verificationPassed` | `true` for ACTIVE, `false` otherwise |
| `evidenceHash` | `""` (computed by X3b on persistence) |

### Outcome Mapping

| Target EvolutionState | Outcome |
|-----------------------|---------|
| `ACTIVE` | `SUCCESS` |
| `REJECTED` | `FAILED` |
| `WITHDRAWN` | `FAILED` |
| `ROLLED_BACK` | `FAILED` |
| `FAILED_VALIDATION` | `FAILED` |
| All others | `PARTIAL` |

### Evidence Options

```typescript
interface EvidenceOptions {
  /** Override evidenceId for deterministic testing. */
  evidenceId?: string;
}
```

---

## 6. Bridge Interface

```typescript
class EvolutionEvidenceBridge {
  constructor(
    private readonly emitter: ExecutionEvidenceEmitter,
  ): void;

  emitTransitionEvent(event: EvolutionTransitionEvent): void;
}
```

The bridge uses the existing `ExecutionEvidenceEmitter` interface from X4.5. This is the same interface used by `ExecutionStateMachine` — no new emitter contract needed.

---

## 7. Evidence Flow Detail

```
A0.2 State Machine
        |
        | transition(evolutionId, to)
        |
        v
EvolutionTransitionEvent
        |
        | evolutionEventToEvidence()
        |
        v
ExecutionEvidence
        |
        | emitter.emit(eventType, evidence)
        |
        v
PersistenceEvidenceEmitter (X4.5)
        |
        | store.append(evidence)
        |
        v
X3b ExecutionEvidenceStore (JSONL)
        |
        v
P14 Governance Audit (reads via list/getByIntentId)
```

---

## 8. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| `EvolutionStateMachine` | Source of transition events | A0.2 → A0.3 |
| `ExecutionEvidenceEmitter` | Target for converted evidence | A0.3 → X4.5 |
| `ExecutionEvidenceStore` | Persistence layer | X4.5 → X3b |
| `EvolutionTransitionEvent` | Input type | A0.2 |
| `ExecutionEvidence` | Output type | X2 contract |

---

## 9. Non-Goals

A0.3 does **not** include:

- Direct `EvolutionTransitionEvent` → P14 audit mapping (deferred to A0.4)
- CLI commands
- New evidence types or models
- Changes to A0.1/A0.2 types or behavior
- Changes to X3b store or X4.5 emitter
- Bulk evidence operations

---

## 10. Testing Requirements

| # | Test | Verification |
|---|------|-------------|
| 1 | Transition event → evidence field mapping | All fields mapped correctly |
| 2 | Outcome mapping for ACTIVE | outcome = SUCCESS |
| 3 | Outcome mapping for REJECTED | outcome = FAILED |
| 4 | Outcome mapping for PARTIAL states | outcome = PARTIAL |
| 5 | Bridge emits through emitter | Emitter called with correct event |
| 6 | EvidenceId is deterministic with options override | Custom evidenceId respected |
| 7 | summary preserved from event | Evidence summary matches event |
| 8 | Empty artifacts | artifacts = [] |
| 9 | verificationPassed correct for ACTIVE | true |
| 10 | verificationPassed correct for other states | false |
