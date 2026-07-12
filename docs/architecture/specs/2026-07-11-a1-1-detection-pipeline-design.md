# A1.1 — Detection Pipeline Final Design Specification

**Date:** 2026-07-11
**Status:** Final Design Specification
**Phase:** A1 — Pattern Discovery Engine
**Slice:** A1.1 — Detection Pipeline

**Checkpoint Target:** `alix-a1-1-detection-pipeline-complete`

---

## 1. Purpose

A1.1 implements the detection pipeline for the A1 Pattern Discovery Engine.

The pipeline consumes historical operational signals:
- execution evidence from X3b
- governance audit signals from P14

and produces:
- `PatternObservation` artifacts

A1.1 detects repeatable operational patterns.

It does **not**:
- create evolution candidates
- generate proposals
- modify runtime behavior
- modify policies
- transition lifecycle states
- approve changes

---

## 2. Primary Invariant

> Detection strategies consume data, not own data access.

The `PatternDiscoveryEngine` owns:
- evidence loading
- governance event loading
- context creation
- strategy execution
- result aggregation
- failure isolation

Detection strategies own:
- analysis algorithms
- pattern recognition
- confidence calculation inputs
- pattern generation

---

## 3. Architecture

```
X3b
                  |
                  v
       ExecutionEvidenceStore
                  |
                  |
                 P14
                  |
                  v
              AuditStore
                  |
                  v

       +----------------------+
       | PatternDiscovery     |
       | Engine               |
       +----------------------+

                  |
                  v

        +----------------+
        | DiscoveryContext|
        +----------------+

                  |
       +----------+----------+
       |                     |
       v                     v

ExecutionFailure       ApprovalFriction
Strategy               Strategy

       |                     |

       +----------+----------+

                  |
                  v

        PatternObservation[]

                  |
                  v

          DiscoveryResult
```

---

## 4. Dependencies

### Required

- A1.0 — Pattern Discovery Contract
- X3b — ExecutionEvidenceStore
- P14 — AuditStore

---

## 5. Module Structure

```
src/evolution/

├── contracts/
│   ├── evolution-contract.ts
│   ├── pattern-discovery-contract.ts
│   └── discovery-context.ts
│
└── pattern-discovery/
    ├── detection-strategy.ts
    ├── pattern-discovery-engine.ts
    ├── strategies/
    │   ├── execution-failure-strategy.ts
    │   └── approval-friction-strategy.ts
    └── index.ts


tests/evolution/

└── pattern-discovery/
    ├── pattern-discovery-engine.test.ts
    ├── strategies/
    │   ├── execution-failure-strategy.test.ts
    │   └── approval-friction-strategy.test.ts
    └── integration/
        └── discovery-pipeline.test.ts
```

---

## 6. DiscoveryContext Contract

### File

`src/evolution/contracts/discovery-context.ts`

### Interface

```typescript
import type { ExecutionEvidence } from "../../runtime/contracts/execution-intent-contract.js";
import type { GovernanceAuditEvent } from "../../governance/audit-types.js";

export interface DiscoveryContext {
  /**
   * Execution evidence loaded from X3b.
   */
  readonly evidence: readonly ExecutionEvidence[];

  /**
   * Governance audit events loaded from P14.
   */
  readonly governanceEvents: readonly GovernanceAuditEvent[];
}
```

### Rules

`DiscoveryContext`:
- is immutable
- is created once per discovery execution
- is shared across all strategies

Strategies must not:
- mutate context
- access stores
- retain context after execution

---

## 7. DetectionStrategy Interface

### File

`src/evolution/pattern-discovery/detection-strategy.ts`

```typescript
import type {
  PatternCategory,
  PatternObservation,
} from "../contracts/pattern-discovery-contract.js";

import type {
  DiscoveryContext,
} from "../contracts/discovery-context.js";

export interface DetectionStrategy {
  readonly name: string;
  readonly category: PatternCategory;

  run(
    context: DiscoveryContext
  ): Promise<readonly PatternObservation[]>;
}
```

---

