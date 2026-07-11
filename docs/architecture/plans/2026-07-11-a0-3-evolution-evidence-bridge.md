# A0.3 — Evolution Evidence Bridge Implementation Plan

**Phase:** A0 — Evolution Contract
**Slice:** A0.3 — Evolution Evidence Bridge
**Design Spec:** `docs/architecture/specs/2026-07-11-a0-3-evolution-evidence-bridge-design.md`

**Depends On:**
- A0.1 — Evolution Contract Types
- A0.2 — Evolution Lifecycle State Machine
- X3b — Execution Evidence Store
- X4.5 — `ExecutionEvidenceEmitter` + `PersistenceEvidenceEmitter`

**Checkpoint Target:** `alix-a0-3-evolution-evidence-bridge-complete`

---

## 1. Purpose

A0.3 bridges evolution lifecycle events into the existing X2/X3b evidence pipeline. It translates `EvolutionTransitionEvent` into `ExecutionEvidence` and routes it through the established emitter interface.

A0.3 is a translation layer — it does not store, persist, or audit.

---

## 2. Scope

### Implemented

- `evolutionEventToEvidence()` — pure translation from transition event to evidence
- `EvolutionEvidenceBridge` — adapter wrapping `ExecutionEvidenceEmitter`
- `emitTransitionEvent()` — converts and forwards
- Outcome mapping for all 11 evolution states
- Deterministic evidenceId override for testing
- Integration with existing evidence infrastructure (no new contracts)

### Deferred

| Capability | Reason |
|------------|--------|
| P14 governance audit integration | A0.4 — Governance Surface |
| CLI `alix evolution evidence` | A0.4 — Governance Surface |
| Bulk evidence export | Not yet required |

---

## 3. File Changes

| Action | File |
|--------|------|
| CREATE | `src/evolution/evolution-evidence-bridge.ts` |
| CREATE | `tests/evolution/evolution-evidence-bridge.test.ts` |

---

## 4. Implementation Tasks

### Task 1 — Translation Function

```typescript
export function evolutionEventToEvidence(
  event: EvolutionTransitionEvent,
  options?: { evidenceId?: string },
): ExecutionEvidence {
  return {
    evidenceId: options?.evidenceId ?? `elev-${randomUUID().slice(0, 8)}`,
    intentId: event.evolutionId,
    startedAt: event.timestamp,
    completedAt: event.timestamp,
    outcome: evolutionStateToOutcome(event.to),
    summary: event.summary,
    artifacts: [],
    verificationPassed: event.to === EvolutionState.ACTIVE,
    evidenceHash: "",
  };
}
```

### Task 2 — Outcome Mapping

```typescript
function evolutionStateToOutcome(state: EvolutionState): "SUCCESS" | "FAILED" | "PARTIAL" {
  switch (state) {
    case EvolutionState.ACTIVE:
      return "SUCCESS";
    case EvolutionState.REJECTED:
    case EvolutionState.WITHDRAWN:
    case EvolutionState.ROLLED_BACK:
    case EvolutionState.FAILED_VALIDATION:
      return "FAILED";
    default:
      return "PARTIAL";
  }
}
```

### Task 3 — Bridge Class

```typescript
export class EvolutionEvidenceBridge {
  constructor(private readonly emitter: ExecutionEvidenceEmitter) {}

  emitTransitionEvent(event: EvolutionTransitionEvent): void {
    const evidence = evolutionEventToEvidence(event);
    this.emitter.emit("EvolutionTransition", evidence);
  }
}
```

### Task 4 — Tests

| # | Test | Verification |
|---|------|-------------|
| 1 | ACTIVE → SUCCESS | outcome = SUCCESS |
| 2 | REJECTED → FAILED | outcome = FAILED |
| 3 | DRAFT → PARTIAL | outcome = PARTIAL |
| 4 | PROPOSED → PARTIAL | outcome = PARTIAL |
| 5 | verificationPassed true for ACTIVE | true |
| 6 | verificationPassed false for REJECTED | false |
| 7 | evidenceId uses provided override | Custom ID respected |
| 8 | evidenceId generated when not provided | Non-empty, correct prefix |
| 9 | intentId matches evolutionId | evolutionId in evidence |
| 10 | summary preserved from event | Matches event.summary |
| 11 | artifacts is empty array | [] |
| 12 | Bridge emits via emitter | Emitter called once |
| 13 | Bridge emitter event has correct evidenceId | Matches generated ID |
