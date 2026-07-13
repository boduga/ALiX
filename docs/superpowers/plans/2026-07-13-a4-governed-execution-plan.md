# A4 — Governed Evolution Execution Implementation Plan

> **Phase:** A4 — Governed Evolution Execution
> **Status:** Final Implementation Plan
> **Goal:** Introduce a governed execution capability that faithfully applies governance-approved evolution proposals under deterministic control, producing complete execution evidence with immutable lineage.

---

# 1. Objective

A4 introduces the first **mutation-capable evolution phase** in ALiX.

Previous phases:

```
A0  Evolution Contract
A1  Pattern Discovery
A2  Evolution Verification
A3  Evolution Governance
```

produce approved evolution intent.

A4 converts approved intent into controlled execution:

```
EvolutionProposal
        │
        ▼
GovernanceDecision(APPROVE)
        │
        ▼
ExecutionAuthorization
        │
        ▼
ExecutionPlan
        │
        ▼
GovernedExecutionRuntime
        │
        ▼
ExecutionReport
        │
        ▼
EvolutionExecutionEvidence
```

A4 does not decide **what should change**.

A4 only executes **what governance already approved**.

---

# 2. Architectural Invariants

## Governance Gate

Execution MUST NOT occur unless:

```
GovernanceDecision.kind === APPROVE
```

Any other state:

```
PENDING
REJECT
EXPIRED
REVOKED
```

must prevent execution.

---

## Proposal Fidelity

A4 MUST:

* execute approved proposal exactly
* preserve proposal ordering
* preserve proposal parameters
* never optimize
* never reinterpret
* never introduce additional mutations

---

## Deterministic Planning

The planner MUST satisfy:

```
same proposal
+
same decision
+
same environment

=

same ExecutionPlan
```

---

## Sequential Execution

Execution ordering is mandatory:

```
Step 1
 ↓
Step 2
 ↓
Step 3
 ↓
...
```

No parallel mutation execution.

---

## Rollback Guarantee

Every mutation step MUST have a rollback strategy:

```
ExecutionStep
      │
      ▼
RollbackStep
```

Rollback may be:

```
automatic
manual
impossible
```

---

## Evidence Integrity

All execution evidence requires:

```
SHA-256
+
domain prefix

alix-evolution-execution-v1:
```

---

## Complete Lineage

Execution evidence MUST preserve:

```
Proposal
   ↓
Governance Decision
   ↓
Execution Plan
   ↓
Execution Report
```

---

# 3. File Structure

## New Files

```
src/evolution/execution/

├── contracts/
│   ├── execution-contract.ts
│   ├── execution-lifecycle.ts
│   └── execution-request.ts
│
├── execution-authorization.ts
├── execution-planner.ts
├── execution-runtime.ts
├── execution-evidence-bridge.ts
├── execution-cli.ts
└── index.ts
```

Tests:

```
tests/evolution/execution/

├── execution-contract.test.ts
├── execution-authorization.test.ts
├── execution-planner.test.ts
├── execution-runtime.test.ts
├── execution-evidence-bridge.test.ts
├── execution-rollback.test.ts
└── integration/
    └── execution-integration.test.ts
```

---

# 4. Modified Files

## Evidence Contract Extension

File:

```
src/evolution/contracts/evolution-contract.ts
```

Change:

```typescript
export type EvidenceClass =
  | "observed"
  | "derived"
  | "projected"
  | "executed";
```

Update:

```typescript
VALID_EVIDENCE_CLASSES
```

to include:

```typescript
"executed"
```

---

# Task 1 — A4.0 Execution Contract Foundation

## Purpose

Create immutable execution contracts shared by all A4 components.

---

## Files

Create:

```
execution-contract.ts
execution-lifecycle.ts
execution-request.ts
```

---

# Execution Lifecycle

```typescript
export type ExecutionState =
 | "pending"
 | "planning"
 | "approved"
 | "executing"
 | "completed"
 | "failed"
 | "rolling_back"
 | "rolled_back";
```

Terminal states:

```typescript
[
 "completed",
 "failed",
 "rolled_back"
]
```

---

# ExecutionRequest

Separates operator request from governance approval.

```typescript
export interface ExecutionRequest {

 requestId:string;

 evolutionId:string;

 requestedBy:string;

 requestedAt:string;

 reason?:string;

}
```

---

# ExecutionEnvironment

```typescript
export interface ExecutionEnvironment {

 environmentId:string;

 environmentHash:string;

 runtimeVersion:string;

 agentConfiguration:
   Record<string,string>;

 baselineMetrics:
   Record<string,number>;

 capabilityFingerprint:string;

}
```

---

# ExecutionStep