## 8. ExecutionFailureStrategy

### Purpose

Detect repeated execution failures from X3b evidence.

**Category:** `execution_failure`

### Configuration

```typescript
export interface ExecutionFailureConfig {
  minimumOccurrences: number;
  lookbackWindowDays: number;
  baselineCount: number;
}
```

Defaults:
```typescript
{
  minimumOccurrences: 3,
  lookbackWindowDays: 7,
  baselineCount: 10,
}
```

### Detection Algorithm

**Input:** `DiscoveryContext.evidence`

**Steps:**

1. **Filter:** `outcome === "FAILED"`

2. **Filter:** `completedAt >= now - lookbackWindowDays`

3. **Normalize intent IDs.**

4. **Group failures.**

5. **Emit patterns where:** failure count >= `minimumOccurrences`

### Intent ID Normalization

**Rule:** Remove everything after the final `/`.

**Example:**
```
Input:  agent/workflow/run-001
Output: agent/workflow
```

**Examples:**

| Original | Normalized |
|----------|------------|
| `agent/task/run-001` | `agent/task` |
| `workflow/a/b/run-15` | `workflow/a/b` |
| `workflow/payment` | `workflow/payment` |
| `task-001` | `task-001` |

**Implementation:**
```typescript
function normalizeIntentId(intentId: string): string {
  const index = intentId.lastIndexOf("/");
  if (index === -1) {
    return intentId;
  }
  return intentId.slice(0, index);
}
```

### Pattern Output

Each detected pattern:
```typescript
{
  patternId,
  category: "execution_failure",
  frequency,
  confidence,
  evidenceIds,
  description,
  firstObserved,
  lastObserved,
}
```

### Confidence

```typescript
computeConfidence({
  evidenceCount,
  baselineCount,
  patternStrength: 1.0,
  recencyFactor,
})
```

---

## 9. ApprovalFrictionStrategy

### Purpose

Detect repeated governance approval friction.

**Category:** `approval_friction`

### Configuration

```typescript
export interface ApprovalFrictionConfig {
  denialRateThreshold: number;
  minimumEvents: number;
  lookbackWindowDays: number;
  baselineCount: number;
}
```

Defaults:
```typescript
{
  denialRateThreshold: 0.5,
  minimumEvents: 10,
  lookbackWindowDays: 30,
  baselineCount: 20,
}
```

### Detection Algorithm

**Input:** `DiscoveryContext.governanceEvents`

#### Step 1 — Filter Relevant Events

**Included:**
- `action_denied`
- `human_approval_denied`

**Also included:** approved decisions, for denominator calculation.

#### Step 2 — Calculate Denial Rate

**Definition:**
```
denialRate =
  denied approval events
  ----------------------
  approval decision events
```

Where:
```
approval decision events = approved + action_denied + human_approval_denied
```

**Example:**
```
100 approval decisions
85 denied
15 approved

denialRate = 0.85
```

#### Step 3 — Threshold Evaluation

Emit pattern only when:
```
totalEvents >= minimumEvents
AND
denialRate >= denialRateThreshold
```

### Pattern Output

```typescript
{
  patternId,
  category: "approval_friction",
  frequency,
  confidence,
  evidenceIds,
  description,
  firstObserved,
  lastObserved,
}
```

### Confidence

```typescript
computeConfidence({
  evidenceCount: deniedCount,
  baselineCount,
  patternStrength:
    min(
      1,
      denialRate / denialRateThreshold
    ),
  recencyFactor,
})
```

---

## 10. Recency Factor

Both strategies use `recencyFactor` with a shared calculation.

### Formula

```
recencyFactor =
  max(
    0,
    1 - (ageInDays / lookbackWindowDays)
  )
```

### Pattern Timestamp Selection

For patterns containing multiple records: use the **newest** supporting record.

```
latestObservedTimestamp
```

### Examples

**Lookback:** 7 days

**Evidence age:**

| Age | Factor |
|-----|--------|
| 0 days | 1.0 |
| 3.5 days | 0.5 |
| 7 days | 0 |
| >7 days | 0 |

