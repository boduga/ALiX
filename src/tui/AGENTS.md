# TUI Work Contract

## Purpose

`src/tui` owns ALiX's interactive terminal presentation and operator input. It projects runtime facts into immutable view models and sends typed operator intent back to runtime services. It does not own task execution, policy decisions, or audit truth.

## Ownership

- `app.ts` coordinates terminal lifecycle, snapshots, input, and runtime ports during the legacy-to-Workbench migration.
- `snapshot.ts` and `snapshot-builder.ts` define and compose immutable TUI read models.
- `runtime/` owns EventLog-derived projections used by terminal views.
- `workbench/` owns the conversation-first semantic transcript and the future Workbench shell.
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
- Workbench rollout is additive and feature-gated until legacy parity is proven.
- Keep the custom ANSI canvas; do not introduce a second terminal UI framework without a separately approved architecture change.

## Work Guidance

- Prefer pure projection, reducer, layout, and formatting functions.
- Keep raw EventLog payload interpretation inside projections, not painters.
- Preserve source event sequence ranges on semantic transcript items.
- Agent plans are emitted as typed `agent.plan` events before `agent.response`; Workbench renders them through `ConversationProjection`, never directly from mutable per-tab plan state.
- When Workbench is enabled on the agent tab, `operator-shell.ts` replaces legacy dashboard chrome after composition while preserving shared header/footer geometry; other tabs retain legacy chrome until their own parity slices land.
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