```typescript
export interface ExecutionStep {

 stepId:string;

 operation:string;

 parameters:
   Record<string,unknown>;

 idempotent:boolean;

 preconditions:
   Record<string,unknown>;

 postconditions:
   Record<string,unknown>;

}
```

---

# RollbackStep

```typescript
export interface RollbackStep {

 stepId:string;

 forwardStepId:string;

 operation:string;

 parameters:
   Record<string,unknown>;

 rollbackType:
   "automatic"
   |
   "manual"
   |
   "impossible";

 safe:boolean;

}
```

---

# ExecutionPlan

```typescript
export interface ExecutionPlan {

 planId:string;

 proposalId:string;

 proposalHash:string;

 decisionId:string;

 decisionHash:string;

 environmentHash:string;

 steps:
   readonly ExecutionStep[];

 rollbackPlan:
   readonly RollbackStep[];

 integrityHash:string;

}
```

---

# ExecutionContext

```typescript
export interface ExecutionContext {

 executionId:string;

 state:ExecutionState;

 checkpoints:
   readonly ExecutionCheckpoint[];

 outputs:
   Record<string,unknown>;

}
```

---

# ExecutionCheckpoint

```typescript
export interface ExecutionCheckpoint {

 stepId:string;

 inputHash:string;

 outputHash:string;

 environmentHash:string;

 timestamp:string;

}
```

---

# ExecutionReport

```typescript
export interface ExecutionReport {

 reportId:string;

 planId:string;

 executionId:string;

 status:
  | "completed"
  | "failed"
  | "rolled_back"
  | "partial";

 stepResults:
   readonly ExecutionStepResult[];

 startedAt:string;

 completedAt:string;

 rollbackTriggered:boolean;

 rollbackResult?:RollbackResult;

}
```

---

# EvolutionExecutionEvidence

```typescript
export interface EvolutionExecutionEvidence {

 evidenceId:string;

 evidenceClass:"executed";

 proposalId:string;

 decisionId:string;

 executionPlan:ExecutionPlan;

 executionReport:ExecutionReport;

 environment:ExecutionEnvironment;

 lineage:readonly LineageRecord[];

 integrityHash:string;

 expiresAt:string;

}
```

---

# Validators

Implement:

```typescript
validateExecutionPlan()

validateExecutionReport()

validateEvolutionExecutionEvidence()
```

using existing A0/A2 ValidationResult pattern.

---

# Tests

Must verify:

* contract acceptance
* invalid contract rejection
* lifecycle completeness
* EvidenceClass extension
* terminal states
* validation failures

---

# Task 2 — A4.0 Execution Authorization Gate

## Purpose

Create mandatory execution gate.

---

File:

```
execution-authorization.ts
```

---

Consumes:

```
ExecutionRequest
GovernanceDecision
EvolutionProposal
```

Produces:

```
ExecutionAuthorizationResult
```

---

Interface:

```typescript
export type ExecutionAuthorizationResult =
 | {
    allowed:true;
    decisionId:string;
 }
 | {
    allowed:false;
    reason:string;
 };
```

---

Validation sequence:

1. Decision exists
2. Decision is APPROVE
3. Integrity hash valid
4. Proposal matches decision
5. Decision not expired
6. Decision not revoked
7. Execution not already completed

---

Tests:

* valid approval succeeds
* missing decision rejected
* rejected decision rejected
* expired decision rejected
* revoked decision rejected
* duplicate execution rejected
* successful authorization returns decisionId

---

# Task 3 — A4.1 Execution Planner

## Purpose

Create deterministic execution plans.

---

File:

```
execution-planner.ts
```

---

Input:

```typescript
interface PlanFromDecisionInput {

 proposal:EvolutionProposal;

 decision:GovernanceDecision;

 environment:ExecutionEnvironment;

}
```

Output:

```
ExecutionPlan
```

---

Planner guarantees:

* deterministic ordering
* deterministic hashing
* rollback coverage

---

## Rollback Resolver

Introduce abstraction:

```typescript
export interface RollbackResolver {

 createRollback(
   step:ExecutionStep
 ):RollbackStep;

}
```

---

Default resolver:

Supported:

```
upgrade_agent_runtime
update_configuration
```

Fallback:

```
manual_recovery:<operation>
```

---

Tests:

* deterministic plan generation
* different proposals differ
* different environments differ
* rollback generated for every step
* rollback ordering reversed
* integrity hash valid
* max step enforcement

---

# Task 4 — A4.2 Governed Execution Runtime

## Purpose

Execute approved plans safely.

---

File:

```
execution-runtime.ts
```

---

Configuration:

