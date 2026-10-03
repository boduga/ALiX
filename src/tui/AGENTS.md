# TUI Work Contract

## Purpose

`src/tui` owns ALiX's interactive terminal presentation and operator input. It projects runtime facts into immutable view models and sends typed operator intent back to runtime services. It does not own task execution, policy decisions, or audit truth.

## Ownership

- `app.ts` coordinates terminal lifecycle, snapshots, input, and runtime ports during the legacy-to-Workbench migration.
- `snapshot.ts` and `snapshot-builder.ts` define and compose immutable TUI read models.
- `runtime/` owns EventLog-derived projections used by terminal views.
- `workbench/` owns the conversation-first semantic transcript and the Workbench shell.
- `src/tui/workbench/model/preview-theme.ts` owns explicit truecolor, ANSI-16, monochrome, and ASCII/Unicode presentation tokens for preview parity; lifecycle labels remain readable without color. Region painters integrate these tokens as their parity phases land.
- `workbench/model/ui-state.ts`, `workbench/app/workbench-store.ts`, and `workbench/input/input-router.ts` own feature-gated presentation state and context-sensitive composer input; runtime truth stays in `AgentSession` and `EventLog`.
- `src/tui/workbench/model/transcript-filter.ts` owns transcript category/scope selectors; `src/tui/workbench/views/transcript-toolbar.ts` owns bounded filter/follow chrome. Inspector identity and transcript scope remain separate presentation choices.
- `src/tui/workbench/projections/agent-roster-projection.ts` and `src/tui/workbench/projections/task-projection.ts` own distinct EventLog-derived agent and delegated-task read models; painters must not reconstruct either model from the other.
- `views/` owns presentation-only rendering and view-local input mappings.
- `canvas.ts`, `frame-painter.ts`, and `render.ts` own terminal composition and output.

## Local Contracts

