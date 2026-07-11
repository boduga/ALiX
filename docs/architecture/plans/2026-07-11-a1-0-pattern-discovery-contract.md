# A1.0 — Pattern Discovery Contract Implementation Plan

**Phase:** A1 — Pattern Discovery Engine
**Slice:** A1.0 — Pattern Discovery Contract

**Design Spec:**
`docs/architecture/specs/2026-07-11-a1-pattern-discovery-engine-design.md`

**Depends On:**

* A0.1 — Evolution Contract Types
* A0.2 — Evolution Lifecycle State Machine
* A0.3 — Evolution Evidence Bridge
* X3b — ExecutionEvidenceStore contract

**Checkpoint Target:**

```text
alix-a1-pattern-discovery-contract-complete
```

---

# 1. Purpose

Implement the foundational contract layer for the A1 Pattern Discovery Engine.

This slice introduces the pure data contracts required for future pattern detection and proposal generation:

* Pattern observations
* Evolution candidates
* Evolution proposal drafts
* Discovery results
* Confidence scoring
* Validation rules

A1.0 provides contracts only.

It does not perform discovery, query evidence, create lifecycle artifacts, or interact with governance.

---

# 2. Primary Invariant

> A1.0 may describe potential evolution but must never perform evolution.

The implementation MUST NOT:

* access execution evidence stores
* access governance stores
* call `EvolutionStateMachine`
* create `EvolutionProposal`
* transition lifecycle state
* perform I/O
* mutate runtime behavior

The implementation MAY:

* define types
* validate contracts
* calculate confidence scores

---

# 3. Architecture Boundary

```text
                 A0 Evolution Contract

                 EvolutionTarget
                 EvolutionRiskClass

                         |
                         v

        +--------------------------------+
        | A1 Pattern Discovery Contract  |
        +--------------------------------+

        PatternObservation

        EvolutionCandidate

        EvolutionProposalDraft

        DiscoveryResult
```

---

# 4. File Changes

## Create

```text
src/evolution/contracts/pattern-discovery-contract.ts
```

## Create

```text
tests/evolution/pattern-discovery-contract.test.ts
```

---

# 5. Implementation Tasks

---

# Task 1 — Create Contract Test Suite

## File

```text
tests/evolution/pattern-discovery-contract.test.ts
```

## Framework

Use:

```typescript
node:test
```

Following the existing A0.1 contract test pattern.

---

## Test Coverage

The test suite MUST verify:

### PatternCategory

* Six supported categories exist
* Invalid category values are rejected

Expected categories:

```typescript
execution_failure
approval_friction
performance_degradation
policy_ineffectiveness
governance_gap
agent_misbehavior
```

---

### Confidence Scoring

Test:

* maximum factors return `1.0`
* evidence above baseline clamps to `1.0`
* partial evidence density calculates correctly
* zero evidence returns `0`
* zero baseline is handled safely
* pattern strength affects score
* recency factor affects score

---

### PatternObservation Validation

Test:

* valid observation accepted
* null rejected
* missing `patternId` rejected
* invalid category rejected
* negative frequency rejected
* confidence outside `0–1` rejected
* empty evidence list rejected
* missing timestamps rejected

---

### EvolutionCandidate Validation

Test:

* valid candidate accepted
* null rejected
* missing candidate ID rejected
* missing source pattern rejected
* invalid confidence rejected
* invalid risk class rejected
* missing target rejected
* empty evidence rejected

---

### EvolutionProposalDraft Validation

Test:

* valid draft accepted
* missing draft ID rejected
* missing title rejected
* invalid risk class rejected
* missing timestamp rejected
* primitive values rejected

---

### DiscoveryResult

Test:

* valid construction
* empty discovery result allowed

---

# Task 2 — Implement Pattern Discovery Contract Module

## File

```text
src/evolution/contracts/pattern-discovery-contract.ts
```

---

## Imports

Only import existing A0 contract types:

```typescript
import type {
  EvolutionTarget,
  EvolutionRiskClass
} from "./evolution-contract.js";
```

No runtime imports.

---

# Task 3 — Implement PatternCategory

Add:

```typescript
export type PatternCategory =
  | "execution_failure"
  | "approval_friction"
  | "performance_degradation"
  | "policy_ineffectiveness"
  | "governance_gap"
  | "agent_misbehavior";
```

Add:

```typescript
export const VALID_PATTERN_CATEGORIES:
  readonly PatternCategory[]
```