```typescript
export interface RuntimeConfig {

 enableRollback:boolean;

 maxRetries:number;

}
```

Default:

```typescript
{
 enableRollback:true,
 maxRetries:1
}
```

---

Runtime:

```typescript
class GovernedExecutionRuntime
```

---

Execution algorithm:

```
START

for each step:

 validate preconditions

 execute step

 validate postconditions

 checkpoint output

 record result


failure:

 stop immediately

 if rollback enabled:

       rollback

 return report


success:

 complete

```

---

Step executor:

```typescript
interface StepExecutor {

 executeStep(
   step:ExecutionStep,
   context:Record<string,unknown>
 ):
 Promise<ExecutionResult>;

}
```

---

Tests:

* ordered execution
* context propagation
* precondition failure
* postcondition failure
* retry idempotent steps
* rollback invocation
* completed report
* failed report
* rolled_back report

---

# Task 5 — A4.3 Execution Evidence Bridge

## Purpose

Convert execution result into immutable evidence.

---

File:

```
execution-evidence-bridge.ts
```

---

Input:

```typescript
interface EvidenceBridgeInput {

 executionPlan:ExecutionPlan;

 executionReport:ExecutionReport;

 environment:ExecutionEnvironment;

 decision:GovernanceDecision;

 proposal:EvolutionProposal;

}
```

---

Output:

```
EvolutionExecutionEvidence
```

---

Hash:

```
SHA256(
 "alix-evolution-execution-v1:"
 +
 canonicalJSON
)
```

Exclude from hash:

* `integrityHash` (self-referencing)
* transient runtime metadata (`runtimeMetadata`, `lastHeartbeat` — must not invalidate evidence when present) 

---

Lineage:

```text
proposal
decision
plan
report
```

---

Tests:

* evidence creation
* executed evidence class
* deterministic hash
* mutation changes hash
* lineage correctness
* expiration handling

---

# Task 6 — A4.4 Rollback & Recovery

## Purpose

Verify failure recovery semantics.

---

Tests:

* rollback reverse order
* partial rollback
* rollback failure
* no rollback configuration
* unrecoverable state
* skipped unexecuted steps
* rollback evidence captured

---

Expected behavior:

Partial rollback:

```
ExecutionReport.status="failed"
```

not:

```
rolled_back
```

because recovery was incomplete.

---

# Task 7 — A4.5 Integration & CLI

## Purpose

Expose governed execution capability.

---

CLI:

```
alix evolution execute <evolution-id>

Options:

--dry-run
--json
```

---

Flow:

```
1. Load evolution
2. Verify APPROVED state
3. Load GovernanceDecision
4. Authorize execution
5. Capture environment
6. Generate plan
7. Dry-run OR execute
8. Generate evidence
9. Persist evidence
10. Output result
```

---

Integration scenarios:

## Success

```
APPROVE
 ↓
PLAN
 ↓
EXECUTE
 ↓
REPORT
 ↓
EVIDENCE
```

Assertions:

* evidenceClass executed
* lineage complete
* hash valid
* report completed

---

## Failure cases

Verify:

* wrong lifecycle state rejected
* missing decision rejected
* dry-run does not mutate
* failed step rolls back

---

# Verification Commands

Unit:

```bash
npx tsx --test tests/evolution/execution/*.test.ts
```

Integration:

```bash
npx tsx --test tests/evolution/execution/integration/*.test.ts
```

Full regression:

```bash
npx tsx --test tests/evolution/*.test.ts tests/evolution/**/*.test.ts
```

Type checking:

```bash
npx tsc --noEmit
```

---

# Final Implementation Order

| Order | Slice                | Result                                 |
| ----- | -------------------- | -------------------------------------- |
| 1     | A4.0 Contracts       | Execution model exists                 |
| 2     | A4.0 Authorization   | Mutation gate exists                   |
| 3     | A4.1 Planner         | Deterministic plans exist              |
| 4     | A4.2 Runtime         | Controlled execution exists            |
| 5     | A4.3 Evidence Bridge | Execution becomes auditable evidence   |
| 6     | A4.4 Rollback        | Failure recovery verified              |
| 7     | A4.5 Integration     | End-to-end governed execution complete |

---

## A4 Completion Criteria

A4 is complete when:

✅ Only approved governance decisions execute
✅ Plans are deterministic
✅ Every mutation has rollback coverage
✅ Runtime executes sequentially
✅ Failures stop execution immediately
✅ Rollback behavior is verified
✅ Execution evidence is cryptographically integrity protected
✅ Full lineage is preserved
✅ CLI execution path works end-to-end
✅ All A-series regression tests pass

**A4 delivers the first fully governed mutation pathway in ALiX.**

