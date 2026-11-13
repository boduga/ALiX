# Agent Session Engine

## Overview
`AgentSession` is the shared session engine behind `alix run`, `alix run --chat`, and the TUI. One session is one logical conversation: the first turn runs the full setup pipeline (agent init, workflow graph, memory, skills, context/plan, tools, system prompt), and later turns reuse that state while accumulating messages. The implementation lives here in phase modules; `../session.ts` is a pure re-export barrel that preserves the original public import surface.

## Interface
- `SessionPhase` — six string-valued lifecycle phases (`Understanding`, `Planning`, `Executing`, `Verifying`, `Summarizing`, `Idle`) observed by the TUI `[types.ts:SessionPhase]`.
- `Message`, `ToolExecution`, `AgentTurnResult`, `ToolResult`, `AgentSessionEvents`, `AgentSessionState`, `AgentSessionConfig`, `PlanConfig`, `ChatConfig`, `PersistenceConfig`, `EventConfig`, `ToolConfig` — session data contracts `[types.ts:AgentSessionConfig]`.
- `AgentSession` — public surface: `processTurn`, `runCoordination?`, `processChat`, `getSessionId`, `getMode?`/`setMode?`, `getVersion?`, `getState`, `getPhase?`, `getLiveness?`, `getActivity?`, `cancelActiveTurn?`, `getLastCancelSummary?`, `save`, `resume`, `setPlanApprovalGate?` `[types.ts:AgentSession]`.
- `CoordinationRunRequest` — `goal` plus optional `maxConcurrency` `[types.ts:CoordinationRunRequest]`.
- `AgentSessionBuilder` — fluent builder (`withPlan`, `withChat`, `withPersistence`, `withEvents`, `withTools`, `build`) `[main.ts:AgentSessionBuilder]`.
- `createSessionState(config)` / `SessionState` — all mutable per-session state `[state.ts:createSessionState]`.
- `initialize(state)` — first-turn setup pipeline P0–P9 `[init.ts:initialize]`.
- `processTurn` / `processTurnBody` / `runCoordination` `[turn.ts:processTurn]`.
- `processChat` / `processChatBody` / `runSearch` / `ensureChatProvider` `[chat.ts:processChat]`.
- `resumeSession` / `restoreReconstructedPlanTasks` `[resume.ts:resumeSession]`.
- `acquireSessionTurn(state)` — single foreground turn owner `[turn-guard.ts:acquireSessionTurn]`.
- `feedActivity`, `advancePhase`, `getPhase`, `getLiveness`, `getActivity`, `cancellationInProgress`, `cancelActiveTurn` `[activity.ts:cancelActiveTurn]`.
- `setupSession`, `setupWorkflow`, `setupResume`, `setupMemory`, `setupSkills`, `setupContextLimits`, `setupContextAndPlan`, `setupTools`, `setupSystemPrompt`, `setupHooks`, `resolveExplicitSkills`, `buildSkillsSection`, `spliceSkillsSection`, `spliceExplicitIntoFirstTurn`, `createAgentSession` `[setup.ts:setupSession]`.
- `readVersionCached`, `walkForPackageJson`, `livenessEventType`, `isCancellationError`, `buildSessionStreamHandler`, `emitSessionEvents`, `extractToolResultsFromMessages` `[helpers.ts:readVersionCached]`.
- `buildSessionConversationMessages` / `latestSubstantiveSessionRequest` `[conversation-history.ts:buildSessionConversationMessages]`.
- Public re-export barrel: [../session.ts](../session.ts).

## Invariants
- One foreground turn per session: `acquireSessionTurn` throws `Session is busy with an active turn.` while held and returns a release function; `processTurn` and `processChat` both wrap their body in `try/finally` release `[turn-guard.ts:acquireSessionTurn]`.
- `runCoordination` rejects an empty objective, a non-integer or out-of-range `maxConcurrency` (must be 1–8), and any attempt to run in a read-only session `[turn.ts:runCoordination]`.
- Prior conversation is bounded to 24 public messages, 8 000 JSON characters per value, and 24 000 characters overall; tool payloads, ledgers, nudges, and private reasoning are excluded `[conversation-history.ts:buildSessionConversationMessages]`.
- Historical requests are labeled data, never current instructions; the final user message remains the current objective and old claims are never verification evidence `[conversation-history.ts:publicContent]`.
- Explicit bare continuation resolves to the latest substantive public user request, ignoring continuation prompts and runtime messages `[conversation-history.ts:latestSubstantiveSessionRequest]`.
- `save(options?)` is non-interactive by default: `confirm` is `options?.interactiveDecisions === true`, so headless/daemon/CI callers never read stdin `[main.ts:save]`.
- Decision-memory extraction and `SessionStore.save` failures are swallowed and logged, never propagated from `save()` `[main.ts:save]`.
- `setupTools` appends the execution-state proposal tool only when `isExecutionStateSendEnabled()` is true, matching the loop-side interception gate `[setup.ts:setupTools]`.
- `setupTools` filters provider tools through `buildReadOnlyToolFilter()` for read-only tasks and `READ_ONLY_TOOL_NAMES` for shell tasks `[setup.ts:setupTools]`.
- `resumeSession` is a no-op when `state.ctx` is unset; it prefers a wired `SessionStore` snapshot and falls back to `reconstructSession`, setting `sessionCompleted` from the restored record `[resume.ts:resumeSession]`.
- `ensureChatProvider` memoizes `chatReady` and returns `null` for a missing chat model or a failed provider construction `[chat.ts:ensureChatProvider]`.
- `runSearch` returns `""` on timeout (2 000 ms), on a rejecting search tool, or when no search tool is configured `[chat.ts:runSearch]`.
- `processChat` classifies only `reason === "chat-error"` as a trace error; every other outcome, including the no-provider placeholder, is a successful invocation `[chat.ts:processChat]`.
- Direct and grounded-chat turns push their user/assistant pair onto `state.messages` and update `sessionGoal` only for non-continuation input `[turn.ts:processTurn]`.
- `getPhase`/`getLiveness`/`getActivity`/`cancelActiveTurn` are optional on the interface so pre-existing test stubs remain valid `[types.ts:AgentSession]`.

## Side Effects
- `initialize` starts a trace run scope and appends workflow/session events to `state.ctx.log`, including `workflow.completed` for an already-completed resume and `session.resumed` on resume `[init.ts:initialize]`.
- `processTurn` calls `traceClient.startRun` and closes it through `withTraceRun` exactly once, mapping cancellation to a normal terminal `[turn.ts:processTurn]`.
- `save()` reads the full session event log, extracts memory decisions, and writes a `SessionStore` snapshot when a store is configured `[main.ts:save]`.
- `resumeSession` reads from `SessionStore` or the on-disk reconstruction path and appends a resume event through the session log `[resume.ts:resumeSession]`.
- `cancelActiveTurn` flips the turn's cancellation token and aborts the shared `AbortSignal`, transitioning activity to `cancelling` `[activity.ts:cancelActiveTurn]`.
- `AgentSessionBuilder.build()` mutates the seed config (`withPlan`, `withChat`, `withPersistence`, `withEvents`, `withTools`) and returns a `AgentSession` bound to one `SessionState` `[main.ts:AgentSessionBuilder]`.
- `setupSystemPrompt` composes the bounded `## Self Model` and `## Your Capabilities` blocks into the system prompt `[setup.ts:setupSystemPrompt]`.

## Verification
- Run: `pnpm test`
