# Evolution Execution Contracts

## Overview
Defines the A4 governed-evolution execution artifact types shared by planning, execution, rollback, and governance evidence: environments, steps, plans, contexts, checkpoints, reports, and immutable execution evidence. The types keep the operator's request separate from the governance approval that authorizes execution.

## Interface
- `ExecutionRequest` — operator intent (`requestId`, `evolutionId`, `requestedBy`, `requestedAt`, optional `reason`) with no approval authority of its own [execution-request.ts:ExecutionRequest].
- `ExecutionEnvironment`, `ExecutionStep`, `RollbackStep`, `ExecutionPlan` — immutable plan and environment artifacts; rollback steps declare `"automatic" | "manual" | "impossible"` and a `safe` flag [execution-contract.ts:RollbackStep].
- `ExecutionContext`, `ExecutionCheckpoint`, `ExecutionStepResult`, `RollbackResult`, `ExecutionReport` — runtime state, checkpoint hashes, per-step outcomes, and the final report [execution-contract.ts:ExecutionReport].
- `EvolutionExecutionEvidence` — immutable governance-facing evidence with `evidenceClass: "executed"`, the plan, the report, the environment, lineage, integrity hash, and expiry [execution-contract.ts:EvolutionExecutionEvidence].
- `ExecutionAuthorizationResult` — discriminated union of `{ allowed: true; decisionId }` or `{ allowed: false; reason }` [execution-contract.ts:ExecutionAuthorizationResult].
- `ExecutionState`, `EXECUTION_TERMINAL_STATES`, `EXECUTION_ALL_STATES`, `isValidExecutionState`, `isExecutionTerminal` — the execution lifecycle vocabulary and guards [execution-lifecycle.ts:ExecutionState].
- Validators: `validateExecutionStep`, `validateRollbackStep`, `validateExecutionPlan`, `validateExecutionReport`, `validateEvolutionExecutionEvidence` [execution-contract.ts:validateEvolutionExecutionEvidence].

## Invariants
- Execution evidence always carries `evidenceClass: "executed"`; the validator rejects any other class [execution-contract.ts:validateEvolutionExecutionEvidence].
- `ExecutionReport.status` must be one of `completed`, `failed`, `rolled_back`, or `partial`; `partial` is documented as reserved for future use [execution-contract.ts:validateExecutionReport].
- Rollback steps must reference a forward step (`forwardStepId`), declare a valid rollback type, and carry a boolean `safe` flag [execution-contract.ts:validateRollbackStep].
- A plan requires non-empty `planId`, `proposalId`, `proposalHash`, `decisionId`, `decisionHash`, `environmentHash`, and `integrityHash`, plus `steps` and `rollbackPlan` arrays [execution-contract.ts:validateExecutionPlan].
- Execution evidence requires a non-empty `expiresAt` and arrays/objects for plan, report, environment, and lineage [execution-contract.ts:validateEvolutionExecutionEvidence].
- Terminal states are `completed`, `failed`, and `rolled_back`; once reached no further transitions should occur [execution-lifecycle.ts:EXECUTION_TERMINAL_STATES].
- The lifecycle runs `pending → planning → approved → executing → completed`, with `rolling_back → rolled_back` and failure branches [execution-lifecycle.ts:ExecutionState].

## Side Effects
- ["None"] — these modules export types and pure structural validators only [execution-contract.ts:validateExecutionPlan].

## Verification
- Run: `pnpm test`
