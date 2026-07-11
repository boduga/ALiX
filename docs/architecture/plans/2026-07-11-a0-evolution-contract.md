# A0.1 — Evolution Contract Types Implementation Plan

**Phase:** A0 — Evolution Contract
**Slice:** A0.1 — Evolution Contract Types
**Design Spec:** `docs/architecture/specs/2026-07-11-a0-evolution-contract-design.md`

**Checkpoint Target:** `alix-a0-1-evolution-contract-types-complete`

---

## 1. Purpose

A0.1 delivers the foundational type definitions for ALiX evolution. These are pure contracts — no state machine, no stores, no CLI, no mutation logic. Every downstream A-series phase depends on these types.

This slice introduces:

- `EvolutionIntent` — what triggers evolution and why
- `EvolutionProposal` — what changes and how
- `EvolutionReview` — governance evaluation artifact
- `EvolutionApproval` — authorization record
- `EvolutionImplementation` — change evidence
- `EvolutionValidation` — outcome verification
- `EvolutionActivation` — live-state record
- `EvolutionState` — lifecycle state machine enum
- `EvolutionTarget` — what component is targeted
- `EvolutionConstraint` — change boundaries
- `EvidenceReference` — link to evidence
- `EvolutionEventType` — for evidence emission
- Validation rules for all types
- Deterministic sort rules for lists

---

## 2. Scope Alignment

The A0 design specification defines the complete evolution contract architecture.

This implementation slice delivers only:

```
Evolution Contract Types
     +
Type Validation
     +
Zero Store Dependencies
```

Future A0 slices extend this foundation with state machine, evidence bridge, and CLI.

---

## 3. Implementation Tasks

### Task 1 — Define Evolution Contract Types

Create:

```
src/evolution/contracts/evolution-contract.ts
```

#### Required Types

**EvolutionState**

```typescript
enum EvolutionState {
  DRAFT,
  PROPOSED,
  UNDER_REVIEW,
  APPROVED,
  REJECTED,
  WITHDRAWN,
  IMPLEMENTING,
  VALIDATING,
  ACTIVE,
  FAILED_VALIDATION,
  ROLLED_BACK,
}
```

Terminal states: `ACTIVE`, `REJECTED`, `WITHDRAWN`, `ROLLED_BACK`

**EvolutionOrigin**

```typescript
type EvolutionOrigin =
  | "operator"
  | "governance_signal"
  | "learning_outcome"
  | "system_observation";
```

**EvolutionTargetKind**

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

**EvolutionTarget**

```typescript
interface EvolutionTarget {
  kind: EvolutionTargetKind;
  id: string;
  currentHash?: string;
}
```

**EvidenceReference**

```typescript
interface EvidenceReference {
  evidenceId: string;
  source: string;
  description?: string;
}
```

**EvolutionConstraint**

```typescript
interface EvolutionConstraint {
  type: string;
  value: unknown;
  reason: string;
}
```

**EvolutionIntent**

```typescript
interface EvolutionIntent {
  evolutionId: string;
  origin: EvolutionOrigin;
  target: EvolutionTarget;
  rationale: EvidenceReference[];
  expectedEffect: string;
  riskClass: "low" | "medium" | "high";
  constraints: EvolutionConstraint[];
  createdAt: string;
}
```

**EvolutionProposal**

```typescript
interface EvolutionProposal {
  proposalId: string;
  evolutionId: string;
  title: string;
  description: string;
  change: string;
  beforeHash: string | null;
  afterHash: string | null;
  createdAt: string;
}
```

**EvolutionReview**

```typescript
interface EvolutionReview {
  reviewId: string;
  evolutionId: string;
  reviewer: string;
  decision: "approve" | "reject" | "amend";
  rationale: string;
  createdAt: string;
}
```

**EvolutionApproval**

```typescript
interface EvolutionApproval {
  approvalId: string;
  evolutionId: string;
  approvedBy: string;
  approvedAt: string;
  authority: string;
}
```

**EvolutionImplementation**

```typescript
interface EvolutionImplementation {
  implementationId: string;
  evolutionId: string;
  changeEvidence: string;
  diff: string | null;
  beforeHash: string;
  afterHash: string;
  executedAt: string;
}
```

**EvolutionValidation**

```typescript
interface EvolutionValidation {
  validationId: string;
  evolutionId: string;
  result: "passed" | "failed" | "partial";
  metrics: Record<string, number>;
  evidenceIds: string[];
  completedAt: string;
}
```

**EvolutionActivation**

```typescript
interface EvolutionActivation {
  activationId: string;
  evolutionId: string;
  activatedAt: string;
  scope: string;
  isActive: boolean;
}
```

**EvolutionEventType**

