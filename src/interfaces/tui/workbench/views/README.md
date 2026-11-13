# Workbench Views

## Overview
Presentation-only painters and line builders for the Workbench surface. Each module takes an immutable snapshot or display model and emits bounded ANSI rows or canvas writes; none owns runtime truth, dispatches operator intent, or persists state.

## Interface
- `PaintOperatorShellInput` and `paintOperatorShell()` render the three-row header, status line, footer hints, and counters [operator-shell.ts:PaintOperatorShellInput] [operator-shell.ts:paintOperatorShell]
- `OperatorStatusTone`, `OperatorStatusSegment`, and `buildOperatorStatusSegments()` produce the shared status text/emphasis consumed by both renderers [operator-shell.ts:buildOperatorStatusSegments]
- `paintRosterDrawer()` renders the agents, tasks, and artifacts drawers from roster snapshots and responsive layout [roster-drawer.ts:paintRosterDrawer]
- `buildWorkbenchDiagnosticLines()` derives operator-actionable diagnostics; `paintWorkbenchDiagnosticOverlay()` paints help, diff, review, diagnostics, and coordination overlays [diagnostic-overlay.ts:buildWorkbenchDiagnosticLines] [diagnostic-overlay.ts:paintWorkbenchDiagnosticOverlay]
- `WorkbenchScrollbackLine` and `buildWorkbenchScrollbackLines()` convert the semantic transcript into viewport lines [workbench-scrollback.ts:buildWorkbenchScrollbackLines]
- `WorkbenchToolCardOptions`, `WorkbenchToolCardLine`, and `buildWorkbenchToolCardLines()` build bounded tool cards [tool-card.ts:buildWorkbenchToolCardLines]
- `WORKBENCH_APPROVAL_DECISION_ROW`, `workbenchApprovalDecisionSpans()`, `buildWorkbenchApprovalCardLines()`, and `paintWorkbenchApprovalDialog()` own approval card rows and dialog geometry [approval-dialog.ts:buildWorkbenchApprovalCardLines] [approval-dialog.ts:paintWorkbenchApprovalDialog]
- `ComposerLayout`, `layoutComposer()`, and `layoutWorkbenchSurface()` compute composer and surface geometry [composer-view.ts:layoutComposer] [composer-view.ts:layoutWorkbenchSurface]
- `validateCoordinationObjective()` and `paintCoordinationEntry()` own objective validation and entry painting [coordination-entry.ts:validateCoordinationObjective] [coordination-entry.ts:paintCoordinationEntry]
- `paintTranscriptToolbar()` renders transcript filter, follow, scope, mode, and focus chrome [transcript-toolbar.ts:paintTranscriptToolbar]
- `InspectorSection`, `buildAgentInspectorSections()`, and `paintAgentInspector()` render the inspector's five ordered sections [agent-inspector.ts:buildAgentInspectorSections] [agent-inspector.ts:paintAgentInspector]

