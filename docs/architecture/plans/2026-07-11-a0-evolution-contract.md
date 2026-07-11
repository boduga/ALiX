The A0.1 implementation plan is well aligned with the final A0 spec. I would make a few small corrections before freezing it as the implementation contract.

The biggest one: **avoid putting `EvolutionEvidence` in A0.1 as a runtime evidence model that duplicates X2/X3b.** A0 should define the evolution-facing contract, but evidence transport/persistence belongs to the existing execution evidence pipeline. Keep the type as a reference contract if needed, but avoid creating a competing evidence model.

Below is the tightened final version.

# A0.1 — Evolution Contract Types Implementation Plan

**Phase:** A0 — Evolution Contract
**Slice:** A0.1 — Evolution Contract Types

**Design Spec:**
`docs/architecture/specs/2026-07-11-a0-evolution-contract-design.md`

**Checkpoint Target:**
`alix-a0-1-evolution-contract-types-complete`

---

# 1. Purpose

A0.1 delivers the foundational type contracts for ALiX evolution.

This slice establishes the vocabulary and validation boundaries required for all downstream A-series phases.

A0.1 is contract-only.

It introduces:

* evolution intent contracts
* evolution artifact contracts
* evolution lifecycle state definitions
* evolution target definitions
* evolution constraint definitions
* evidence references
* validation rules
* lineage validation
* deterministic ordering rules

A0.1 does not implement:

* state transitions
* persistence
* execution
* governance workflows
* CLI interfaces
* autonomous evolution logic

---

# 2. Scope Alignment

A0 architecture:

```
A0 Evolution Contract
        |
        v
A0.1 Contract Types       ← Current
        |
        v
A0.2 Lifecycle State Machine
        |
        v
A0.3 Evidence Bridge
        |
        v
A0.4 Governance Surface
```

A0.1 delivers:

```
Types
 +
Validation
 +
Lineage Rules
 +
Deterministic Ordering
```

---

# 3. File Changes

Create:

```
src/evolution/contracts/evolution-contract.ts
```

Create:

```
tests/evolution/evolution-contract.test.ts
```

---

# 4. Required Types

## 4.1 EvolutionState

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

Terminal states:

```text
ACTIVE
REJECTED
WITHDRAWN
ROLLED_BACK
```

---

# 4.2 EvolutionOrigin

```typescript
type EvolutionOrigin =
  | "operator"
  | "governance_signal"
  | "learning_outcome"
  | "system_observation";
```

---

# 4.3 EvolutionTargetKind

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

---

# 4.4 EvolutionTarget

```typescript
interface EvolutionTarget {
  kind: EvolutionTargetKind;
  id: string;
  currentHash?: string;
}
```

---

# 4.5 EvidenceReference

Reference existing evidence systems.

```typescript
interface EvidenceReference {
  evidenceId: string;
  source: string;
  description?: string;
}
```

This does not replace X2/X3b evidence models.

---

# 4.6 EvolutionConstraint

```typescript
interface EvolutionConstraint {
  type: string;
  value: unknown;
  reason: string;
}
```

---

# 4.7 EvolutionIntent

```typescript
interface EvolutionIntent {

  evolutionId: string;

  origin: EvolutionOrigin;

  target: EvolutionTarget;

  rationale: EvidenceReference[];

  expectedEffect: string;

  riskClass:
    | "low"
    | "medium"
    | "high";

  constraints: EvolutionConstraint[];

  createdAt: string;
}
```

Invariant:

> No evolution exists without an explicit EvolutionIntent.

---

# 4.8 EvolutionProposal

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

---

# 4.9 EvolutionReview

```typescript
interface EvolutionReview {

  reviewId: string;

  evolutionId: string;

  reviewer: string;

  decision:
    | "approve"
    | "reject"
    | "amend";

  rationale: string;

  createdAt: string;
}
```

---

# 4.10 EvolutionApproval

```typescript
interface EvolutionApproval {

  approvalId: string;

  evolutionId: string;

  approvedBy: string;

  approvedAt: string;

  authority: string;
}
```

---

# 4.11 EvolutionImplementation

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

---

# 4.12 EvolutionValidation

```typescript
interface EvolutionValidation {

  validationId: string;

  evolutionId: string;

  result:
    | "passed"
    | "failed"
    | "partial";

  metrics: Record<string, number>;

  evidenceIds: string[];

  completedAt: string;
}
```

---

# 4.13 EvolutionActivation

```typescript
interface EvolutionActivation {

  activationId: string;

  evolutionId: string;

  activatedAt: string;

  scope: string;

  isActive: boolean;
}
```

