# A1.1 — Detection Pipeline Design Specification

**Date:** 2026-07-11
**Status:** Design Specification
**Phase:** A1.1 — Detection Pipeline
**Supersedes:** Section 8 of A1 design spec (2026-07-11-a1-pattern-discovery-engine-design.md)

---

## 1. Purpose

A1.1 implements the detection pipeline for the A1 Pattern Discovery Engine: loading evidence from stores, executing detection strategies, and emitting `PatternObservation` artifacts. It builds on the A1.0 contract types and prepares the output stream for A1.2 candidate generation.

A1.1 is proposal-only. Detection may not mutate state, call governance lifecycle, or self-approve.

---

## 2. Primary Invariant

> **Strategies consume data, not own data access.**

The engine loads all inputs from stores and constructs an immutable `DiscoveryContext`. Strategies operate only on this context. No strategy constructs a store, opens a file, or calls an external API.

---

## 3. Module Structure

```
src/evolution/
├── contracts/
│   ├── evolution-contract.ts                       ← A0.1 (unchanged)
│   └── discovery-context.ts                        ← NEW
├── pattern-discovery/
│   ├── detection-strategy.ts                        ← NEW
│   ├── pattern-discovery-engine.ts                  ← NEW
│   ├── strategies/
│   │   ├── execution-failure-strategy.ts            ← NEW
│   │   └── approval-friction-strategy.ts            ← NEW
│   └── index.ts                                     ← NEW

tests/evolution/
├── pattern-discovery-contract.test.ts               ← A1.0 (unchanged)
└── pattern-discovery/
    ├── pattern-discovery-engine.test.ts              ← NEW
    ├── strategies/
    │   ├── execution-failure-strategy.test.ts        ← NEW
    │   └── approval-friction-strategy.test.ts        ← NEW
    └── integration/
        └── discovery-pipeline.test.ts                ← NEW
```

### Naming conventions

- Files named by behavior, aligned to `PatternCategory` values (`execution-failure-strategy.ts`, not `failure-cluster-strategy.ts`)
- Barrel `index.ts` exports engine + all strategies — consumers import from `../pattern-discovery`
- Tests mirror source structure one-to-one

---

## 4. DiscoveryContext

```typescript
// src/evolution/contracts/discovery-context.ts

import type { ExecutionEvidence } from "../../runtime/contracts/execution-intent-contract.js";
import type { GovernanceAuditEvent } from "../../governance/audit-types.js";

/**
 * Immutable context for a single discovery run.
 *
 * A DiscoveryContext is created once per discovery run by
 * PatternDiscoveryEngine and shared immutably across all strategies.
 * Strategies must treat it as read-only and must not retain references
 * beyond the current run.
 */
export interface DiscoveryContext {
  /** Execution evidence loaded from X3b store (all outcomes). */
  readonly evidence: readonly ExecutionEvidence[];

  /** Governance audit events loaded from P14 store. */
  readonly governanceEvents: readonly GovernanceAuditEvent[];
}
```

### Design notes

- **Minimal for A1.1** — only `evidence` and `governanceEvents`. Future fields (`executionWindow`, `configuration`, `now`) are additive and never break existing strategies.
- **Immutability enforced by type** — `Readonly<>` wrapper and `readonly` array modifiers. Strategies must not retain references beyond the current run.
- **Stores are not passed to strategies** — the engine loads data, the context transports it. This is a hard architectural boundary.

---

## 5. DetectionStrategy Interface

```typescript
// src/evolution/pattern-discovery/detection-strategy.ts

import type { PatternCategory, PatternObservation } from "../contracts/pattern-discovery-contract.js";
import type { DiscoveryContext } from "../contracts/discovery-context.js";

/**
 * A strategy that examines discovery evidence and emits patterns.
 *
 * Strategies are stateless analyzers. Each strategy owns one detection
 * algorithm for one PatternCategory. Strategies run independently and
 * must not reference each other, the engine, or any governance/lifecycle
 * component.
 *
 * Strategies receive an immutable DiscoveryContext and return their
 * findings. They must not mutate the context or retain references
 * beyond the current discovery run.
 */
export interface DetectionStrategy {
  /** Human-readable strategy name (e.g. "execution_failure"). */
  readonly name: string;

  /** The pattern category this strategy produces. */
  readonly category: PatternCategory;

  /**
   * Run detection against the discovery context.
   *
   * @param context — immutable context for this discovery run
   * @returns discovered patterns (empty array if none found)
   */
  run(context: DiscoveryContext): Promise<readonly PatternObservation[]>;
}
```