---

## 11. PatternDiscoveryEngine

### File

`src/evolution/pattern-discovery/pattern-discovery-engine.ts`

### Configuration

```typescript
export interface PatternDiscoveryEngineConfig {
  evidenceStore: ExecutionEvidenceStore;
  auditStore: AuditStore;
  strategies: DetectionStrategy[];
}
```

### Responsibilities

The engine:
1. Loads execution evidence.
2. Loads governance events.
3. Creates DiscoveryContext.
4. Executes strategies.
5. Aggregates observations.
6. Returns DiscoveryResult.

### Execution Flow

```
start timer
    |
load evidenceStore.list()
    |
load auditStore.listChronological()
    |
create DiscoveryContext
    |
execute strategies sequentially
    |
flatten PatternObservation[]
    |
return DiscoveryResult
```

### Strategy Failure Isolation

**Algorithm:**
```
for (strategy of strategies) {
  try {
    results.push(
      await strategy.run(context)
    );
  } catch {
    strategiesFailed.push(strategy.name);
  }
}
```

**Rules:**

| Event | Behavior |
|-------|----------|
| Strategy throws | Continue |
| Store failure | Propagate |
| Empty stores | Empty result |
| All strategies fail | Return failed metadata |

---

## 12. DiscoveryResult Metadata Extension

Extend A1.0:

```typescript
metadata: {
  evidenceScanned: number;
  detectionDurationMs: number;
  strategiesRun: number;
  strategiesFailed?: string[];
}
```

---

## 13. Testing Requirements

### ExecutionFailureStrategy

Required tests:
- repeated failures emit pattern
- threshold prevents false positives
- old failures ignored
- successful executions ignored
- mixed outcomes handled
- confidence range validated
- intent normalization verified

### ApprovalFrictionStrategy

Required tests:
- high denial rate emits pattern
- low denial rate ignored
- insufficient events ignored
- empty audit events handled
- denominator uses approval decisions only
- confidence range validated

### Engine Tests

Required:

| Test | Expected |
|------|----------|
| Multiple strategies | Combined patterns |
| Strategy failure | Other strategies continue |
| Empty stores | Empty DiscoveryResult |
| Ordering | Deterministic output |
| Metadata | Correct counters |

### Integration Test

**Scenario:**
- In-memory stores
- PatternDiscoveryEngine
- Strategies
- DiscoveryResult

**Verify:**
- evidence loaded
- governance events loaded
- context created
- strategies executed
- patterns returned

---

## 14. Architectural Boundaries

| Boundary | Enforcement |
|----------|-------------|
| Strategies cannot access stores | Context-only input |
| Engine has no detection logic | Strategy separation |
| No lifecycle mutation | No A0 state machine imports |
| No proposal generation | A1.2 responsibility |
| No persistence | Derived observations only |
| Immutable analysis | `readonly` contracts |

---

## 15. Future Extensions

### A1.2 — Candidate Generation

```
PatternObservation
        |
EvolutionCandidate
        |
EvolutionProposalDraft
```

### A1.3 — Additional Detection Strategies

Future:
- performance degradation
- governance gaps
- policy ineffectiveness
- agent misbehavior

without modifying:
- engine contract
- context contract
- strategy interface

---

## 16. Completion Criteria

A1.1 is complete when:

- ✅ DiscoveryContext implemented
- ✅ DetectionStrategy implemented
- ✅ PatternDiscoveryEngine implemented
- ✅ ExecutionFailureStrategy implemented
- ✅ ApprovalFrictionStrategy implemented
- ✅ Intent normalization defined
- ✅ Denial rate denominator defined
- ✅ Recency scoring defined
- ✅ Store ownership remains in engine
- ✅ Strategies remain stateless
- ✅ Tests pass
- ✅ TypeScript clean

**Checkpoint:** `alix-a1-1-detection-pipeline-complete`

A1.1 establishes the governed observation layer required for A1.2 candidate generation while preserving the A0 evolution safety boundary.
