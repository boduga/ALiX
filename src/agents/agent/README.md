# Agent Runtime

## Overview
The agent runtime is the single-agent execution layer beneath every ALiX surface: `alix run`, `alix run --chat`, the TUI, the daemon, and coordination workers all converge here. `initAgent` builds one `AgentContext` per session (event log, approval manager, checkpoints, memory, skills, tools, scope), `runTask` executes a governed task with `ExecutionIntent` evidence, and the shared `AgentSession` engine in `./session/` turns that context into a conversation. Liveness (`AgentLiveness`), user-facing activity (`AgentActivity`), trace closure (`withTraceRun`), and session persistence (`SessionStore`/`JsonlSessionStore`) are separate, orthogonal concerns defined here rather than merged into the loop.

## Interface
- `AgentContext`, `InitAgentOpts`, `initAgent(cwd, opts)` — builds one session runtime: shared or fresh session dir, `EventLog.init()`, `loadConfig`, provider routing adapter, MCP manager when configured, skills catalog, subagent/merge infra when enabled, `ToolExecutor`, `CheckpointManager`, memory store, RepoMap, and scope tracker `[agent.ts:initAgent]`.
- `AgentProgressKind`, `AgentLivenessState` (`healthy|warning|stalled`), `AgentLivenessSnapshot`, `AgentLivenessThresholds`, `DEFAULT_LIVENESS_THRESHOLDS`, `AgentLiveness` (`mark`/`snapshot`) — progress-based liveness tracking `[agent-liveness.ts:AgentLiveness]`.
- `runTask`, `emitRunEvidence` — governed task entry point wrapping the internal core with `ExecutionIntent`/evidence `[agent-loop.ts:runTask]`.
- `AGENT_ACTIVITY_STATES`, `AgentActivityState`, `AgentActivity`, `createAgentActivity`, `transition`, `withElapsed`, `formatActivityElapsed`, `assertExhaustiveState` — user-facing activity vocabulary and pure transitions `[agent-activity.ts:AGENT_ACTIVITY_STATES]`.
- `withTraceRun` — shared terminal-outcome wrapper for run roots (exactly-once `endRun`) `[run-root.ts:withTraceRun]`.
- `MutationSessionState`, `extractMutationPaths`, `validMutationPaths`, `recordMutationInSessionState` — mutation bookkeeping for created/changed/deleted paths `[mutations.ts:recordMutationInSessionState]`.
- `SessionSnapshot`, `SessionInfo`, `SessionStore` — pluggable session persistence contract `[session-store.ts:SessionStore]`.
- `JsonlSessionStore` — file-backed store (`snapshot.json` + `messages.jsonl`) `[session-store-jsonl.ts:JsonlSessionStore]`.
- `isCI`, `shouldAutoDisableStreaming`, `StreamHandler` — CI streaming gate and chunk callback type `[stream.ts:isCI]`.
- `TUI_SLASH_COMMANDS`, `CLI_COMMANDS`, `CapabilityEntry`, `SelfCapabilityOptions`, `renderSelfCapabilitySection` — bounded "Your Capabilities" prompt section `[self-capabilities.ts:renderSelfCapabilitySection]`.
- `SYSTEM_PROMPT_BASE`, `RESEARCH_SUPPLEMENT`, `MUTATION_SUPPLEMENT`, `VALIDATION_SUPPLEMENT`, `FAILURE_REASONS`, `SelfModelInfo`, `renderSelfModelSection`, `SHELL_TASK_PROMPT`, `READ_ONLY_MODE_PROMPT`, `renderToolManifest` — system-prompt assembly primitives `[system-prompt.ts:SYSTEM_PROMPT_BASE]`.
- `buildErrorMessage`, `buildToolsForProvider`, `buildContextBundleEventPayload`, `buildModelUsageEventPayload`, `renderContextBundleForPrompt` — provider message/tool/event payload builders `[messages.ts:buildToolsForProvider]`.
- `parseBlocks` — re-export of the v2 renderer block parser `[response-blocks.ts:parseBlocks]`.
- Session engine contract and public barrel: [./session/README.md](./session/README.md).