---

# 5. Validation Contracts

All validators are pure functions.

```typescript
interface ValidationResult {

  valid: boolean;

  errors: string[];
}
```

No:

* I/O
* store access
* runtime calls
* persistence

---

# 6. Required Validators

## validateEvolutionIntent

Validates:

* evolutionId exists
* origin valid
* target valid
* rationale contains references
* expectedEffect exists
* riskClass valid
* constraints valid

---

## validateEvolutionProposal

Validates:

* proposalId
* evolutionId
* title
* description
* change

---

## validateEvolutionReview

Validates:

* reviewId
* evolutionId
* reviewer
* decision
* rationale

---

## validateEvolutionApproval

Validates:

* approvalId
* evolutionId
* approvedBy
* approvedAt
* authority

---

## validateEvolutionImplementation

Validates:

* implementationId
* evolutionId
* changeEvidence
* beforeHash
* afterHash

---

## validateEvolutionValidation

Validates:

* validationId
* evolutionId
* result
* completedAt

---

## validateEvolutionActivation

Validates:

* activationId
* evolutionId
* activatedAt
* scope
* isActive

---

# 7. Evolution Lineage Validation

Implement:

```typescript
function validateEvolutionLineage(
 artifacts: {
   intent?: EvolutionIntent;
   proposal?: EvolutionProposal;
   review?: EvolutionReview;
   approval?: EvolutionApproval;
   implementation?: EvolutionImplementation;
   validation?: EvolutionValidation;
   activation?: EvolutionActivation;
 }
): ValidationResult;
```

Rules:

Every artifact must reference:

```text
artifact.evolutionId === intent.evolutionId
```

Checked artifacts:

* Proposal
* Review
* Approval
* Implementation
* Validation
* Activation

Invariant:

> No evolution artifact exists outside its originating evolution lineage.

---

# 8. Deterministic Ordering

All list ordering must be deterministic.

## Reviews

Sort:

```text
createdAt ASC
reviewId ASC
```

---

## Proposals

Sort:

```text
createdAt ASC
proposalId ASC
```

---

## Evidence References

Sort:

```text
evidenceId ASC
```

---

# 9. Tests

Create:

```
tests/evolution/evolution-contract.test.ts
```

Required suites:

## Intent Validation

* valid intent accepted
* missing evolutionId rejected
* invalid origin rejected
* missing rationale rejected
* invalid target rejected

---

## Artifact Validation

* proposal validation
* review validation
* approval validation
* implementation validation
* validation artifact validation
* activation validation

---

## Lineage Validation

* matching evolutionId accepted
* mismatched evolutionId rejected
* missing intent rejected

---

## Deterministic Ordering

* identical timestamps resolve through ID ordering
* output ordering remains stable

---

# 10. Deferred Scope

## A0.2 — Evolution Lifecycle State Machine

Adds:

* transition engine
* transition matrix
* state validation
* transition evidence generation

---

## A0.3 — Evolution Evidence Bridge

Adds:

* X2 evidence compatibility
* X3b persistence integration
* P14 audit linkage

---

## A0.4 — Evolution Governance Surface

Adds:

* `alix evolution`
* list
* inspect
* evidence
* JSON output

---

# 11. Invariants

A0.1 must preserve:

## Pure Contract Layer

No imports from:

* stores
* CLI
* runtime
* state machine
* persistence

---

## Validation Purity

Validators:

* deterministic
* side-effect free
* synchronous

---

## Lineage Integrity

Every evolution artifact references:

```text
EvolutionIntent.evolutionId
```

---

## Contract Stability

A0.1 must not modify:

* X1 contracts
* X2 contracts
* X3b persistence contracts
* X4 runtime contracts
* P14/P15 governance contracts

---

# 12. Completion Criteria

A0.1 is complete when:

* [ ] All evolution contract types implemented
* [ ] All validators implemented
* [ ] Lineage validation implemented
* [ ] Deterministic ordering rules implemented
* [ ] Tests passing
* [ ] TypeScript clean
* [ ] No store/runtime dependencies
* [ ] Checkpoint created:

```
alix-a0-1-evolution-contract-types-complete
```

---

# Architectural Outcome

After A0.1:

```
Evolution Concept
        |
        v
Evolution Contract Types
        |
        v
Validated Evolution Artifacts
        |
        v
A0.2 Lifecycle State Machine
        |
        v
Governed Evolution Runtime
```

A0.1 establishes the language of evolution.

Future phases determine how that language is executed.

This version is ready to hand to implementation. It preserves the same discipline used successfully in X1/X2/P15.3a: **pure contracts first, behavior later.**

