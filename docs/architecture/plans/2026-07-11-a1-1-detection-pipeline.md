A1.1 — Detection Pipeline Implementation Plan (Final)

> Phase: A1 — Pattern Discovery Engine
Slice: A1.1 — Detection Pipeline
Design Spec: docs/architecture/specs/2026-07-11-a1-1-detection-pipeline-design.md
Depends On: A1.0 Pattern Discovery Contract
Checkpoint Target: alix-a1-1-detection-pipeline-complete




---

Goal

Implement the A1.1 Detection Pipeline.

The implementation provides:

Immutable DiscoveryContext

DetectionStrategy contract

ExecutionFailureStrategy

ApprovalFrictionStrategy

PatternDiscoveryEngine

Strategy error isolation

Discovery metadata extension

Unit and integration tests


The pipeline is proposal-only:

Detection produces PatternObservation

No lifecycle mutation

No governance mutation

No candidate generation

No self-approval



---

Architecture Invariants

These rules MUST remain true.

1. Strategies consume data, not own data access

ExecutionEvidenceStore ─┐
                         │
AuditStore ──────────────┤
                         ↓
              PatternDiscoveryEngine
                         ↓
              Immutable DiscoveryContext
                         ↓
              Detection Strategies

Strategies:

receive only DiscoveryContext

do not access stores

do not call external APIs

do not mutate state

do not retain context references



---

2. Engine owns orchestration

The engine owns:

loading evidence

loading governance events

context creation

strategy execution ordering

failure isolation

result assembly


The engine contains no detection logic.


---

3. Strategy execution model

Execution is sequential:

Strategy A
   ↓
Strategy B
   ↓
Strategy C

Reason:

deterministic ordering

easier debugging

simpler failure attribution


Parallel execution remains a future optimization.


---

4. Error isolation

Failure	Behaviour

Strategy throws	Capture name, continue
One strategy fails	Other strategies still execute
All strategies fail	Return empty patterns
Store loading fails	Propagate error



---

Repository Changes

src/evolution/
│
├── contracts/
│   ├── pattern-discovery-contract.ts   MODIFY
│   └── discovery-context.ts             NEW
│
└── pattern-discovery/
    ├── detection-strategy.ts            NEW
    ├── pattern-discovery-engine.ts      NEW
    ├── index.ts                         NEW
    │
    └── strategies/
        ├── execution-failure-strategy.ts
        └── approval-friction-strategy.ts


tests/evolution/
│
└── pattern-discovery/
    ├── discovery-context.test.ts
    ├── pattern-discovery-engine.test.ts
    │
    ├── strategies/
    │   ├── execution-failure-strategy.test.ts
    │   └── approval-friction-strategy.test.ts
    │
    └── integration/
        └── discovery-pipeline.test.ts


---

Task 1 — Extend DiscoveryResult Metadata

Files

Modify:

src/evolution/contracts/pattern-discovery-contract.ts


---

Change

Add:

strategiesFailed?: string[];

to:

DiscoveryResult.metadata

Final metadata:

metadata: {
  evidenceScanned: number;
  detectionDurationMs: number;
  strategiesRun: number;
  strategiesFailed?: string[];
}


---

Validation

Run:

npx tsc --noEmit

Expected:

0 errors


---

Task 2 — Create DiscoveryContext

File

Create:

src/evolution/contracts/discovery-context.ts


---

Contract

export interface DiscoveryContext {

  readonly evidence:
    readonly ExecutionEvidence[];

  readonly governanceEvents:
    readonly GovernanceAuditEvent[];

}


---

Rules

Created once per discovery run

Shared across strategies

Immutable by contract



---

Test

Create:

tests/evolution/pattern-discovery/discovery-context.test.ts

Verify:

empty context allowed

readonly arrays reject mutation



---

Task 3 — Create DetectionStrategy Interface

File

Create:

src/evolution/pattern-discovery/detection-strategy.ts


---

Interface

export interface DetectionStrategy {

  readonly name: string;

  readonly category: PatternCategory;

  run(
    context: DiscoveryContext
  ): Promise<readonly PatternObservation[]>;

}


---

Requirements

async contract

immutable output

no engine dependency



---

Task 4 — Implement ExecutionFailureStrategy

Files

Create:

src/evolution/pattern-discovery/strategies/execution-failure-strategy.ts

Test:

tests/evolution/pattern-discovery/strategies/execution-failure-strategy.test.ts


---

Configuration

interface ExecutionFailureConfig {

 minimumOccurrences: number;

 lookbackWindowDays: number;

 baselineCount: number;

}


---

Algorithm

Step 1

Filter:

outcome === FAILED

and:

completedAt within lookbackWindowDays


---

Step 2 — Normalize intentId

Rule:

normalizeIntentId()

removes everything after final:

/

Example:

agent/deploy/run-001
        ↓
agent/deploy

No slash:

task-001

remains unchanged.


---

Step 3 — Group

Group by normalized intent ID.


---

Step 4 — Emit

If:

group.count >= minimumOccurrences

produce:

PatternObservation

with:

frequency = group size

evidenceIds = chronological order

