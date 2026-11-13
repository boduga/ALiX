# Coordination Kernel

## Overview

The coordination kernel is ALiX's graph runtime and multi-worker orchestration layer. It plans `TaskGraph`s, executes and projects them, dispatches bounded `CoordinationRun` workers with ownership and approval enforcement, and finalizes results through durable ledger-backed state, locks, recovery, collaboration, and replanning.

## Interface

- `TaskGraph`, `TaskNode`, their status unions, and immutable `transitionNodeStatus` / `transitionGraphStatus` helpers [task-graph.ts:transitionNodeStatus]
- `CoordinationRun`, `WorkerAssignment`, worker/run status unions, and `deriveCoordinationCompletion` [coordination-types.ts:CoordinationRunStatus], [coordination-types.ts:deriveCoordinationCompletion]
- `CoordinationScheduler` with bounded concurrency, `SchedulerStopReason`, `runUntilIdle`, and `cancelRun` [coordination-scheduler.ts:MAX_COORDINATION_CONCURRENCY], [coordination-scheduler.ts:SchedulerStopReason]
- Model-facing coordination tools `coordination.run`, `coordination.status`, `coordination.list`, and `coordination.results` through `createCoordinationHandlers` [coordination-tools.ts:createCoordinationHandlers]
- `CoordinationWorkerExecutor` plus the in-process `DefaultWorkerExecutor` and child-process `SubagentWorkerExecutor` implementations [worker-executor.ts:CoordinationWorkerExecutor], [subagent-worker-executor.ts:SubagentWorkerExecutor]
- `GraphExecutor`, graph ledger mirroring, planning, and graph-to-run conversion through `CoordinationPlanner`, `TaskGraphPlanner`, `inferOwnershipScopes`, and `serializeOverlappingWriters` [graph-executor.ts:GraphExecutor], [graph-ledger.ts:mirrorGraphToLedger], [coordination-planner.ts:CoordinationPlanner]
- Completion finalization through `createCompletionService` and `CoordinationCompletionService` [coordination-completion-service.ts:createCompletionService]
- Durable stores and locks: `CoordinationStore`, `CoordinationResultStore`, `CoordinationAggregateStore`, `CoordinationRunLock`, and `CoordinationFinalizationLock` [coordination-store.ts:commitToLedger], [coordination-result-store.ts:CoordinationResultStore], [coordination-aggregate-store.ts:CoordinationAggregateStore], [coordination-run-lock.ts:CoordinationRunLock], [coordination-finalization-lock.ts:CoordinationFinalizationLock]
- Liveness and recovery through `heartbeatStale`, `shouldReclaimWorker`, `reclaimDeadOwnerWorkers`, and `reconcileCoordinationRun` [owner-liveness.ts:shouldReclaimWorker], [coordination-resume.ts:reclaimDeadOwnerWorkers], [coordination-reconciliation.ts:reconcileCoordinationRun]
- Authorization, ownership, evidence, collaboration, and replanning through `authorizeWorker`, `acquireWorkerOwnership`, `deriveCoordinationEvidence`, `CollaborationStore`, `ReplanApprovalGate`, and `ReplanApplier` [coordination-authorization.ts:authorizeWorker], [coordination-ownership.ts:acquireWorkerOwnership], [coordination-evidence.ts:deriveCoordinationEvidence], [collaboration-store.ts:CollaborationStore], [replan-approval-gate.ts:ReplanApprovalGate], [replan-applier.ts:ReplanApplier]

## Invariants

