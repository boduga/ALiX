# Evolution Execution (A4)

## Overview
Governed execution of an APPROVED evolution proposal. The package authorizes a
request against its governance decision, derives a deterministic plan with a
parallel rollback plan, drives the plan step-by-step through an injected
`StepExecutor` with checkpointing and fail-safe rollback, and emits immutable
`executed` evidence. A CAP-6 executor applies the five CAP-5 capability
mutations atomically with byte-identical pre-state restore, and an
`alix evolution execute` CLI ties the flow together. The package re-exports
its artifact types from `contracts/`.

## Interface
- `authorizeExecution`, `AuthorizationConfig`, `AuthorizeInput`, `DEFAULT_AUTH_CONFIG` [execution-authorization.ts:authorizeExecution]
- `createExecutionPlan`, `validatePlanConstraints`, `createPlanId`, `PlannerConfig`, `DEFAULT_PLANNER_CONFIG`, `RollbackResolver`, `DefaultRollbackResolver`, `createDefaultRollbackResolver` [execution-planner.ts:createExecutionPlan]
- `GovernedExecutionRuntime`, `StepExecutor`, `RuntimeConfig`, `DEFAULT_RUNTIME_CONFIG`, `TestStepExecutor` [execution-runtime.ts:GovernedExecutionRuntime]
- `buildExecutionEvidence`, `computeExecutionEvidenceHash`, `buildLineage`, `BuildEvidenceInput` [execution-evidence-bridge.ts:buildExecutionEvidence]
- `runExecute`, `createStepExecutor`, `ExecuteDeps`, `ExecuteOptions` [execution-cli.ts:runExecute]
- `CapabilityMutationExecutor`, `CapabilityMutationExecutorOptions`, `CapabilityMutationResult`, `GovernanceRecordSink`, `CapabilityPreState` [capability-mutation-executor.ts:CapabilityMutationExecutor]
- `bumpSemVer`, `applyCapabilityDefinitionPatch`, `nextDefinitionForUpdate`, `toCapabilityMutationChange` [capability-mutation-executor.ts:bumpSemVer], [capability-mutation-executor.ts:nextDefinitionForUpdate]
- `capturePreState`, `restorePreState`, `createCapabilityRollbackResolver` [capability-mutation-executor.ts:capturePreState], [capability-mutation-executor.ts:restorePreState]
- Contracts: [./contracts/README.md](./contracts/README.md) — `ExecutionRequest`, `ExecutionPlan`, `ExecutionReport`, `EvolutionExecutionEvidence`, and the execution lifecycle vocabulary

