# TUI Views

## Overview
Presentation-only tab views for the ALiX terminal UI. Each view projects an
immutable `DashboardSnapshot`, the terminal dimensions, and per-tab UI state
into either returned text rows or writes on a `TerminalCanvas`. The package
also owns the shared bottom-anchored scrollback geometry, line builders,
wrap/overlay helpers, and the live activity line formatter used by the agent
and chat surfaces. Views render projections; their action surface is limited to
presentation and operator intents ([types.ts:ViewAction]).

## Interface
- `TuiView`, `ViewRenderContext`, `ViewInputContext`, `ViewRenderResult`, `ViewAction` — the tab view contract: `render`, optional `handleKey`, `onActivate`, `onDeactivate` [types.ts:TuiView], [types.ts:ViewRenderContext], [types.ts:ViewAction]
- `TerminalDimensions`, `PerTabRuntime`, `SlashStrip`, `SlashStripEntry` — render context types, including per-tab `chat`/`agent` runtime snapshots and the slash-completion strip state [types.ts:TerminalDimensions], [types.ts:PerTabRuntime], [types.ts:SlashStrip]
- `AgentView`, `ApprovalsView`, `ChatView`, `DashboardView`, `DaemonView`, `PolicyView`, `RuntimeView`, `SopsView` — the tab renderers registered by this package [agent-view.ts:AgentView], [approvals-view.ts:ApprovalsView], [chat-view.ts:ChatView], [dashboard-view.ts:DashboardView], [daemon-view.ts:DaemonView], [policy-view.ts:PolicyView], [runtime-view.ts:RuntimeView], [sops-view.ts:SopsView]
- `getView`, `getAllViews` — singleton view lookup by tab id and enumeration of all registered views [index.ts:getView], [index.ts:getAllViews]
- `computeViewport`, `Viewport` — shared footer/scrollback geometry for the `agent` and `chat` layouts [scroll-math.ts:computeViewport]
- `buildAgentScrollbackLines`, `buildChatScrollbackLines` — per-tab scrollback line builders over projected timelines [scroll-math.ts:buildAgentScrollbackLines], [scroll-math.ts:buildChatScrollbackLines]
- `computeBottomAnchor`, `trimStreamedTextToLanded`, `classifyContextEventSignal` — bottom-anchor offset, live-stream dedup, and context-event signal classification [scroll-math.ts:computeBottomAnchor], [scroll-math.ts:trimStreamedTextToLanded], [scroll-math.ts:classifyContextEventSignal]
- `renderBottomAnchoredSlice`, `ScrollbackLine`, `KindStyleMap` — bottom-anchored slice painting and per-kind style dispatch [bottom-anchored-viewport.ts:renderBottomAnchoredSlice], [bottom-anchored-viewport.ts:ScrollbackLine]
- `renderSlashOverlay` — slash-completion strip painter clamped to available rows [slash-overlay.ts:renderSlashOverlay]
- `wrapText` — ANSI-aware word wrap that preserves explicit newlines [wrap-text.ts:wrapText]
- `activitySpinnerFrame`, `isTransientActivityState`, `activityStateLabel`, `formatActivityLine`, `ACTIVITY_SPINNER_FRAMES` — live activity indicator helpers [activity-line.ts:activitySpinnerFrame], [activity-line.ts:formatActivityLine], [activity-line.ts:ACTIVITY_SPINNER_FRAMES]
- `HEADER_H`, `FOOTER_H`, `SCROLLBACK_TOP_AGENT`, `SCROLLBACK_TOP_CHAT`, `GUTTER_WIDTH` — layout constants that are the single source of truth for the shared geometry [scroll-math.ts:HEADER_H], [scroll-math.ts:GUTTER_WIDTH]

## Invariants
- Runtime facts flow one way, EventLog/runtime projections → immutable snapshots → views; `ViewAction` can request scrolling, tab switches, refresh, approval resolution, or transcript toggles, but carries no runtime-event emission or transition-inference action [types.ts:ViewAction].
- `ViewRenderContext.runtime` is `null` when a per-tab collector is not wired or has not sampled yet; line builders fall back to an empty timeline instead of throwing [types.ts:PerTabRuntime], [scroll-math.ts:buildAgentScrollbackLines].
- `ViewInputContext.perTab` is mutable only from within `handleKey`; `render` is documented as pure over its context [types.ts:ViewInputContext], [agent-view.ts:AgentView], [chat-view.ts:ChatView].
- `renderBottomAnchoredSlice` is pure: no state, no I/O, and no mutation of its inputs [bottom-anchored-viewport.ts:renderBottomAnchoredSlice].
- `renderSlashOverlay` clamps rendered entries to the rows available below the panel and keeps the selected entry visible in the window [slash-overlay.ts:renderSlashOverlay].
- `wrapText` is ANSI-aware, preserves explicit newlines, hard-truncates over-wide tokens, and always returns at least one row [wrap-text.ts:wrapText].
- The spinner frame is a deterministic function of elapsed seconds; no counter or interval is stored [activity-line.ts:activitySpinnerFrame].
- `awaiting_approval` renders a fixed pause glyph and anchors elapsed time at the wait start rather than spinning [activity-line.ts:formatActivityLine].
- Streaming and terminal activity states render no live indicator (`undefined`) [activity-line.ts:isTransientActivityState].
- Agent scrollback stage attribution applies only to the last turn and only to the first content event of each stage [scroll-math.ts:buildAgentScrollbackLines].
- `computeViewport` derives all geometry from dimensions and clamps scrollback rows, text width, and composer rows to non-negative values [scroll-math.ts:computeViewport].
- `DashboardView` uses a 2x2 grid only when columns are at least 120 and body height at least 28; otherwise it stacks all four panels [dashboard-view.ts:DashboardView].
- `ApprovalsView` is a read-only log of resolved approvals; pending approvals render inline in the agent tab [approvals-view.ts:ApprovalsView].

## Side Effects
- Views write ANSI text into `ViewRenderContext.canvas` (agent, chat, dashboard, policy, sops, daemon, runtime) and return `rows: []` in that mode; with no canvas they return row arrays [types.ts:ViewRenderContext], [chat-view.ts:ChatView], [policy-view.ts:PolicyView].
- `buildAgentScrollbackLines` reads the wall clock via `Date.now()` for running-stage timers and activity elapsed values; it emits no events per tick [scroll-math.ts:buildAgentScrollbackLines], [activity-line.ts:formatActivityLine].
- Formatting helpers construct `Date` values for display timestamps (approval log, runtime trace, daemon sample) without persisting them [approvals-view.ts:ApprovalsView], [runtime-view.ts:RuntimeView], [daemon-view.ts:DaemonView].
- The package performs no file, network, or process I/O; rendering is confined to canvas writes or returned rows [bottom-anchored-viewport.ts:renderBottomAnchoredSlice], [wrap-text.ts:wrapText].

## Verification
- Run: `pnpm test`
