# Task Run Orchestration (`src/execution/run`)

## Overview

`src/execution/run` holds the run-level orchestration layer above the task
loop: the shared run contracts (`RunResult`, `RunOpts`, `EXIT_CODES`), the
model-facing tool surface construction (including the single read-only tool
filter derivation), the tool-call and approval event handlers, context-pressure
tracking, a progress ledger, the intent classifier, and the plan
generation/approval phase with its on-disk plan and task sidecar.

The iteration loop itself lives in `./task-loop/`; this package re-exports that
surface through `task-loop.ts` and the `index.ts` barrel.

## Interface

- Barrel re-exports `runTask`, `EXIT_CODES`, mutation-path helpers, and the run contracts `[index.ts]`.
- `SharedSession`, `RunResult`, `ContextPressure`, `RunOpts`, `EXIT_CODES` `[run-contract.ts:RunOpts]` `[run-contract.ts:EXIT_CODES]`.
- `BASE_TOOLS`, `READ_ONLY_TOOL_NAMES`, `READ_ONLY_EXCLUDED_TOOL_NAMES`, `buildReadOnlyToolFilter` `[helpers.ts:buildReadOnlyToolFilter]`.
- `promptUser`, `saveDecisionsToMemory`, `streamToResponse`, `buildToolsForProvider`, `continueTruncatedGeneration`, `buildStateSummary`, `patchFormatDescription`, `patchTextDescription` `[helpers.ts:streamToResponse]`.
- `EventHandlerDeps`, `handleMcpToolSearch`, `handleShedToolCall`, `handleScopeExpansion`, `buildScopeDenialMessage`, `buildScopeRejectionSummary`, `handleToolCall` `[event-handlers.ts:handleToolCall]`.
- `createContextPressureTracker` `[context-pressure.ts:createContextPressureTracker]`.
- `ProgressLedger`, `LedgerStatus`, `LedgerEntry`, `LedgerSection` `[progress-ledger.ts:ProgressLedger]`.
- `AgentIntent`, `IntentClassifier` `[intent-classifier.ts:IntentClassifier]`.
- `PlanDecision`, `PlanApprovalRequest`, `PlanApprovalGate` `[plan-approval-gate.ts:PlanApprovalGate]`.
- `runApprovalLoop`, `PlanApprovalIO` `[plan-approval.ts:runApprovalLoop]`.
- `persistPlanTaskSidecar`, `clearPlanTaskSidecar`, `runPlanPhase`, `openPlanInEditor`, `summarisePlan`, `PlanPhaseResult`, `PlanApprovalMode` `[plan-phase.ts:runPlanPhase]` `[plan-phase.ts:persistPlanTaskSidecar]`.
- Task loop surface: `runTaskLoop`, `TaskLoopDeps`, and predicate helpers re-exported from `./task-loop/README.md` `[task-loop.ts]`.
- Child contract: [task-loop](./task-loop/README.md).

## Invariants

