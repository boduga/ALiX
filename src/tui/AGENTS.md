# TUI Work Contract

## Purpose

`src/tui` owns ALiX's interactive terminal presentation and operator input. It projects runtime facts into immutable view models and sends typed operator intent back to runtime services. It does not own task execution, policy decisions, or audit truth.

## Ownership

- `app.ts` coordinates terminal lifecycle, snapshots, input, and runtime ports during the legacy-to-Workbench migration.
- `snapshot.ts` and `snapshot-builder.ts` define and compose immutable TUI read models.
- `runtime/` owns EventLog-derived projections used by terminal views.
- `workbench/` owns the conversation-first semantic transcript and the future Workbench shell.
- `workbench/model/ui-state.ts`, `workbench/app/workbench-store.ts`, and `workbench/input/input-router.ts` own feature-gated presentation state and context-sensitive composer input; runtime truth stays in `AgentSession` and `EventLog`.
- `workbench/projections/agent-roster-projection.ts` and `task-projection.ts` own distinct EventLog-derived agent and delegated-task read models; painters must not reconstruct either model from the other.
- `views/` owns presentation-only rendering and view-local input mappings.
- `canvas.ts`, `frame-painter.ts`, and `render.ts` own terminal composition and output.

## Local Contracts

- Runtime facts flow one way: EventLog/runtime projections → immutable snapshots → views.
- Views and renderers never emit runtime events or infer successful runtime transitions.
- UI actions reach runtime through explicit controller/port boundaries.
- Compact transcripts show operator work and outcomes. Routine context assembly, raw lifecycle plumbing, and the `done` tool are details, not default content.
- Detailed transcript mode may reveal bounded lifecycle diagnostics but must preserve the same underlying audit correlation.
- Agent activity and agent liveness are distinct: activity says what is happening; liveness says whether progress is healthy.
- Never render model-private reasoning. User-safe activity labels are allowed.
- The composer and cancellation path remain usable while a turn is active.
- Workbench `Enter` submits while idle and queues a follow-up while a foreground turn is active; queued messages drain FIFO only after the prior turn settles. `Shift+Enter` inserts a newline. First-press `Ctrl+C` cancels active foreground work before the legacy exit path may run.
- Agent lifecycle state, model identity, ownership, and task assignment come from canonical `agent.*` events. Legacy `subagent.*` events remain projection-compatible during migration.
- Coordination workers keep `worker.id` as their unique roster execution identity. Optional `coordinationRunId`, planner-assigned agent label, and task label flow through canonical `agent.*` events as presentation metadata; the TUI never reads `CoordinationStore` as a second truth source.
- Agent/task projections deduplicate by stable event identity, not sequence position. An `approval.requested` or durable `approval.created` event carrying an authoritative `agentId` moves that roster entry to non-terminal `waiting_approval`; duplicate creation facts for the same `approvalId` do not overwrite its prior active state, and matching `approval.resolved` restores that state.
- Task rows derive ownership and current progress only from structured task, lifecycle, progress, and ownership events; display text is never parsed back into task state.
- Agent tool activity comes only from canonical `tool.*` events carrying an authoritative `agentId`. Correlate progress and terminal events by `toolCallId`; an orphan or mismatched terminal event must never clear another active tool.
- Multi-agent stall status is a derived, non-terminal diagnostic based on authoritative progress time and the shared runtime liveness thresholds. Tool execution, approval waits, dependency waits, and terminal agents are exempt; new progress clears the diagnostic without rewriting history.
- Agent usage, context, and cost fields remain absent until an authoritative event supplies them. Render explicit zero values as known facts, but never substitute zero for unknown token, context, or cost data.
- Agent header totals are derived from roster rows on every snapshot. Partial known-cost totals carry an explicit `+` marker; absent cost data produces no cost label rather than `$0`.
- Workbench approval cards remain visible until the approval projection observes an authoritative terminal event; never remove or label them from key intent alone.
- On the agent surface, an authoritative approval card replaces its semantic `approval.requested` row in the response stream and remains there until projection observes resolution. Non-agent tabs may use the shared dialog overlay. Compact transcript and footer rendering summarize the operation without repeating its raw target; the card owns the bounded target preview, while detailed mode remains the route to fuller diagnostics.
- Workbench conversation rows identify operator and assistant prose explicitly as `YOU` and `ALiX`. While approval is pending, its elapsed wait replaces generic running liveness in the top status line and is repeated in the authoritative card for decision context.
- A temporarily unavailable approval snapshot preserves the last authoritative pending cards. While a decision is awaiting projection confirmation, duplicate decisions for that approval are suppressed.
- Below 120 columns, agent and task drawers overlay the work surface. From 120 columns they render beside it; at 160 columns and above the agent roster is persistent by default.
- An explicitly opened drawer owns Up/Down (or j/k) navigation and Escape until closed. Agent selection and scroll offset are presentation state only and must never affect runtime execution. Agent drawers also own Enter for roster expansion and both roster drawers own `[`/`]` run cycling.
- Run, agent, and task selections persist independently of drawer visibility while their projected identities remain valid. Undefined run/agent selection is the explicit all-runs/all-agents aggregate view; streamed snapshots reconcile vanished selections back to that aggregate.
- Agent selection filters transcript, tools, approvals, and diagnostics carrying a different authoritative `agentId`; uncorrelated items remain visible so incomplete metadata cannot hide operator actions.
- Workbench transcript wrapping, composer rows, scroll anchors, and terminal cursor placement derive from the same responsive surface geometry.
- Workbench frames are row-diffed against the previous frame, and composer cursor math uses grapheme display width rather than UTF-16 length.
- Workbench composer insertion, movement, Backspace, and Delete operate on complete Unicode graphemes; its cursor remains a JavaScript string offset positioned at a grapheme boundary. Left/Right move by grapheme, and Home/End move to document boundaries.
- Bracketed paste inserts one normalized text block at the authoritative Workbench cursor; it never rebuilds composer state from the legacy input-buffer adapter.
- Runtime collectors coalesce EventLog watch notifications into serialized 20 ms projection samples; the one-second interval remains a recovery/clock fallback.
- `/agents` and `/tasks` open their presentation drawers; `/diff`, `/review`, and `/help` open built-in Workbench overlays. Built-in commands require an exact match and never dispatch runtime work or skills. Their read models are projection-backed and their painters remain side-effect free.
- Diagnostic overlays consume editing, paste, and navigation input; Escape closes them and Ctrl+C retains cancellation/exit. Approval cards paint above diagnostics and their decision keys remain actionable.
- Workbench rollout is additive and feature-gated until legacy parity is proven.
- Keep the custom ANSI canvas; do not introduce a second terminal UI framework without a separately approved architecture change.
- While the TUI owns stdin in raw mode, runtime cleanup, persistence, and model-stream helpers must not write directly to stdout/stderr or open readline prompts; surface output through projections/token callbacks and keep routine no-op outcomes silent. The TUI composition root sets `loadConfig(..., { suppressWarnings: true })`, `AgentSessionConfig.suppressConfigWarnings`, and `verbose: false`; both direct-route and task-loop calls must pass that ownership into `streamToResponse(writeToStdout: false)`.