### Design notes

- **Async by default** — strategies return `Promise` even if synchronous today, so A1.3+ strategies can perform async analysis without interface change
- **Immutable outputs** — `readonly PatternObservation[]` prevents downstream mutation of strategy results
- **Identity via `name`** — enables engine metadata (which strategies ran, which failed) and future enable/disable toggles. Not coupled to class identity.

---

## 6. Concrete Strategies

### 6.1 ExecutionFailureStrategy

**Category:** `execution_failure`

**Algorithm:**
1. Filter evidence to `outcome === "FAILED"` where `completedAt` is within the lookback window (from the detecton run's current time minus `lookbackWindowDays`)
2. Group by `intentId` prefix (strip trailing run identifiers)
3. Groups with count >= `minimumOccurrences` become patterns
4. Each pattern:
   - `frequency` = group count
   - `confidence` = `computeConfidence({ evidenceCount, baselineCount, patternStrength: 1.0, recencyFactor })`
   - `evidenceIds` = evidence IDs in the group (chronological order)
   - `firstObserved` / `lastObserved` = min/max completedAt in the group

**Configuration:**

```typescript
export interface ExecutionFailureConfig {
  minimumOccurrences: number;     // default: 3
  lookbackWindowDays: number;     // default: 7
  baselineCount: number;          // default: 10
}
```

**Edge cases:**
- No failed evidence → empty array
- All failures outside window → empty array
- Single failure below threshold → empty array
- Mixed outcomes → only FAILED considered
- `intentId` with no prefix separator → treated as its own group

### 6.2 ApprovalFrictionStrategy

**Category:** `approval_friction`

**Algorithm:**
1. Filter governance events to denial types (`action_denied`, `human_approval_denied`)
2. Compute denial rate = denied / total within the lookback window
3. If total events < `minimumEvents` → skip (insufficient data)
4. If denial rate >= `denialRateThreshold` → emit one pattern per affected policy/action type
5. Each pattern:
   - `frequency` = denial count
   - `confidence` = `computeConfidence({ evidenceCount: denialCount, baselineCount, patternStrength, recencyFactor })`
     - `patternStrength` = `min(1, denialRate / denialRateThreshold)` — stronger signal further above threshold
   - `evidenceIds` = event IDs for the denials

**Configuration:**

```typescript
export interface ApprovalFrictionConfig {
  denialRateThreshold: number;    // 0–1, default: 0.5
  minimumEvents: number;          // default: 10
  lookbackWindowDays: number;     // default: 30
  baselineCount: number;          // default: 20
}
```

**Edge cases:**
- No governance events → empty array
- Events but no denial types → empty array
- Denial rate below threshold → empty array
- Insufficient sample size (< minimumEvents) → empty array
- Both `action_denied` and `human_approval_denied` count toward the same rate

---

## 7. PatternDiscoveryEngine

```typescript
// src/evolution/pattern-discovery/pattern-discovery-engine.ts

import type { ExecutionEvidenceStore } from "../../runtime/execution-evidence-store.js";
import type { AuditStore } from "../../governance/audit-store.js";

export interface PatternDiscoveryEngineConfig {
  /** Store for execution evidence (X3b). */
  evidenceStore: ExecutionEvidenceStore;

  /** Store for governance audit events (P14). */
  auditStore: AuditStore;

  /** Detection strategies to run, in configured order. */
  strategies: DetectionStrategy[];
}

export class PatternDiscoveryEngine {
  constructor(
    private readonly config: PatternDiscoveryEngineConfig,
  ) {}

  async runDiscovery(): Promise<DiscoveryResult> { ... }
}
```

### Pipeline

```
1. Start timer
2. const evidence = await evidenceStore.list()
3. const governanceEvents = await auditStore.listChronological()
4. const context: DiscoveryContext = { evidence, governanceEvents }
5. const results: PatternObservation[][] = []
6. const failed: string[] = []
7. For each strategy in config.strategies (sequential):
     try {
       const patterns = await strategy.run(context)
       results.push(patterns)
     } catch (err) {
       failed.push(strategy.name)
       // Strategy error is logged and absorbed — engine continues
     }
8. Return DiscoveryResult:
     patterns: flatten(results)
     candidates: []
     drafts: []
     metadata: {
       evidenceScanned: evidence.length + governanceEvents.length,
       detectionDurationMs: Date.now() - start,
       strategiesRun: config.strategies.length,
       strategiesFailed: failed.length > 0 ? failed : undefined,
     }
```

### Error isolation

| Scenario | Behavior |
|----------|----------|
| Strategy throws | Error caught, strategy name added to `strategiesFailed`, pattern collection continues |
| Store `list()` throws | Error propagates to caller — no discovery without evidence |
| Empty store (no evidence) | Returns `DiscoveryResult` with empty `patterns`, no error |
| All strategies fail | Returns `DiscoveryResult` with empty `patterns`, `strategiesFailed` lists all names |

### Why sequential execution

- Strategies are independent (no shared resources, read-only context)
- Sequential gives deterministic ordering, simpler debugging, clearer failure attribution
- Parallel is a future optimization: `Promise.all(strategies.map(s => s.run(context)))` without interface change

### Why stores are constructor-injected

- Evidence store and audit store are runtime dependencies, not strategy dependencies
- Engine is the only component that needs to know about storage
- Strategies receive only `DiscoveryContext` — they don't know where data came from

---

## 8. Metadata Extension (A1.0 Contract)

The `DiscoveryResult.metadata` type in A1.0 gains one optional field:

```typescript
// Added to DiscoveryResult.metadata in pattern-discovery-contract.ts:
// strategiesFailed?: string[];
```

This is backward-compatible — existing code ignores absent optional fields.

---

## 9. Testing Strategy

### Unit tests (per strategy)

| Test | Strategy | Verification |
|------|----------|-------------|
| Repeated failures above threshold | ExecutionFailure | Pattern emitted with correct frequency |
| No failures → empty | ExecutionFailure | Empty array |
| Failures outside window → empty | ExecutionFailure | Empty array |
| Single failure below threshold | ExecutionFailure | Empty array |
| Mixed outcomes with some failures | ExecutionFailure | Only FAILED grouped |
| Denial rate above threshold | ApprovalFriction | Pattern emitted |
| Denial rate below threshold | ApprovalFriction | Empty array |
| Insufficient events → skip | ApprovalFriction | Empty array |
| No governance events → empty | ApprovalFriction | Empty array |
| Confidence in [0, 1] | Both | Validated per pattern |

### Engine unit tests

| Test | Verification |
|------|-------------|
| Two strategies each produce patterns | Both patterns in result |
| Strategy throws → continues + metadata | Other strategy's patterns present, failed strategy named |
| Empty store → empty result | patterns: [], metadata.evidenceScanned === 0 |
| Strategies run in configured order | Pattern order matches strategy list order |

### Integration test

| Test | Verification |
|------|-------------|
| In-memory evidence store + in-memory audit store → engine → DiscoveryResult | Full pipeline: load → detect → return. Verifies the store→context→strategy→result chain end-to-end |

---

## 10. Architectural Boundaries

| Boundary | Enforced by |
|----------|-------------|
| Engine does not contain detection logic | Detection logic lives in strategies only |
| Strategies do not access stores | Strategies receive only DiscoveryContext |
| No lifecycle mutation | No EvolutionStateMachine import in A1.1 code |
| No governance bypass | No self-approval paths |
| Proposal drafts not created by engine | Engine produces PatternObservation — A1.2 handles candidates |
| Immutability of context | Type system (`readonly`) + documented contract |

---

## 11. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| `ExecutionEvidenceStore` (X3b) | Engine reads evidence via `list()` | X3b → Engine |
| `AuditStore` (P14) | Engine reads events via `listChronological()` | P14 → Engine |
| `DiscoveryContext` | Passed to every strategy | Engine → Strategy |
| `PatternObservation[]` | Strategy output | Strategy → Engine |
| `DiscoveryResult` | Engine return | Engine → Caller |

---

## 12. Future Growth (Not in A1.1)

- **A1.2** — `CandidateGenerator` consumes `PatternObservation[]` and produces `EvolutionCandidate[]`
- **A1.3** — Additional strategies (performance degradation, governance gap) added as new `DetectionStrategy` implementations — no engine changes needed
- **Parallel execution** — `Promise.all(strategies.map(...))` if sequential becomes a bottleneck
- **Strategy enable/disable** — Filter `config.strategies` before passing to engine
- **logging** — Injected logger when ALiX adopts a standard logging interface