- Runtime facts flow one way: EventLog/runtime projections → immutable snapshots → views.
- Views and renderers never emit runtime events or infer successful runtime transitions.
- UI actions reach runtime through explicit controller/port boundaries.
- Compact transcripts show operator work and outcomes. Routine context assembly, raw lifecycle plumbing, and the `alix_done` tool are details, not default content.
- Detailed transcript mode may reveal bounded lifecycle diagnostics but must preserve the same underlying audit correlation.
- Agent activity and agent liveness are distinct: activity says what is happening; liveness says whether progress is healthy.
- Never render model-private reasoning. User-safe activity labels are allowed.
- The composer and cancellation path remain usable while a turn is active.
- Workbench `Enter` submits while idle and queues a follow-up while a foreground turn is active; queued messages drain FIFO only after the prior turn settles. `Shift+Enter` inserts a newline. First-press `Ctrl+C` cancels active foreground work before the legacy exit path may run.
- Agent lifecycle state, model identity, ownership, and task assignment come from canonical `agent.*` events. Legacy `subagent.*` events remain projection-compatible during migration.
- Coordination workers keep `worker.id` as their unique roster execution identity. Chat coordination plans inherit the active parent session, and their canonical `agent.*` lifecycle events retain that session instead of a tool/manager-internal id, so session-scoped roster, task, result, and artifact projections observe them. Optional `coordinationRunId`, planner-assigned agent label, and task label flow as presentation metadata; the TUI never reads `CoordinationStore` as a second truth source.
- Agent/task projections deduplicate by stable event identity, not sequence position. An `approval.requested` or durable `approval.created` event carrying an authoritative `agentId` moves that roster entry to non-terminal `waiting_approval`; duplicate creation facts for the same `approvalId` do not overwrite its prior active state, and matching `approval.resolved` restores that state.
- Coordination retry results marked `attemptTerminal: false` remain non-terminal in agent/task projections; the scheduler's canonical lifecycle event is authoritative for final completion, failure, or dependency blocking.
- Task dependency and approval waits remain distinct from running and blocked work. Structured dependency IDs come from assignment events, never task prose; snapshots detach dependency and ownership arrays.
- Task rows derive ownership and current progress only from structured task, lifecycle, progress, and ownership events; display text is never parsed back into task state.
- Tool cards carry only bounded structured request path/range and explicit completed-event observed line count, correlated by call identity. Requested ranges are not proof of executed ranges; output previews never establish line counts. Absent metadata stays unknown. Trace snapshots, conversation items and checkpoint import/export detach nested metadata; version-one checkpoints without it remain compatible.
- Roster snapshots sample active-tool elapsed time from the supplied clock and authoritative start, without moving progress timestamps. Ownership, usage, active-tool and liveness data are detached from projection state. Context-window capacity, lifetime token totals and uncorrelated assembly events never imply current worker context consumption.
- Agent tool activity comes only from canonical `tool.*` events carrying an authoritative `agentId`. Correlate progress and terminal events by `toolCallId`; an orphan or mismatched terminal event must never clear another active tool.
- Multi-agent stall status is a derived, non-terminal diagnostic based on authoritative progress time and the shared runtime liveness thresholds. Tool execution, approval waits, dependency waits, and terminal agents are exempt; new progress clears the diagnostic without rewriting history.
- Agent usage, context, and cost fields remain absent until an authoritative event supplies them. Render explicit zero values as known facts, but never substitute zero for unknown token, context, or cost data.
- Agent header totals are derived from roster rows on every snapshot. Preview header/footer totals are session-scoped and independent of inspection/run selection. Missing counters render unavailable, explicit zero stays known, and partial known-cost totals carry an explicit `+` marker; absent cost data produces no cost label rather than `$0`.
- Workbench branding uses a single-row bold cyan ALiX WORKBENCH title; narrow surfaces shorten or omit branding before hiding mode. The header divider below branding is removed. Header/body/composer geometry stays unchanged.
- Live Workbench chrome uses the PREVIEW badge; CONCEPT PREVIEW requires explicit demonstration presentation. Header mode, approval/stall warnings and footer decision/cancellation hints take precedence over workspace and secondary counters under width pressure. Escape hints describe open-surface close before foreground cancel; indivisible key labels are omitted rather than clipped.
- Workbench approval cards remain visible until the approval projection observes an authoritative terminal event; never remove or label them from key intent alone.
- On the agent surface, an authoritative approval card replaces its semantic `approval.requested` row in the response stream and remains there until projection observes resolution. Non-agent tabs may use the shared dialog overlay. Compact transcript and footer rendering summarize the operation without repeating its raw target; the card owns the bounded target preview, while detailed mode remains the route to fuller diagnostics.
- `/diagnostics` (alias `/diag`) opens a read-only, selection-aware failure surface derived from agent, task, and artifact snapshots. It reports failed, blocked, and stalled work and gives CLI-first recovery guidance; painters never execute recovery actions.
- Workbench conversation rows identify operator and assistant prose explicitly as `YOU` and `ALiX`. While approval is pending, its elapsed wait replaces generic running liveness in the top status line and is repeated in the authoritative card for decision context.
- A temporarily unavailable approval snapshot preserves the last authoritative pending cards. While a decision is awaiting projection confirmation, duplicate decisions for that approval are suppressed.
- Workbench uses three persistent body panes at ≥160 columns and ≥36 rows: left roster, center transcript, right inspector reservation. At ≥120 columns with ≥12 rows, drawers sit left beside the transcript; narrower or shorter windows use bounded overlays. Closed drawers in short windows do not force a roster overlay. Inspector contents arrive in a later parity phase.
- Preview agent rows render state glyphs plus words, identity-joined task/dependency subtitles, aggregate counts and selected outlines/fill; role labels never establish identity. Duplicate roles and retries retain distinct execution IDs. Current worker context consumption is never inferred from lifetime usage or capacity.
- Focused agents drawers own 1–9 scoped execution selection, / aggregate selection and c read-only coordination guidance. Composer text and other drawers retain those characters; navigating or inspecting never starts a run. Closing an overlay returns to the open drawer when present, otherwise the composer. Coordination launch remains a separate parity phase.
- An explicitly opened drawer owns Up/Down (or j/k) navigation and Escape until closed. Agent selection and scroll offset are presentation state only and must never affect runtime execution. `Ctrl+A`, `Ctrl+T`, and `Ctrl+R` toggle the agent, task, and artifact/result drawers. Agent drawers also own Enter for roster expansion and all roster drawers own `[`/`]` run cycling.
- Run, agent, and task selections persist independently of drawer visibility while their projected identities remain valid. Undefined run/agent selection is the explicit all-runs/all-agents aggregate view; streamed snapshots reconcile vanished selections back to that aggregate.
- Selection reconciliation validates the run first, then validates agent/task identity against that reconciled scope. Explicit non-blocked task states clear stale block reasons, and blocked tasks remain visible in roster totals.
- Inspector selection is independent of transcript scope. Transcript defaults to all agents; explicit selected scope filters correlated prose/tools/activity by the selected execution identity, while uncorrelated items and pending approvals remain visible. Run/task/artifact and diagnostic inspection retain their existing strict selectors.
- Transcript categories ALL, RESPONSE, TOOL, ACTIVITY and ERROR are independent of details mode. Pending approvals bypass category/scope filtering. Historic progress prose requires explicit `userSafe: true`; typed lifecycle state supplies status words, never private reasoning or prose parsing. Verified activity badges require explicit `verifiedOutcome` success/failure metadata; literal checkmarks and initialization counts do not establish outcomes. Checkpoint imports validate optional activity metadata before mutation.
- Ctrl+F switches composer/transcript focus; focused transcript keys 1–5 select categories, s changes all/selected scope and f toggles follow. Other focus contexts retain their characters. Idle Escape returns to composer; active Escape retains cancellation. Workbench follow state is authoritative and mirrored to the legacy viewport adapter; paused views preserve semantic anchors through append/filter/resize and count new semantic items rather than wrapped rows.
- Workbench transcript wrapping, full-width composer rows, scroll anchors, and terminal cursor placement derive from the same named responsive region geometry. Drawer writes stay within their body region, including short windows.
- Unpinned Workbench resize preserves the semantic transcript item and nearest wrapped offset in a presentation-only frame cache; manual scroll deltas still apply and operator selection/state is not rewritten.
- Workbench frames are row-diffed against the previous frame, and composer cursor math uses grapheme display width rather than UTF-16 length.
- Canvas cells reserve terminal display columns for complete graphemes, so wide
  characters and emoji cannot shift adjacent Workbench chrome or split across
  frame patches. Shared terminal-text helpers live at `src/tui/terminal-text.ts`.