## Invariants
- Agent turns have no wall-clock deadline: `DEFAULT_LIVENESS_THRESHOLDS` is `{ warningAfterMs: 120_000, stalledAfterMs: 600_000 }`, and `AgentLiveness` only classifies state — it never terminates a run `[agent-liveness.ts:AgentLiveness]`.
- `model_chunk` progress marks are debounced (default 1 000 ms) so hot token flow cannot inflate `progressCount`; every other `AgentProgressKind` is recorded verbatim `[agent-liveness.ts:AgentLiveness.mark]`.
- Activity has twelve states, not ten: `cancelling` is the live unwind phase and `cancelled` the terminal outcome; `awaiting_approval` labels a blocked approval wait instead of mislabeling it `tool_running` `[agent-activity.ts:AgentActivityState]`.
- `transition` and `withElapsed` are immutable — they return frozen records and carry forward unspecified fields from the prior activity `[agent-activity.ts:transition]`.
- `withTraceRun` records an `error` fallback outcome before the body runs, classifies cancellation via `isCancellationError` as a normal `cancelled` terminal, and calls `endRun` exactly once in `finally` `[run-root.ts:withTraceRun]`.
- Tracing failures are swallowed: a broken `TraceClient` must never change a turn's outcome `[run-root.ts:withTraceRun]`.
- `runTask` creates the `ExecutionIntent` before execution and emits exactly one terminal evidence record (`ExecutionCompleted` or `ExecutionFailed`) on both paths `[agent-loop.ts:runTask]`.
- `emitRunEvidence` is fire-and-forget: an evidence failure must never stall or fail a task run `[agent-loop.ts:emitRunEvidence]`.
- `FAILURE_REASONS` is the closed set (`completed_unverified`, `max_iterations`, `max_repairs`, `rejected_scope_expansion`, `context_budget_overflow`) driving workflow/graph failure transitions `[system-prompt.ts:FAILURE_REASONS]`.
- `recordMutationInSessionState` classifies exactly four executors: `file.create` → `created`, `file.delete` → `deleted`, `file.write` and `patch.apply` → `changed`; any other executor records nothing `[mutations.ts:recordMutationInSessionState]`.
- `SessionStore.save` is idempotent per `sessionId`, `load` returns `null` (not an error) when absent, and `list` returns sessions newest-first by `updatedAt` `[session-store.ts:SessionStore]`.
- `JsonlSessionStore.load` maps a corrupt snapshot to `null` rather than throwing, and `list` skips corrupt entries `[session-store-jsonl.ts:load]`.
- `shouldAutoDisableStreaming` is true only in CI: local non-TTY runs still stream tokens `[stream.ts:shouldAutoDisableStreaming]`.
- `initAgent` never mutates the loaded config for the non-TTY streaming override; it builds and returns an `effectiveConfig` copy that the task loop re-resolves from `[agent.ts:initAgent]`.
- `initAgent` appends `session.started` then `user.message` on every fresh session before any provider work `[agent.ts:initAgent]`.

## Side Effects
- `initAgent` creates `.alix/sessions/<sessionId>` (`mkdir -p`), initializes the `EventLog`, creates the checkpoint directory, and appends `session.started` / `user.message` events `[agent.ts:initAgent]`.
- `initAgent` loads skills (`loadDiscoveredSkillManifests`, `buildSkillCatalog`), enforces store limits via `evictIfNeeded`, discovers hooks, and lazily initializes `McpManager` only when `config.mcpServers` is non-empty `[agent.ts:initAgent]`.
- `initAgent` builds a `SubagentManager` + `MergeCoordinator` and registers tool-repair/coordination handlers only when `isSubagentsEnabled(config)` `[agent.ts:initAgent]`.
- `runTask` writes `ExecutionEvidenceStore` records under `<cwd>/.alix/governance` (`ExecutionCreated`, `ExecutionCompleted`, `ExecutionFailed`) `[agent-loop.ts:runTask]`.
- The internal run core appends workflow/graph/task lifecycle events (`task.done`/`graph.completed`/`workflow.completed` or their `failed` counterparts) and flushes `observability.metric` events to the session log `[agent-loop.ts:runTaskCore]`.
- `JsonlSessionStore.save` writes `snapshot.json` atomically (tmp file then POSIX rename) and appends new messages to `messages.jsonl` gated by the `.lastMessageCount` sidecar `[session-store-jsonl.ts:save]`.
- `JsonlSessionStore.list` reads every session directory and sorts by `updatedAt` descending, then slices to the requested limit `[session-store-jsonl.ts:list]`.

## Verification
- Run: `pnpm test`
