# Workbench Presentation Model

## Overview
Renderer-neutral, immutable view models for the Workbench shell. This package defines the operator UI state, action vocabulary, selection filters, roster summaries, transcript shape, artifact/diff inspection views, and theme tokens consumed by both ANSI and native renderers. It carries presentation facts only; runtime truth remains in `AgentSession` and `EventLog`.

## Interface
- `WorkbenchUiState`, `createInitialWorkbenchUiState`, and the focus/drawer/mode/filter/scope/overlay unions [ui-state.ts:WorkbenchUiState] [ui-state.ts:createInitialWorkbenchUiState]
- `WorkbenchUiAction` and `ComposerEditAction` as the typed presentation action vocabulary [ui-action.ts:WorkbenchUiAction]
- `coordinationRunIds`, `visibleForRun`, `visibleArtifacts`, `artifactItemsFrom`, and `approvalVisibleTo` as pure selection helpers [selection.ts:visibleArtifacts]
- `AgentSummary`, `AgentRosterSnapshot`, and `WorkbenchAgentState` [agent-roster.ts:AgentRosterSnapshot]
- `TaskSummary`, `TaskRosterSnapshot`, and `WorkbenchTaskState` [task-roster.ts:TaskRosterSnapshot]
- `buildAgentInspectorModel` joins selected agent, task, approvals, artifacts, activity, and usage [agent-inspector.ts:buildAgentInspectorModel]
- `TranscriptItem`, `ToolItem`, `ConversationSnapshot`, and `TranscriptSourceRange` [transcript-item.ts:TranscriptItem]
- `getTranscriptFocusAgentId` and `transcriptItemMatchesFilter` [transcript-filter.ts:transcriptItemMatchesFilter]
- `WorkbenchInspectableItem` and `WorkbenchArtifactSnapshot` [artifact-inspection.ts:WorkbenchInspectableItem]
- `WorkbenchDiffSummary` and `WorkbenchDiffSnapshot` [diff-summary.ts:WorkbenchDiffSummary]
- `getWorkbenchPreviewTheme` and `getWorkbenchAgentPresentation` for truecolor/ANSI-16/monochrome and Unicode/ASCII parity [preview-theme.ts:getWorkbenchPreviewTheme]
- `projectOperatorShell` and `OperatorShellSnapshot` [operator-shell.ts:projectOperatorShell]
- `taskStateGlyph`, `formatByteSize`, and `formatCoordMeta` [display-format.ts:taskStateGlyph]

## Invariants
- UI state is readonly and starts with composer focus, follow-tail enabled, no overlays, and a closed drawer [ui-state.ts:createInitialWorkbenchUiState]
- Undefined run or agent selection means aggregate scope; undefined task means the selected agent's current task [ui-state.ts:WorkbenchUiState]
- Artifact filters apply each provided run, agent, and task correlation strictly [selection.ts:visibleArtifacts]
- An approval with no agent id is visible to every agent; an agent-scoped approval is visible only to that agent [selection.ts:approvalVisibleTo]
- Agent inspector identity is by exact id within the selected run; labels never establish identity [agent-inspector.ts:buildAgentInspectorModel]
- Terminal agents cannot report live activity, and a tool call already present in the trace as non-running is not live [agent-inspector.ts:buildAgentInspectorModel]
- Session activity is used only as an aggregate fallback when no roster activity exists [agent-inspector.ts:buildAgentInspectorModel]
- Token and cost totals ignore non-finite or negative values and mark partial coverage explicitly [agent-inspector.ts:buildAgentInspectorModel]
- Transcript items preserve their source event sequence range [transcript-item.ts:TranscriptSourceRange]
- Approval items pass every transcript filter; error filtering includes failed tool groups [transcript-filter.ts:transcriptItemMatchesFilter]
- Themes return frozen palettes and glyph sets; lifecycle labels remain readable without color or Unicode [preview-theme.ts:getWorkbenchPreviewTheme]
- A pending approval replaces generic liveness in the operator status line [operator-shell.ts:projectOperatorShell]

## Side Effects
- None

## Verification
- Run: `pnpm test`