- Execution, aggregation, outcome, and verification are independent completion dimensions; a `completed` run does not imply an aggregate, a known outcome, or verification [coordination-types.ts:deriveCoordinationCompletion]
- `verified` requires a generated aggregate, a `success` outcome, and a durable `coordination.aggregate.completed` event matching the run id, aggregate reference, and source fingerprint [coordination-types.ts:deriveCoordinationCompletion], [coordination-types.ts:matchesAttachedAggregateEvent]
- A coordination result call succeeds only for a terminal `completed` execution with `verified` completion; nonterminal, unreadable, or unverified state returns `outcomeUnknown` instead of a success receipt [coordination-tools.ts:handleCoordinationResults]
- Cancellation is a terminal path that aborts active executions, releases leases, and marks the run and graph cancelled [coordination-scheduler.ts:cancelRun]
- Dispatch is bounded by concurrency and per-worker timeout limits; ownership leases are renewed during execution [coordination-scheduler.ts:MAX_COORDINATION_CONCURRENCY], [coordination-scheduler.ts:DEFAULT_WORKER_TIMEOUT_MS]
- Worker reclaim uses one verdict: only a `running`, not-locally-active worker is reclaimable, and only when its owner is provably dead or an ownerless worker has a stale heartbeat [owner-liveness.ts:shouldReclaimWorker]
- An empty capability set is denied, any denied capability wins, and an approval-required verdict without a durable approval id is denied [coordination-authorization.ts:authorizeWorker]
- Ownership acquisition is all-or-nothing; partial conflicts are rolled back and failed lease releases remain recorded for retry [coordination-ownership.ts:acquireWorkerOwnership], [coordination-ownership.ts:releaseWorkerLeases]
- Mutation evidence comes only from explicit file mutation events or worker-reported mutation paths; worker status and ownership grants are not evidence [coordination-evidence.ts:deriveCoordinationEvidence]
- The runtime ledger is authoritative; a failed ledger append throws, while JSON projections are disposable and projection failures are counted [coordination-store.ts:commitToLedger], [graph-ledger.ts:mirrorGraphToLedger], [graph-ledger.ts:countGraphProjectionFailure]
- Finalization is lock-protected and idempotent: only one contender attaches the aggregate and emits the completion event [coordination-completion-service.ts:CoordinationCompletionService]
- Replanning auto-approves only when impact analysis requires none; otherwise approval binds run, plan revision, draft, impact, and policy inputs [replan-approval-gate.ts:ReplanApprovalGate]
- The applier requires a validated draft as a precondition and commits only when the run's plan revision matches, using compare-and-swap semantics [replan-applier.ts:ReplanApplier]
- Overlapping writers are serialized by ownership planning; malformed ownership yields no trusted write paths [coordination-planner.ts:serializeOverlappingWriters], [worker-role.ts:ownedPathsForWorker]

## Side Effects

- Appends coordination run facts to `.alix/runtime-ledger.db` and writes compatibility projections under `.alix/coordination/` [coordination-store.ts:commitToLedger]
- Appends graph and per-attempt facts to the runtime ledger and writes `.alix/graphs/*.json` projections [graph-ledger.ts:mirrorGraphToLedger], [graph-ledger.ts:graphAttemptEntityId], [graph-planner.ts:persistGraph]
- Creates per-run lock directories under `.alix/coordination/locks/` and finalization locks under `.alix/coordination/results/runs/` [coordination-run-lock.ts:CoordinationRunLock], [coordination-finalization-lock.ts:CoordinationFinalizationLock]
- Writes deterministic worker result files and run aggregate files under `.alix/coordination/results/` using atomic replacement [coordination-result-store.ts:CoordinationResultStore], [coordination-aggregate-store.ts:CoordinationAggregateStore]
- Persists collaboration state and manifests under `.alix/coordination/shared/<runId>/`, with locks at `.alix/coordination/shared/locks/<runId>.lock` [collaboration-store.ts:CollaborationStore], [collaboration-run-lock.ts:CollaborationRunLock]
- Persists replan proposals under `.alix/coordination/replans/<runId>/<proposalId>.json` [replan-proposal-store.ts:ReplanProposalStore]
- Emits `coordination.aggregate.completed` or `coordination.aggregate.failed` events through the configured event sink [coordination-completion-service.ts:CoordinationCompletionService]
- Records scheduler observations through `MetricsSink`; metrics failures never break scheduling [coordination-scheduler.ts:CoordinationSchedulerDeps]
- Acquires and releases ownership-registry leases during worker dispatch and cancellation [coordination-ownership.ts:acquireWorkerOwnership], [coordination-scheduler.ts:cancelRun]
- Executes workers with an `AbortSignal` and writes to `.alix/sessions/<sessionId>/` through the shared worker event log [worker-executor.ts:CoordinationWorkerExecutor], [worker-executor.ts:DefaultWorkerExecutor]

## Verification

- Run: `pnpm test`