- Workbench composer insertion, movement, Backspace, and Delete operate on complete Unicode graphemes; its cursor remains a JavaScript string offset positioned at a grapheme boundary. Left/Right move by grapheme, and Home/End move to document boundaries.
- Bracketed paste inserts one normalized text block at the authoritative Workbench cursor; it never rebuilds composer state from the legacy input-buffer adapter.
- Runtime collectors coalesce EventLog watch notifications into serialized 20 ms projection samples; the one-second interval remains a recovery/clock fallback.
- `/agents`, `/tasks`, and `/artifacts` open projection-backed presentation drawers; `/diff`, `/review`, and `/help` open built-in Workbench overlays. Artifact/result inspection is read-only, strictly filters selected run/agent/task scopes, and selecting an item adopts its authoritative correlation. It renders only bounded event-provided previews—it never reads artifact paths from a painter. Built-in commands require an exact match and never dispatch runtime work or skills. Their painters remain side-effect free.
- Oversized tool-output artifacts inherit authoritative coordination run, worker, and task correlation from their tool request so strict drawer filters retain the selected worker's artifacts.
- Diagnostic overlays consume editing, paste, and navigation input; Escape closes them and Ctrl+C retains cancellation/exit. Approval cards paint above diagnostics and their decision keys remain actionable.
- Workbench rollout is additive and feature-gated until legacy parity is proven.
- Keep the custom ANSI canvas; do not introduce a second terminal UI framework without a separately approved architecture change.
- While the TUI owns stdin in raw mode, runtime cleanup, persistence, and model-stream helpers must not write directly to stdout/stderr or open readline prompts; surface output through projections/token callbacks and keep routine no-op outcomes silent. The TUI composition root sets `loadConfig(..., { suppressWarnings: true })`, `AgentSessionConfig.suppressConfigWarnings`, and `verbose: false`; both direct-route and task-loop calls must pass that ownership into `streamToResponse(writeToStdout: false)`.

## Work Guidance

- Prefer pure projection, reducer, layout, and formatting functions.
- Keep raw EventLog payload interpretation inside projections, not painters.
- Preserve source event sequence ranges on semantic transcript items.
- Agent plans are emitted as typed `agent.plan` events before `agent.response`; Workbench renders them through `ConversationProjection`, never directly from mutable per-tab plan state.
- When Workbench is enabled on the agent tab, `src/tui/workbench/views/operator-shell.ts` replaces legacy dashboard chrome after composition while preserving shared header/footer geometry; other tabs retain legacy chrome until their own parity slices land.
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