firstObserved = earliest completedAt

lastObserved = latest completedAt


---

Confidence

Use:

computeConfidence()

Parameters:

{
 evidenceCount,
 baselineCount,
 patternStrength: 1.0,
 recencyFactor
}

Recency:

max(
0,
1 - ageDays/lookbackWindowDays
)

using newest record.


---

Tests

Required:

repeated failures emit pattern

failures below threshold ignored

failures outside window ignored

successful executions ignored

intent normalization works

confidence between 0 and 1



---

Task 5 — Implement ApprovalFrictionStrategy

Files

Create:

src/evolution/pattern-discovery/strategies/approval-friction-strategy.ts

Test:

tests/evolution/pattern-discovery/strategies/approval-friction-strategy.test.ts


---

Configuration

interface ApprovalFrictionConfig {

 denialRateThreshold: number;

 minimumEvents: number;

 lookbackWindowDays: number;

 baselineCount: number;

}


---

Event Classification

Denied:

action_denied
human_approval_denied

Approved:

action_allowed
human_approval_granted


---

Denial Rate

Formula:

denied /
(
 denied + approved
)

Ignore unrelated governance events.


---

Algorithm

1. Filter events by lookback window


2. Count:



deniedCount
approvedCount

3. Require:



denied + approved >= minimumEvents

4. Calculate:



denialRate

5. Emit when:



denialRate >= threshold


---

Pattern

frequency = deniedCount

evidenceIds = denied event IDs

firstObserved = earliest decision event

lastObserved = newest decision event


---

Confidence

Use:

computeConfidence()

with:

patternStrength =
min(
1,
denialRate / denialRateThreshold
)

Recency:

max(
0,
1 - ageDays/lookbackWindowDays
)

using newest decision timestamp.


---

Tests

Required:

high denial rate emits

low denial rate ignored

insufficient events ignored

no events ignored

denominator uses approved + denied only

confidence range valid



---

Task 6 — Implement PatternDiscoveryEngine

Files

Create:

src/evolution/pattern-discovery/pattern-discovery-engine.ts

Test:

tests/evolution/pattern-discovery/pattern-discovery-engine.test.ts


---

Dependencies

Imports:

import type { ExecutionEvidenceStore }
from "../../runtime/execution-evidence-store.js";

import type { AuditStore }
from "../../governance/audit-store.js";


---

Configuration

export interface PatternDiscoveryEngineConfig {

 evidenceStore: ExecutionEvidenceStore;

 auditStore: AuditStore;

 strategies: DetectionStrategy[];

}


---

Algorithm

1. Start timer

2. Load evidence

3. Load governance events

4. Create DiscoveryContext

5. Execute strategies sequentially

6. Catch strategy failures

7. Flatten PatternObservation[]

8. Build DiscoveryResult

9. Return


---

Result

{
 patterns,

 candidates: [],

 drafts: [],

 metadata:{
   evidenceScanned,
   detectionDurationMs,
   strategiesRun,
   strategiesFailed?
 }
}


---

Tests

Required:

Multiple strategies

Verify:

both strategies execute

patterns merged



---

Failure isolation

Verify:

throwing strategy does not stop execution

failed name appears in metadata



---

Empty stores

Verify:

patterns=[]


---

Store failure

Verify:

error propagates.


---

Task 7 — Integration Test

File

Create:

tests/evolution/pattern-discovery/integration/discovery-pipeline.test.ts


---

Scenario:

In-memory EvidenceStore
          |
          ↓
PatternDiscoveryEngine
          |
          ↓
ExecutionFailureStrategy
ApprovalFrictionStrategy
          |
          ↓
DiscoveryResult

Verify:

stores called

context constructed

strategies executed

patterns returned

metadata populated



---

Task 8 — Barrel Export

File

Create:

src/evolution/pattern-discovery/index.ts

Exports:

export * from "./detection-strategy.js";

export * from "./pattern-discovery-engine.js";

export * from "./strategies/execution-failure-strategy.js";

export * from "./strategies/approval-friction-strategy.js";


---

Task 9 — Final Validation

TypeScript

npx tsc --noEmit


---

A1.1 Tests

npx tsx --test \
tests/evolution/pattern-discovery/**/*.test.ts


---

Evolution Regression

Run:

npx tsx --test tests/evolution/*.test.ts

Expected:

All tests passing
No A0 regressions


---

Completion Criteria

A1.1 is complete when:

✅ DiscoveryContext exists
✅ DetectionStrategy contract exists
✅ ExecutionFailureStrategy implemented
✅ ApprovalFrictionStrategy implemented
✅ PatternDiscoveryEngine implemented
✅ Strategy isolation works
✅ Store failures propagate
✅ Metadata reports failed strategies
✅ Integration pipeline passes
✅ TypeScript clean
✅ Checkpoint tag created


---

Git Checkpoint

git tag alix-a1-1-detection-pipeline-complete

git push origin alix-a1-1-detection-pipeline-complete


---

A1.1 delivers the first operational Pattern Discovery pipeline: X3b evidence + P14 governance signals → immutable detection context → independent pattern observations, while preserving ALiX governance boundaries.