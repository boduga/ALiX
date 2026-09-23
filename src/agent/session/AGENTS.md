# DOX — Agent session

**Purpose:** `AgentSession` — the shared session engine for `run`, `run --chat`,
and the TUI. Extracted from the former `../session.ts` megafile (#717);
`../session.ts` is now a re-export barrel so existing import paths are unchanged.

**Ownership:**
- `types.ts` — `SessionPhase`, `Message`, `ToolExecution`, `AgentTurnResult`,
  `ToolResult`, `AgentSessionEvents`, `AgentSessionState`, `AgentSessionConfig`,
  `PlanConfig`, `ChatConfig`, `PersistenceConfig`, `EventConfig`, `ToolConfig`,
  and the `AgentSession` interface.
- `helpers.ts` — `readVersionCached` / `walkForPackageJson`, `livenessEventType`,
  `isCancellationError`, `buildSessionStreamHandler`, `emitSessionEvents`,
  `extractToolResultsFromMessages`.
- `setup.ts` — module-level `setup*` helpers (session/workflow/resume/memory/
  skills/context/plan/tools/system-prompt/hooks), `resolveExplicitSkills`,
  `buildSkillsSection`, `spliceSkillsSection`, `spliceExplicitIntoFirstTurn`,
  `createAgentSession`. `setupTools` appends the `execution_state_propose`
  tool to provider tools only when `ALIX_EXECUTION_STATE_SEND` is on
  (visibility matches the loop-side interception gate).
- `state.ts` — `SessionState` (all per-session mutable state, hoisted out of the
  former `build()` closure) + `createSessionState`.
- `activity.ts` — turn-scoped activity/liveness/phase accessors and operator
  cancel: `feedActivity`, `advancePhase`, `getPhase`, `getLiveness`,
  `getActivity`, `cancellationInProgress`, `cancelActiveTurn`.
- `init.ts` — `initialize` (first-turn setup pipeline P0–P9).
- `turn.ts` — `processTurn` / `processTurnBody` plus
  `createFreshSessionState` / `extractToolCallsFromMessages`. Owns the
  session-level governed execution-state emitter (opt-in
  `ALIX_EXECUTION_STATE_EMIT=1`): creates it pre-loop, passes it into
  `runTaskLoop` via `TaskLoopDeps.executionState`, and reconciles the turn's
  artifacts in the `finally` on every exit path (fail-soft, tool-free).
- `chat.ts` — lightweight chat path: `processChat` / `processChatBody` /
  `runSearch` / `ensureChatProvider`.
- `resume.ts` — `resumeSession` + `restoreReconstructedPlanTasks`.
- `main.ts` — the `AgentSessionBuilder` class; `build()` is a thin coordinator
  that creates the `SessionState` and wires the returned `AgentSession` to the
  module-level phase factories.

**Local Contracts:**
- `../session.ts` re-exports the public surface via `export *`; do not add logic
  there.
- **#717 5b done:** `AgentSessionBuilder.build()` is decomposed. All shared
  mutable state lives in `SessionState` (state.ts); phases are module-level
  factories that take that state explicitly. `main.ts` is ≤ the 1,500-line
  orchestrator threshold. Do not reintroduce a closure-factory `build()`.
- New phase modules are internal (not re-exported by the barrel). Public symbols
  (`AgentSessionBuilder`, `SessionPhase`, the `setup*` helpers, etc.) stay
  re-exported through `../session.ts`.
- Relative imports: `../../` → `src/`, `../` → `src/agent/`.
- `AgentSessionConfig.suppressConfigWarnings` is a composition-root presentation policy. It passes through `initialize`/`setupSession` to `initAgent` and defaults off; the TUI enables it because the frame painter owns terminal output.
- `AgentSessionConfig.verbose` owns raw stdout for both tool results and model streaming. The direct route and full task loop pass it to `streamToResponse.writeToStdout`; TUI `verbose: false` must still forward tokens through `events.onToken` without writing raw terminal bytes.
- Source-scan sentinels: `tests/agent/session-skills.test.ts` reads
  `agent/session/chat.ts`; `tests/tracing/langfuse-boundary.vitest.ts` reads
  `agent/session/state.ts`.
- Self-model prompt section: `setupSystemPrompt` takes optional `selfContext`
  (`SelfModelInfo` from `src/agent/system-prompt.ts`, rendered by pure
  `renderSelfModelSection`) and emits a bounded `## Self Model` block
  (provider/model/window/budgets/tokenizer). `setupContextLimits` returns
  `modelProvider/modelName/contextWindowTokens` additively; `init.ts` P5→P8
  threads them. The legacy `agent-loop.ts` inline prompt uses the same renderer.
- Self-capability prompt section: `setupSystemPrompt` always injects
  `renderSelfCapabilitySection` (`src/agent/self-capabilities.ts`) as a bounded
  `## Your Capabilities` block (CLI command groups + TUI slash commands + skill
  triggers); the legacy `agent-loop.ts` inline prompt does the same. It is the
  model's index of its own surface — keep `TUI_SLASH_COMMANDS` in sync with
  `parseWorkbenchBuiltinCommand` (pinned by
  `tests/agent/self-capabilities.test.ts`).
- `completed_unverified` is a failed terminal outcome. Session wrappers must
  emit failed task/graph/workflow state for it, never completed state.

**Verification:**
- `tests/agent/*.vitest.ts`, `tests/agent/session-skills.test.ts`,
  `tests/agent/self-capabilities.test.ts`, `tests/session-resume.vitest.ts`,
  `tests/tracing/langfuse-boundary.vitest.ts`.