- `RunResult.reason` is a closed terminal set: `completed`, `completed_unverified`, `max_repairs`, `max_iterations`, `rejected_scope_expansion`, `context_budget_overflow` `[run-contract.ts:RunResult]`.
- `RunResult.contextBudgetOverflow` is explicitly in-process diagnostic data — not a serializable wire contract, and consumers must not rely on `instanceof` or stack traces `[run-contract.ts:RunResult]`.
- `EXIT_CODES.REJECTED_SCOPE_EXPANSION` is `3` `[run-contract.ts:EXIT_CODES]`.
- The read-only filter starts from `READ_ONLY_TOOL_NAMES`, which includes `alix_verify_claim`, and removes only `alix_shell_run`, then adds caller extras `[helpers.ts:READ_ONLY_TOOL_NAMES]` `[helpers.ts:READ_ONLY_EXCLUDED_TOOL_NAMES]` `[helpers.ts:buildReadOnlyToolFilter]`.
- Tool names are resolved against the exact offered set before dispatch; an unknown or unoffered name returns a `name-not-offered` error listing the offered names `[event-handlers.ts:handleToolCall]`.
- Bound tools pass through `authorizeBoundTool`; an ask decision without a durable approval id fails closed rather than executing `[event-handlers.ts:handleToolCall]`.
- Search guarding uses two tiers: an exact-normalized-signature repeat limit of 3 and a hard per-tool search cap of 8 `[event-handlers.ts:SEARCH_REPEAT_LIMIT]` `[event-handlers.ts:SEARCH_TOOL_CALL_LIMIT]`.
- Scope expansion auto-approves in `auto`/`bypass` modes, prompts on a TTY, and denies with a logged skip when non-TTY ask mode cannot obtain a decision `[event-handlers.ts:handleScopeExpansion]`.
- Approval waits poll every 500ms with a 5-minute hard timeout, support cross-process store reads, reject corrupt/expired authority, and emit progress marks `[event-handlers.ts:waitForApproval]`.
- Truncation continuation is bounded at 4 segments; only the latest segment is appended to the conversation, and continuation stops on empty text, any tool calls, a clean finish reason, or budget exhaustion `[helpers.ts:TRUNCATION_CONTINUATION_LIMIT]` `[helpers.ts:continueTruncatedGeneration]`.
- Streaming races provider iteration against a fallback `complete()` and the operator abort signal so cancellation is honored `[helpers.ts:streamToResponse]`.
- Intent classification observes only tool calls: validation outranks mutation, mutation outranks research, unknown tools default to research, unknown shell commands count as mutation, and the mode is sticky until two consecutive contradictory iterations `[intent-classifier.ts:IntentClassifier]`.
- The plan gate is one-at-a-time by contract, and `resolve(planId, ...)` is keyed by `planId` so a stale resolve cannot bleed into the next request `[plan-approval-gate.ts:PlanApprovalGate]`.
- The plan approval loop handles approve/reject/edit/detail for at most 10 rounds; reject or an empty edit clears the task sidecar, and exhausted rounds reject `[plan-approval.ts:runApprovalLoop]`.
- The plan file is written to `.alix/plans/<sessionId>.md` and the structured sidecar to `.alix/plans/<sessionId>.tasks.json`; an empty task list deletes any stale sidecar and sidecar failures are non-fatal warnings `[plan-phase.ts:runPlanPhase]` `[plan-phase.ts:persistPlanTaskSidecar]`.
- Interactive plan approval without a TTY and without a gate skips plan generation entirely; read-only, shell, and claim-verification tasks also skip it `[plan-phase.ts:runPlanPhase]`.
- `openPlanInEditor` resolves `$VISUAL`, then `$EDITOR`, then `vim`, supports editor strings with arguments, and returns `null` on launch failure or a missing file `[plan-phase.ts:openPlanInEditor]`.
- `summarisePlan` returns the first non-empty line, strips leading heading markers, and caps the summary at 200 characters `[plan-phase.ts:summarisePlan]`.
- The progress ledger timestamps entries with `Date.now()`, renders the last N entries across sections, and `reset()` clears all state `[progress-ledger.ts:ProgressLedger]`.

## Side Effects

- Appends agent/session events and mutates session scope through the handlers `[event-handlers.ts:handleToolCall]` `[event-handlers.ts:handleScopeExpansion]`.
- Executes tools and polls approval state with progress callbacks while waiting `[event-handlers.ts:waitForApproval]`.
- Writes to stdout on verbose tool output, interactive approval, and editor launches `[event-handlers.ts:handleToolCall]` `[plan-phase.ts:runPlanPhase]`.
- Writes and deletes plan artifacts on disk under `.alix/plans/` `[plan-phase.ts:runPlanPhase]` `[plan-phase.ts:persistPlanTaskSidecar]`.
- Issues provider calls during plan generation and may synchronously spawn an external editor `[plan-phase.ts:runPlanPhase]` `[plan-phase.ts:openPlanInEditor]`.

## Verification

- Run: `pnpm test`
