# A0.2 — Evolution Lifecycle State Machine Design Specification

**Date:** 2026-07-11
**Status:** Design Specification
**Phase:** A0 — Evolution Contract
**Slice:** A0.2 — Evolution Lifecycle State Machine
**Depends On:**
- A0.1 — Evolution Contract Types
- X4.1 — Execution State Machine (pattern reference)

**Checkpoint Target:** `alix-a0-2-evolution-lifecycle-state-machine-complete`

---

## 1. Purpose

A0.2 introduces a deterministic lifecycle state machine for evolution workflows. Mirroring X4's execution state machine, it manages the lifecycle of evolution proposals from draft through activation (or rejection/rollback).

Every state transition emits an evolution evidence record, preserving the lineage chain from intent to activation.

---

## 2. Primary Invariant

> Every evolution follows a deterministic lifecycle with explicit state transitions. No implicit, skipped, or spontaneous transitions.

---

## 3. States

```
DRAFT          — Evolution intent accepted, being shaped
PROPOSED       — Evolution finalized, awaiting governance review
UNDER_REVIEW   — Governance evaluation in progress
APPROVED       — Governance has authorized implementation
REJECTED       — Governance has declined the evolution
WITHDRAWN      — Originator has cancelled the evolution
IMPLEMENTING   — Change is being applied
VALIDATING     — Change outcome is being verified
ACTIVE         — Change is live and in production
FAILED_VALIDATION — Validation did not pass
ROLLED_BACK    — Change was reverted after failed validation
```

---

## 4. Transition Map

### Allowed Transitions

```
DRAFT ──────────→ PROPOSED
DRAFT ──────────→ WITHDRAWN

PROPOSED ───────→ UNDER_REVIEW
PROPOSED ───────→ REJECTED

UNDER_REVIEW ───→ APPROVED
UNDER_REVIEW ───→ REJECTED
UNDER_REVIEW ───→ WITHDRAWN

APPROVED ───────→ IMPLEMENTING
APPROVED ───────→ REJECTED         (approval expires or is revoked)

IMPLEMENTING ───→ VALIDATING
IMPLEMENTING ───→ FAILED_VALIDATION

VALIDATING ─────→ ACTIVE
VALIDATING ─────→ FAILED_VALIDATION

FAILED_VALIDATION → ROLLED_BACK
FAILED_VALIDATION → ACTIVE          (override with explicit approval)
```

### Forbidden Transitions

```
ACTIVE ─────────→ any               (terminal)
REJECTED ───────→ any               (terminal)
WITHDRAWN ──────→ any               (terminal)
ROLLED_BACK ────→ any               (terminal)
```

All transitions not listed in the allowed table are forbidden.

---

## 5. Transition Table

| From | To | Trigger |
|------|----|---------|
| `DRAFT` | `PROPOSED` | Proposal finalized |
| `DRAFT` | `WITHDRAWN` | Originator cancels |
| `PROPOSED` | `UNDER_REVIEW` | Queued for governance review |
| `PROPOSED` | `REJECTED` | Governance rejects before review |
| `UNDER_REVIEW` | `APPROVED` | Governance approves |
| `UNDER_REVIEW` | `REJECTED` | Governance rejects |
| `UNDER_REVIEW` | `WITHDRAWN` | Originator withdraws during review |
| `APPROVED` | `IMPLEMENTING` | Implementation begins |
| `APPROVED` | `REJECTED` | Approval expires or is revoked |
| `IMPLEMENTING` | `VALIDATING` | Implementation completes |
| `IMPLEMENTING` | `FAILED_VALIDATION` | Validation fails immediately |
| `VALIDATING` | `ACTIVE` | Validation passes |
| `VALIDATING` | `FAILED_VALIDATION` | Validation fails |
| `FAILED_VALIDATION` | `ROLLED_BACK` | Rollback executed |
| `FAILED_VALIDATION` | `ACTIVE` | Override (explicit governance approval) |

---

## 6. Terminal States

```
ACTIVE
REJECTED
WITHDRAWN
ROLLED_BACK
```

Terminal states cannot transition further.

---

## 7. Evidence Emission

Every state transition emits an evolution evidence record.

### Event Types

| Event | Description |
|-------|-------------|
| `EvolutionDrafted` | Evolution intent created |
| `EvolutionProposed` | Proposal submitted for governance review |
| `EvolutionSentForReview` | Proposal queued for review |
| `EvolutionApproved` | Governance approved the evolution |
| `EvolutionRejected` | Governance rejected the evolution |
| `EvolutionWithdrawn` | Originator withdrew the evolution |
| `EvolutionImplementationBegan` | Implementation started |
| `EvolutionImplementationCompleted` | Implementation finished |
| `EvolutionValidationBegan` | Validation started |
| `EvolutionValidationCompleted` | Validation finished |
| `EvolutionActivated` | Evolution went live |
| `EvolutionFailedValidation` | Validation did not pass |
| `EvolutionRolledBack` | Change was reverted |

### Evidence Contract

Evidence emitted by the state machine includes:

```typescript
{
  evolutionId: string;
  eventType: EvolutionEventType;
  from: EvolutionState;
  to: EvolutionState;
  timestamp: string;
  summary: string;
}
```

Evidence flows to the X2/X3b evidence pipeline (A0.3).

---

## 8. Contract

```
interface EvolutionLifecycle {
  transition(
    evolutionId: string,
    to: EvolutionState
  ): void;

  getStatus(
    evolutionId: string
  ): EvolutionState;
}
```

---

## 9. Non-Goals

A0.2 does **not** include:

- Persistence (A0.3)
- Evidence bridge to X2/X3b (A0.3)
- CLI surface (A0.4)
- Automatic proposal generation (A1)
- Evolution sandbox (A2)
- Governed adaptation loop (A3)

---

## 10. Implementation Boundaries

### Allowed

- `src/evolution/evolution-state-machine.ts`
- `tests/evolution/evolution-state-machine.test.ts`

### Forbidden

- Changes to A0.1 contract types
- Store access or persistence
- CLI integration
- System mutation (no actual changes to policies/agents/runtime)
