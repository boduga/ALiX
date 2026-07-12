# A1.1 — Detection Pipeline Final Design Specification

**Date:** 2026-07-11
**Status:** Final Design Specification
**Phase:** A1 — Pattern Discovery Engine
**Slice:** A1.1 — Detection Pipeline

**Depends On:**
- A0.1 — Evolution Contract Types
- A0.2 — Evolution Lifecycle State Machine
- A0.3 — Evolution Evidence Bridge
- X3b — ExecutionEvidenceStore
- P14 — Governance Audit Trail
- P15 — Governance Intelligence
- A1.0 — Pattern Discovery Contract

**Checkpoint Target:** `alix-a1-1-detection-pipeline-complete`

---

## 1. Purpose

A1.1 implements the detection pipeline for the A1 Pattern Discovery Engine.

The pipeline consumes:
- execution evidence from X3b
- governance audit events from P14

and produces:
- `PatternObservation` artifacts

A1.1 identifies repeatable operational patterns but does not determine whether evolution should occur.

The output boundary is:

```
X3b ExecutionEvidenceStore
          |
          |
P14 AuditStore
          |
          v
+---------------------------+
| PatternDiscoveryEngine    |
+---------------------------+
          |
          v
+---------------------------+
| Detection Strategies      |
+---------------------------+
          |
          v
PatternObservation[]
          |
          v
DiscoveryResult
```

---

## 2. Primary Invariant

> Detection strategies consume data, not own data access.

The `PatternDiscoveryEngine` is responsible for:
- loading evidence
- loading governance events
- constructing discovery context
- invoking strategies
- collecting results

Strategies are responsible only for:
- analyzing supplied data
- identifying patterns
- returning observations

---

## 3. A1.1 Scope

### Provides

A1.1 provides:
- `DiscoveryContext`
- `DetectionStrategy` interface
- `PatternDiscoveryEngine`
- `ExecutionFailureStrategy`
- `ApprovalFrictionStrategy`
- pattern discovery orchestration
- strategy failure isolation
- discovery metadata

### Does Not Provide

A1.1 does not provide:
- candidate generation
- proposal generation
- lifecycle state transitions
- evolution approval
- runtime mutation
- persistence of patterns
- CLI/UI

Those belong to later slices.

---

## 4. Architecture

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
PatternDiscoveryEngine
  |
  +---------------+---------------+
  |                               |
  v                               v
ExecutionFailureStrategy  ApprovalFrictionStrategy
  |                               |
  +---------------+---------------+
                  |
                  v
        PatternObservation[]
                  |
                  v
          DiscoveryResult
```

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

├── pattern-discovery-contract.test.ts

└── pattern-discovery/
    ├── pattern-discovery-engine.test.ts
    ├── strategies/
    │   ├── execution-failure-strategy.test.ts
    │   └── approval-friction-strategy.test.ts
    └── integration/
        └── discovery-pipeline.test.ts
```

---

## 6. DiscoveryContext

### Location

`src/evolution/contracts/discovery-context.ts`

### Contract

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

`DiscoveryContext` is:
- immutable
- created once per discovery run
- shared by all strategies

Strategies must not:
- mutate context
- access stores
- retain references after execution

---

## 7. DetectionStrategy Contract

### Location

`src/evolution/pattern-discovery/detection-strategy.ts`

### Interface

```typescript
import type {
  PatternCategory,
  PatternObservation,
} from "../contracts/pattern-discovery-contract.js";

import type {
  DiscoveryContext,
} from "../contracts/discovery-context.js";

export interface DetectionStrategy {
  /**
   * Strategy identifier.
   */
  readonly name: string;

  /**
   * Pattern category produced.
   */
  readonly category: PatternCategory;

  /**
   * Analyze discovery context.
   */
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

### Algorithm

```
Input:
  DiscoveryContext.evidence

Process:
  Filter:
    outcome === FAILED
    |
  Filter:
    completedAt within lookback window
    |
  Group:
    normalized intentId
    |
  Count failures
    |
  Threshold check
    |
  Generate PatternObservation
```

### Pattern Output

Example:
```typescript
{
  category: "execution_failure",
  frequency: 12,
  confidence: 0.85,
  evidenceIds: [...],
}
```

### Confidence

Uses:
```typescript
computeConfidence({
  evidenceCount,
  baselineCount,
  patternStrength: 1.0,
  recencyFactor,
})
```

### Edge Cases

| Case | Result |
|------|--------|
| No failures | Empty result |
| Below threshold | Empty result |
| Old failures | Ignored |
| Successful executions | Ignored |
| Missing prefix | Own group |

---

## 9. ApprovalFrictionStrategy

### Purpose

Detect excessive governance denial patterns.

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

### Algorithm

```
Input:
  DiscoveryContext.governanceEvents