## Invariants
- The operator status line derives from `buildOperatorStatusSegments`; approval wait replaces the running/liveness line rather than sharing it, and elapsed text uses the supplied paint-time clock [operator-shell.ts:buildOperatorStatusSegments]
- Status text truncates under width pressure, never the right-aligned row-1 facts; approval and cancellation keys are indivisible and optional hint groups are dropped first [operator-shell.ts:paintOperatorShell]
- The header always reserves three rows and the footer one row; branding shortens from `ALiX WORKBENCH` to `ALiX` to empty before mode is hidden [operator-shell.ts:paintOperatorShell]
- Roster selection stays visible: `rosterWindowOffset` advances the window until the selected row fits and never rewrites the operator's requested offset [roster-drawer.ts:rosterWindowOffset]
- Agent-to-task joins are presentation-only identity lookups scoped by `coordinationRunId`; an ambiguous join resolves to no task rather than a guess [roster-drawer.ts:joinedAgentTask]
- The agents drawer requires at least 4 columns and 3 rows, and falls back to a `AGENTS & TASKS` label below that [roster-drawer.ts:paintPreviewAgentRoster]
- The tasks drawer shows `Tasks unavailable` when no snapshot exists and `No delegated tasks` for an empty snapshot [roster-drawer.ts:paintPreviewTaskRoster]
- Diagnostics scope narrows by selected run, agent, and task; failed and stalled agents, failed and blocked tasks, and failed artifacts are counted [diagnostic-overlay.ts:buildWorkbenchDiagnosticLines]
- The diagnostic overlay does not paint below 30 columns or fewer than 4 body rows, is capped at 88x18, and clamps `scrollOffset` to the wrapped content [diagnostic-overlay.ts:paintWorkbenchDiagnosticOverlay]
- `coordination` overlay painting always reports `mode unavailable` and launches nothing [diagnostic-overlay.ts:paintWorkbenchDiagnosticOverlay]
- The history portion of scrollback is memoized by content key; only the clock-dependent live activity tail rebuilds per call [workbench-scrollback.ts:scrollbackCacheKey] [workbench-scrollback.ts:buildScrollbackTail]
- Cache invalidation is content-based, never reference identity; cached lines are plain data with no `ctx` references [workbench-scrollback.ts:buildStableScrollbackLines]
- Approval cards keep the pending record authoritatively; a key decision never removes the card before projection resolves it [workbench-scrollback.ts:buildStableScrollbackLines]
- Streaming text is rendered only when it has not already landed as the latest assistant prose, and only under `all`/`response` filters without an agent focus [workbench-scrollback.ts:buildStableScrollbackLines]
- Rows are tagged with stable item IDs and wrapped offsets by `tagRows` [workbench-scrollback.ts:tagRows]
- Tool card text strips terminal escape/control sequences and is bounded to 2048 field characters, 4096 detail characters, 8 detail rows, and 8 metadata rows [tool-card.ts:safeToolCardText]
- Tool cards are pure and never read the displayed path; a card narrower than 8 columns degrades to a two-row summary [tool-card.ts:buildWorkbenchToolCardLines]
- Approval cards require at least 12 columns, cap card width at 76, and decision spans derive from the single `WORKBENCH_APPROVAL_DECISION_ROW` literal [approval-dialog.ts:buildWorkbenchApprovalCardLines] [approval-dialog.ts:workbenchApprovalDecisionSpans]
- The composer is capped at 5 rows, uses grapheme-aware cursor movement, keeps content width at `max(1, columns - 4)`, and moves the caret to a new row when the current row fills [composer-view.ts:layoutComposer]
- Coordination objectives are required, capped at 12,000 characters, and reject control characters [coordination-entry.ts:validateCoordinationObjective]
- Coordination entry painting is bounded to 88 columns by 14 rows [coordination-entry.ts:paintCoordinationEntry]
- Inspector sections render in fixed order: `AGENT DETAILS`, `LIVE ACTIVITY`, `APPROVALS`, `ARTIFACTS`, `USAGE` [agent-inspector.ts:buildAgentInspectorSections]
- Inspector activity prefers roster data, then session data, then an explicit fallback; approval and artifact lists bound with overflow counts [agent-inspector.ts:buildAgentInspectorSections]
- Transcript toolbar filters are `all | response | tool | activity | error`, with compact labels under width pressure [transcript-toolbar.ts:paintTranscriptToolbar]

## Side Effects
- All painters write ANSI text into a `TerminalCanvas`; some return rows instead of painting [operator-shell.ts:paintOperatorShell] [diagnostic-overlay.ts:paintWorkbenchDiagnosticOverlay]
- `paintOperatorShell` reads `Date.now()` for status elapsed text; `buildOperatorStatusSegments` uses its supplied `now` [operator-shell.ts:paintOperatorShell]
- `buildWorkbenchDiagnosticLines` performs no runtime mutation and only joins supplied snapshots [diagnostic-overlay.ts:buildWorkbenchDiagnosticLines]
- `buildWorkbenchScrollbackLines` keeps one module-level single-entry cache of plain line data [workbench-scrollback.ts:scrollbackCacheKey]
- No file, network, or process I/O; the modules only render supplied display state [tool-card.ts:buildWorkbenchToolCardLines] [roster-drawer.ts:paintRosterDrawer]

## Verification
- Run: `pnpm test`