## Work Guidance

- Prefer pure projection, reducer, layout, and formatting functions.
- Keep raw EventLog payload interpretation inside projections, not painters.
- Preserve source event sequence ranges on semantic transcript items.
- Agent plans are emitted as typed `agent.plan` events before `agent.response`; Workbench renders them through `ConversationProjection`, never directly from mutable per-tab plan state.
- When Workbench is enabled on the agent tab, `operator-shell.ts` replaces legacy dashboard chrome after composition while preserving shared header/footer geometry; other tabs retain legacy chrome until their own parity slices land.
- While Workbench is feature-gated, `WorkbenchStore.composer` is authoritative and `PerTabState.inputBuffer` is its temporary rendering/slash-completion adapter.
- Treat task and agent as separate concepts in future roster work.
- Test narrow and wide terminal dimensions and preserve stable scroll anchors.
- New Workbench modules belong under `src/tui/workbench/`; use adapters rather than rewriting all legacy views at once.

## Verification

- Run `pnpm build`.
- Run affected `tests/tui/**` and CLI bootstrap tests.
- Add deterministic projection tests for new event vocabulary.
- Add render/golden coverage for every new responsive state.
- Use PTY integration tests for terminal modes, resize, paste, focus, cancellation, and cleanup changes.

## Child DOX Index

No child AGENTS.md files currently exist below this boundary.