using the same immutable constant pattern as A0.1.

---

# Task 4 — Implement PatternObservation Contract

Add:

```typescript
export interface PatternObservation
```

Fields:

```typescript
patternId: string;

category: PatternCategory;

frequency: number;

confidence: number;

evidenceIds: string[];

description: string;

firstObserved: string;

lastObserved: string;
```

---

# Task 5 — Implement EvolutionCandidate Contract

Add:

```typescript
export interface EvolutionCandidate
```

Fields:

```typescript
candidateId: string;

sourcePatternId: string;

confidence: number;

target: EvolutionTarget;

description: string;

expectedEffect: string;

riskClass: EvolutionRiskClass;

evidenceIds: string[];
```

---

# Task 6 — Implement EvolutionProposalDraft Contract

Add:

```typescript
export interface EvolutionProposalDraft
```

Important:

`EvolutionProposalDraft` is not an A0 lifecycle object.

It is the boundary artifact between:

```text
A1 intelligence
```

and:

```text
A0 governance lifecycle
```

Fields:

```typescript
draftId: string;

sourcePatternId: string;

title: string;

description: string;

target: EvolutionTarget;

confidence: number;

riskClass: EvolutionRiskClass;

evidenceIds: string[];

createdAt: string;
```

---

# Task 7 — Implement DiscoveryResult Contract

Add:

```typescript
export interface DiscoveryResult
```

Structure:

```typescript
{
  patterns: PatternObservation[];

  candidates: EvolutionCandidate[];

  drafts: EvolutionProposalDraft[];

  metadata: {
    evidenceScanned: number;
    detectionDurationMs: number;
    strategiesRun: number;
  };
}
```

---

# Task 8 — Implement Confidence Scoring

Add:

```typescript
export interface ConfidenceInput
```

Fields:

```typescript
evidenceCount: number;

baselineCount: number;

patternStrength: number;

recencyFactor: number;
```

Implement:

```typescript
export function computeConfidence(
  input: ConfidenceInput
): number
```

Formula:

```text
evidenceDensity =
min(1, evidenceCount / baselineCount)


confidence =
min(
  1,
  evidenceDensity
  *
  patternStrength
  *
  recencyFactor
)
```

Rules:

* baselineCount `0` returns `0`
* output always within `0–1`
* no side effects

---

# Task 9 — Implement Validation Framework

Follow A0.1 validation pattern.

Add:

```typescript
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

Helpers:

```typescript
isNonEmptyString()

isValidPatternCategory()

isValidRiskClass()

isInRange()
```

---

# Task 10 — Implement Validators

Add:

```typescript
validatePatternObservation()
```

Validation:

* object required
* identifier required
* valid category
* non-negative frequency
* confidence range
* evidence references
* timestamps

---

Add:

```typescript
validateEvolutionCandidate()
```

Validation:

* identifiers
* target presence
* confidence
* risk class
* evidence references

---

Add:

```typescript
validateEvolutionProposalDraft()
```

Validation:

* identifiers
* title
* description
* target
* confidence
* risk class
* timestamp

---

# Task 11 — Execute Verification

Run:

## A1.0 Tests

```bash
npx tsx --test tests/evolution/pattern-discovery-contract.test.ts
```

Expected:

```text
all passing
```

---

## TypeScript Validation

```bash
npx tsc --noEmit
```

Expected:

```text
clean
```

---

## Existing Evolution Tests

```bash
node --test tests/evolution/
```

Expected:

```text
no regressions
```

---

# Task 12 — Commit

Commit:

```bash
git add \
src/evolution/contracts/pattern-discovery-contract.ts \
tests/evolution/pattern-discovery-contract.test.ts

git commit \
-m "feat(A1.0): add pattern discovery contract types and validation"
```

---

# Completion Criteria

A1.0 is complete when:

✅ Pattern contract module exists
✅ A0 contract types reused
✅ Pattern categories defined
✅ Discovery result contract defined
✅ Proposal draft boundary enforced
✅ Confidence scoring implemented
✅ Validators implemented
✅ Tests pass
✅ TypeScript clean
✅ No lifecycle mutation paths introduced

---

# Resulting Architecture

After A1.0:

```text
A0 Evolution Contract
        |
        | owns
        v
Lifecycle + Governance


A1.0 Pattern Discovery Contract
        |
        | defines
        v
Discovery Intelligence Artifacts
```

The evolution boundary remains:

```text
A1 discovers
A0 governs
```