```typescript
type EvolutionEventType =
  | "EvolutionIntentCreated"
  | "EvolutionProposed"
  | "EvolutionReviewed"
  | "EvolutionApproved"
  | "EvolutionRejected"
  | "EvolutionWithdrawn"
  | "EvolutionImplementationStarted"
  | "EvolutionImplementationCompleted"
  | "EvolutionValidationStarted"
  | "EvolutionValidationCompleted"
  | "EvolutionActivated"
  | "EvolutionRolledBack"
  | "EvolutionFailed";
```

**EvolutionEvidence**

```typescript
interface EvolutionEvidence {
  evidenceId: string;
  evolutionId: string;
  eventType: EvolutionEventType;
  timestamp: string;
  payload: Record<string, unknown>;
  previousEvolutionId: string | null;
  lineageHash: string;
}
```

---

### Task 2 — Validation Rules

Implement validation functions for:

| Function | Input | Validates |
|----------|-------|-----------|
| `validateEvolutionIntent` | `EvolutionIntent` | All fields required; origin must be valid; target must be valid; rationale must have at least one reference; constraints valid |
| `validateEvolutionProposal` | `EvolutionProposal` | proposalId, evolutionId, title, description, change non-empty |
| `validateEvolutionReview` | `EvolutionReview` | reviewId, evolutionId, reviewer, rationale non-empty; decision valid |
| `validateEvolutionApproval` | `EvolutionApproval` | approvalId, evolutionId, approvedBy, approvedAt, authority non-empty |
| `validateEvolutionImplementation` | `EvolutionImplementation` | All fields required; beforeHash and afterHash non-empty |
| `validateEvolutionValidation` | `EvolutionValidation` | validationId, evolutionId, completedAt non-empty; result valid |
| `validateEvolutionActivation` | `EvolutionActivation` | activationId, evolutionId, activatedAt, scope non-empty; isActive boolean |

Validation functions return:

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

---

### Task 3 — Validation for the Lineage Invariant

Implement:

```typescript
function validateEvolutionLineage(artifacts: {
  intent?: EvolutionIntent;
  proposal?: EvolutionProposal;
  review?: EvolutionReview;
  approval?: EvolutionApproval;
  implementation?: EvolutionImplementation;
  validation?: EvolutionValidation;
  activation?: EvolutionActivation;
}): ValidationResult;
```

Rules:

- If `proposal` exists, `proposal.evolutionId` must match `intent.evolutionId`
- If `review` exists, `review.evolutionId` must match `intent.evolutionId`
- If `approval` exists, `approval.evolutionId` must match `intent.evolutionId`
- If `implementation` exists, `implementation.evolutionId` must match `intent.evolutionId`
- If `validation` exists, `validation.evolutionId` must match `intent.evolutionId`
- If `activation` exists, `activation.evolutionId` must match `intent.evolutionId`

---

### Task 4 — Deterministic Sort Rules

Sort evolution artifact lists:

- `EvolutionReview` lists: sort by `createdAt` ascending, then `reviewId` ascending (deterministic tiebreak)
- `EvolutionProposal` lists: sort by `createdAt` ascending, then `proposalId` ascending
- Evidence lists: sort by `timestamp` ascending, then `evidenceId` ascending

---

## 4. Deferred Scope

The following are intentionally excluded from A0.1 and will ship in later A0.x slices.

### A0.2 — Evolution State Machine

Adds:
- `EvolutionStateMachine` implementation
- Full transition matrix
- Evidence emission per transition
- State validation

### A0.3 — Evolution Evidence Bridge

Adds:
- Connect evolution evidence to X2 capture
- Route to X3b persistence
- Integration tests

### A0.4 — Evolution Governance Surface

Adds:
- `alix evolution` CLI
- Read-only list, inspect, evidence commands
- Human-readable + JSON output

---

## 5. Architecture Decisions

A0.1 is split into layered implementation slices:

```
A0 Design Specification
        |
        v
A0.1 Contract Types           ← current checkpoint
        |
        v
A0.2 Evolution State Machine
        |
        v
A0.3 Evolution Evidence Bridge
        |
        v
A0.4 Evolution Governance Surface
```

Each slice builds on the previous. Contract types are the foundation — every downstream slice depends on them.

---

## 6. File Changes

| Action | File |
|--------|------|
| CREATE | `src/evolution/contracts/evolution-contract.ts` |
| CREATE | `tests/evolution/evolution-contract.test.ts` |

## 7. Invariants

A0.1 must preserve:

**No Store Dependencies**

Types module must not import from:
- Any `*Store` implementation
- CLI modules
- State machine modules
- Evidence persistence

**Pure Validation**

Validation functions must be pure — no side effects, no I/O, no store access.

**Lineage Integrity**

All evolution artifacts must reference an originating `evolutionId`.

**Contract Stability**

Must not modify existing:
- X1-X4 contracts
- P14-P15 types
- Runtime infrastructure
