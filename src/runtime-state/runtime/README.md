# Runtime Substrate

## Overview

Shared execution substrate for ALiX: governed execution intent and state transitions, route selection and execution behavior, bounded parallel tool scheduling, replay/rollback, ledger-authoritative continuation and evidence stores, and the read-only runtime event index. Local and daemon adapters delegate route behavior here so one implementation owns dispatch semantics.

## Interface

- `ExecutionDecision`, `ExecutionDecisionRequest`, `decisionAllowed`, `decisionDenied`, `decisionApprovalRequired` — the typed authorization verdict surface [execution-decision.ts:ExecutionDecision].
- `ExecutionAuthorization` — evaluates policy, approval lifecycle, and ownership before an allowed decision [execution-authorization.ts:ExecutionAuthorization].
- `createExecutionIntent` — freezes a routed task into an immutable, deterministic execution intent [execution-intent-factory.ts:createExecutionIntent].
- `ExecutionStateMachine` — the governed execution lifecycle controller implementing `ExecutionRuntime` [execution-state-machine.ts:ExecutionStateMachine].
- `ExecutionGovernorImpl` — validates and authorizes an `ExecutionSession` before execution [execution-governor.ts:ExecutionGovernorImpl].
- `executeRoute`, `RuntimeExecutor`, `LocalRuntimeExecutor` — the route dispatch seam and local adapter [route-executor.ts:executeRoute].
- `executeDirectBehavior`, `executeChatBehavior`, `executeToolBehavior`, `executeGroundedChatBehavior` — the single shared behavior implementations used by local and daemon adapters [route-execution.ts:executeGroundedChatBehavior].
- `taskRouter`, `isGroundedChatTask`, `TaskRoute`, `RouteDiagnostic` — pure task classification into direct, tool, chat, grounded-chat, and agent routes [task-router.ts:taskRouter].
- `scheduleToolCalls`, `canParallelize`, `effectiveParallel`, `createToolExecutionPolicy` — concurrency-aware serial or bounded-parallel dispatch [tool-scheduler.ts:scheduleToolCalls].
- `CancellationToken`, `ExecutionCancelledError`, `isCancellationError`, `raceWithCancellation` — explicit cancellation propagation [cancellation-token.ts:CancellationToken].
- `createCorrelationContext`, `createCorrelatedToolCall`, `assertValidCorrelation` — execution to invocation to tool-call correlation [tool-correlation.ts:createCorrelationContext].
- `ReplayExecutor`, `ReplayPlan`, `buildReplayPlan` — dry-run, sandbox, and approved-live replay [replay-executor.ts:ReplayExecutor].
- `RollbackExecutor`, `RollbackPlan`, `buildRollbackPlan` — dry-run and approved-live rollback with resume support [rollback-executor.ts:RollbackExecutor].
- `ContinuationStore`, `PendingContinuation`, `reconcileContinuationLedger` — pending approval continuation persistence and read-only reconciliation [continuation-store.ts:ContinuationStore].
- `ExecutionEvidenceStore`, `ReplayStatusIndex`, `reconcileReplayLedger`, `reconcileEvidenceLedger` — ledger-backed execution evidence and replay status [runtime-evidence-ledger-reconcile.ts:reconcileReplayLedger].
- `ToolOperationAuthority` — ledger-backed claim and completion receipts for tool operations [tool-operation-authority.ts:ToolOperationAuthority].
- `WorkspacePathResolver`, `relativeIsOutside` — the central lexical and symlink-aware workspace containment boundary [workspace-path.ts:WorkspacePathResolver].
- `buildRuntimeIndex`, `RuntimeIndex` — cached, bounded, read-only aggregation across audit, governance, approval, graph, session, and daemon-task backends [runtime-index.ts:buildRuntimeIndex].
- `RuntimeBuilder`, `Runtime` — resource construction and the runtime handle exposed to callers [runtime-builder.ts:RuntimeBuilder].
- `buildRuntimeDiagnostic`, `measurePhase`, `withRetry`, `withTimeout` — diagnostics, timing, retry, and bounded side-effect helpers [runtime-diagnostics.ts:buildRuntimeDiagnostic].
- `context/` — state-aware prompt builder [./context/README.md](./context/README.md).
- `contracts/` — execution, context, event, memory, observability, provider, and tool contracts [./contracts/README.md](./contracts/README.md).
- `execution-state/` — ExecutionState contract, projector, emitter, store, and ledger reconciliation.
- `state/` — governed patch-only transition harness and policy governor.

## Invariants