## Invariants
- Authorization runs eight ordered checks and short-circuits on the first failure: decision exists, kind is `APPROVE`, integrity hash recomputes, request `evolutionId` matches, not expired, not revoked, no duplicate completed execution, then allowed [execution-authorization.ts:authorizeExecution]
- Authorization is pure: no I/O and no store access; `now` is injectable for determinism [execution-authorization.ts:AuthorizeInput]
- Duplicate execution prevention is on by default and rejects a `decisionId` already in `completedExecutionIds` [execution-authorization.ts:DEFAULT_AUTH_CONFIG]
- Plans are deterministic: `planId` and `integrityHash` are SHA-256 over canonical JSON with the `alix-evolution-execution-v1:` domain prefix [execution-planner.ts:createPlanId], [execution-planner.ts:computeIntegrityHash]
- Rollback steps are generated in reverse forward-step order from the same steps array, so counts must match [execution-planner.ts:createExecutionPlan]
- `validatePlanConstraints` requires at least one step, no more than `maxSteps` (default 50), rollback/step count equality, and a matching integrity hash [execution-planner.ts:validatePlanConstraints], [execution-planner.ts:DEFAULT_PLANNER_CONFIG]
- Unknown operations without a registered rollback resolver fall back to a `manual` rollback step with `safe: false` [execution-planner.ts:DefaultRollbackResolver]
- Capability rollback mappings were re-homed to `createCapabilityRollbackResolver`; the generic resolver covers only `upgrade_agent_runtime` and `update_configuration` [execution-planner.ts:createDefaultRollbackResolver]
- The runtime validates precondition keys against accumulated outputs and postcondition keys against the step output before accepting a step [execution-runtime.ts:GovernedExecutionRuntime]
- Retries apply only to idempotent steps and are bounded by `maxRetries` (default 1); non-idempotent steps run once [execution-runtime.ts:DEFAULT_RUNTIME_CONFIG]
- A failed step triggers rollback only when `enableRollback` is true; otherwise the report is finalized as `failed` [execution-runtime.ts:GovernedExecutionRuntime]
- Rollback selects steps by `forwardStepId` from completed forward steps only, so the reversed `rollbackPlan` order is preserved [execution-runtime.ts:rollback]
- A rollback step with `safe: false` is never executed; rollback fails with an explicit unsafe-rollback reason [execution-runtime.ts:rollback]
- Checkpoints are written only after a step succeeds, and both hashes cover post-execution state [execution-runtime.ts:createCheckpoint]
- Execution evidence is always `evidenceClass: "executed"`, expiring 365 days from creation [execution-evidence-bridge.ts:buildExecutionEvidence], [execution-evidence-bridge.ts:DEFAULT_TTL_DAYS]
- The evidence integrity hash excludes `integrityHash` itself and the transient `runtimeMetadata`/`lastHeartbeat` fields [execution-evidence-bridge.ts:computeExecutionEvidenceHash]
- Lineage is an ordered proposal → decision → plan → report chain that drops records with an empty `sourceId` [execution-evidence-bridge.ts:buildLineage]
- `CapabilityMutationExecutor` consumes CAP-5 validation (`validateCapabilityMutation`, `validateConsolidateMerge`, `classifyUpdateBump`) and adds no new mutation semantics [capability-mutation-executor.ts:CapabilityMutationExecutor]
- Each mutation runs prepare → validate → apply → project registry → record → commit; any failure after apply restores the captured pre-state [capability-mutation-executor.ts:CapabilityMutationExecutor]
- Consumed mutation and post artifacts are deep-copied, deep-frozen, and share no reference with live catalog state; `artifactId` hashes those sanitized copies [capability-mutation-executor.ts:commit]
- A throwing governance-record sink restores the pre-state and fails the step [capability-mutation-executor.ts:commit]
- `capability.create` on an existing id fails and directs the caller to update; `capability.update` rejects a stale `sourceVersion`, a no-op patch, and any patch touching `id`/`version`/`kind` [capability-mutation-executor.ts:executeCreate], [capability-mutation-executor.ts:nextDefinitionForUpdate]
- `capability.transition` fails when the actual lifecycle state differs from the decision's `from` [capability-mutation-executor.ts:executeTransition]
- `capability.consolidate` requires sources to resolve, a definition id equal to `target`, and a proposed target version strictly greater than the current one under SemVer comparison [capability-mutation-executor.ts:executeConsolidate]
- The executor is stateless across steps because CAP-6 models one governed mutation per plan; in-plan `capability.restore_*` steps are handled separately [capability-mutation-executor.ts:executeStep]
- `runExecute` requires the evolution to be `APPROVED`, needs a decision store, and selects the most recent `APPROVE` decision [execution-cli.ts:runExecute]
- The CLI without `decisionStore` fails closed with "No governance decision store available" [execution-cli.ts:runExecute]
- `--dry-run` emits the plan and returns before any execution; the CLI's default `createStepExecutor` is a logging stub, not a real mutation path [execution-cli.ts:runExecute], [execution-cli.ts:createStepExecutor]
- Completed decision IDs are tracked in a process-local set, so duplicate prevention spans CLI invocations only within one process lifetime [execution-cli.ts:completedDecisionIds]

## Side Effects
- `runExecute` writes to stdout and sets `process.exitCode = 1` on every failure path, in both JSON and terminal modes [execution-cli.ts:runExecute]
- `runExecute` records the completed decision id in the module-level `completedDecisionIds` set after evidence is built [execution-cli.ts:runExecute]
- `CapabilityMutationExecutor` mutates the injected `CapabilityCatalog` and `CapabilityRegistry` (register/remove/reload/lifecycle/availability), and a failure restores them via `restorePreState` [capability-mutation-executor.ts:executeStep], [capability-mutation-executor.ts:restorePreState]
- The optional `GovernanceRecordSink.record` is awaited inside the atomic commit boundary; it is the only external write the executor performs [capability-mutation-executor.ts:GovernanceRecordSink]
- `executeCreate`, `executeUpdate`, `executeTransition`, `executeConsolidate`, and `executeRemove` each capture and restore pre-state around catalog/registry writes [capability-mutation-executor.ts:capturePreState]
- Planner, authorization, evidence bridge, and runtime modules perform no disk, network, or store I/O; they operate on in-memory artifacts [execution-planner.ts:createExecutionPlan], [execution-authorization.ts:authorizeExecution], [execution-evidence-bridge.ts:buildExecutionEvidence], [execution-runtime.ts:GovernedExecutionRuntime]

## Verification
- Run: `pnpm test`