Filter:
  action_denied
  human_approval_denied

Calculate:
  denialRate = deniedEvents / totalEvents

Emit pattern when:
  totalEvents >= minimumEvents
  AND
  denialRate >= threshold
```

### Confidence Calculation

```typescript
computeConfidence({
  evidenceCount: denialCount,
  baselineCount,
  patternStrength: min(1, denialRate / threshold),
  recencyFactor,
})
```

### Edge Cases

| Case | Result |
|------|--------|
| Empty audit stream | Empty |
| No denial events | Empty |
| Low denial rate | Empty |
| Insufficient events | Empty |

---

## 10. PatternDiscoveryEngine

### Location

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
1. Loads evidence
2. Loads governance events
3. Creates DiscoveryContext
4. Runs strategies
5. Aggregates patterns
6. Produces DiscoveryResult

### Pipeline

```
start timer
      |
load ExecutionEvidence
      |
load GovernanceAuditEvents
      |
create DiscoveryContext
      |
execute strategies sequentially
      |
collect PatternObservation[]
      |
return DiscoveryResult
```

### Strategy Execution

Strategies execute sequentially:

```
for strategy of strategies:
    try:
        await strategy.run(context)
    catch:
        record failure
        continue
```

### Error Isolation Rules

| Failure | Behavior |
|---------|----------|
| Strategy throws | Continue discovery |
| Store failure | Propagate error |
| Empty stores | Empty DiscoveryResult |
| All strategies fail | Return failed metadata |

---

## 11. DiscoveryResult Extension

A1.0 contract extension:

```typescript
metadata: {
  evidenceScanned: number;
  detectionDurationMs: number;
  strategiesRun: number;
  strategiesFailed?: string[];
}
```

Backward compatible.

---

## 12. Barrel Exports

### Location

`src/evolution/pattern-discovery/index.ts`

### Exports

```typescript
export * from "./detection-strategy.js";
export * from "./pattern-discovery-engine.js";
export * from "./strategies/execution-failure-strategy.js";
export * from "./strategies/approval-friction-strategy.js";
```

---

## 13. Testing Requirements

### ExecutionFailureStrategy

| Test | Expected |
|------|----------|
| repeated failures | Pattern emitted |
| below threshold | Empty |
| outside window | Empty |
| mixed outcomes | Only failures counted |
| confidence range | 0–1 |

### ApprovalFrictionStrategy

| Test | Expected |
|------|----------|
| high denial rate | Pattern emitted |
| low denial rate | Empty |
| insufficient events | Empty |
| no events | Empty |

### Engine Tests

| Test | Expected |
|------|----------|
| Multiple strategies | Combined output |
| Strategy failure | Continues execution |
| Empty stores | Empty result |
| Ordering | Deterministic ordering |

### Integration Test

**Scenario:**
- In-memory stores
- PatternDiscoveryEngine
- Strategies
- DiscoveryResult

**Verify:**
- stores loaded
- context created
- strategies executed
- patterns returned

---

## 14. Architectural Boundaries

| Boundary | Enforcement |
|----------|-------------|
| No store access in strategies | DiscoveryContext only |
| No lifecycle mutation | No A0 state machine imports |
| No proposals | A1.2 responsibility |
| No persistence | Derived artifacts only |
| Immutable analysis | `readonly` context |
| Independent strategies | DetectionStrategy interface |

---

## 15. Future Extensions

A1.1 enables:

### A1.2 — Candidate Generation

```
PatternObservation[]
        |
EvolutionCandidate[]
        |
EvolutionProposalDraft
```

### A1.3 — Additional Strategies

Future implementations:
- performance degradation
- governance gaps
- policy effectiveness
- agent misbehavior

without changing:
- engine
- context
- strategy interface

---

## 16. Completion Criteria

A1.1 is complete when:

- ✅ DiscoveryContext implemented
- ✅ DetectionStrategy contract implemented
- ✅ PatternDiscoveryEngine implemented
- ✅ ExecutionFailureStrategy implemented
- ✅ ApprovalFrictionStrategy implemented
- ✅ Engine owns all store access
- ✅ Strategies consume immutable context only
- ✅ Strategy failures isolated
- ✅ DiscoveryResult returned
- ✅ No lifecycle mutation paths exist
- ✅ All tests pass
- ✅ TypeScript compilation clean

**Checkpoint:** `alix-a1-1-detection-pipeline-complete`

After A1.1 completion, ALiX has a governed observation layer capable of discovering repeatable operational patterns while preserving the A0 evolution safety boundary.