- State transitions follow the fixed adjacency table; `SUCCEEDED`, `CANCELLED`, and `ROLLED_BACK` are terminal, while `FAILED` may still move to `ROLLED_BACK` [execution-state-machine.ts:ExecutionStateMachine].
- Every transition emits execution evidence, and cancellation is accepted only from `READY` or `RUNNING` [execution-state-machine.ts:ExecutionStateMachine].
- Creating an intent freezes the intent and nested constraints; identical inputs yield the same intent identity, and synthesized `auto:` approvals are system-authored rather than operator-authored [execution-intent-factory.ts:createExecutionIntent].
- Cancellation is one-way: a token transitions from active to cancelled once and never back [cancellation-token.ts:CancellationToken].
- Parallel scheduling requires model capability, harness allowlisting, more than one call, and every tool marked safe; unknown or exclusive concurrency fails closed to serial [tool-scheduler.ts:canParallelize].
- `maxParallel` is clamped to the range 1 through 4, and larger safe batches are chunked while preserving input order [tool-scheduler.ts:createToolExecutionPolicy].
- A tool operation claim is not proof that an effect occurred; authority distinguishes execute, completed, unknown, and mismatch decisions [tool-operation-authority.ts:ToolOperationAuthority].
- Continuations are ledger-authoritative: the ledger append commits before in-memory mutation and file projection, and ledger errors throw rather than falling back to JSON-only state [continuation-store.ts:ContinuationStore].
- Execution evidence is appended to the ledger before the JSONL projection; duplicate evidence identifiers remain legal under the append-only contract [execution-evidence-store.ts:ExecutionEvidenceStore].
- Replay supports `dry-run`, `sandbox`, and `approved-live`; network effects are blocked outside approved-live, and approved-live shell and file deletion require exact per-step live approvals [replay-executor.ts:ReplayExecutor].
- Rollback refuses a partial rollback without resume, skips completed paths on resume, and reports an already-completed rollback as a no-op [rollback-executor.ts:RollbackExecutor].
- Workspace containment rejects `..` escapes, absolute remainders outside the root, and symlink targets outside the canonical root [workspace-path.ts:relativeIsOutside].
- Grounded retrieval is bounded by `GROUNDED_MAX_TOOL_ROUNDS`, accepts at most one allowlisted call per round, and serves a repeated URL fetch from the turn cache [route-execution.ts:executeGroundedChatBehavior].
- Non-substantive grounded synthesis is replaced by an explicit insufficient-data result instead of being returned as an answer [route-execution.ts:isNonSubstantiveSynthesis].
- Route diagnostics are observational only: callback failures are swallowed and no diagnostic is persisted [route-executor.ts:executeRoute].
- The runtime index uses per-source caps, a bounded cache, and a session-event allowlist; unreadable sources are omitted rather than failing the index [runtime-index.ts:buildRuntimeIndex].
- `RuntimeBuilder.close()` releases the subagent manager, checkpoint manager, and event log in reverse creation order [runtime-builder.ts:RuntimeBuilder].
- `withTimeout` bounds waiting but does not cancel the underlying side effect [side-effect-timeout.ts:withTimeout].

## Side Effects

- Session runtime construction initializes `.alix/sessions/<id>` event-log and checkpoint storage and may construct a subagent manager [runtime-builder.ts:RuntimeBuilder].
- Continuation changes append ledger facts and may write `.alix/approvals/continuations.json`; projection failures are counted separately from ledger failures [continuation-store.ts:ContinuationStore].
- Replay status and execution evidence append ledger facts and project to workspace JSON/JSONL files [replay-status-index.ts:ReplayStatusIndex].
- Approved-live replay may execute shell, file create/update/delete, patch, and approved network tools, and records effects in the effect journal [replay-executor.ts:ReplayExecutor].
- Approved-live rollback may restore or delete files and acquires a replay lock plus progress records [rollback-executor.ts:RollbackExecutor].
- Authorization decisions append audit records and `authorization.evaluated` events when stores are supplied; append failures are caught [execution-authorization.ts:ExecutionAuthorization].
- Grounded and tool routes lazily construct providers and the tool executor, perform provider calls, and may execute allowlisted tools [route-execution.ts:executeToolBehavior].
- Runtime index construction reads storage files and updates a module-local source cache keyed by modification time and size [runtime-index.ts:buildRuntimeIndex].
- Timing events are best-effort appends; an append failure never fails the measured work [timing-events.ts:measurePhase].
- Diagnostics are emitted to configured sinks, while `consoleSink` writes through the console [runtime-diagnostics.ts:consoleSink].

## Verification

- Run: `pnpm test`
