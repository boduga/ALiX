# Workbench View State

## Overview
The renderer-neutral presentation boundary for the Workbench agent surface. One immutable `WorkbenchViewState` is assembled from the dashboard snapshot plus the feature-gated `WorkbenchUiState`, then consumed unchanged by both the ANSI canvas renderer and the native OpenTUI renderer. Neither renderer derives additional semantic runtime or operator-intent state from it.

## Interface
- `WorkbenchViewState` — header, footer, roster, transcript, inspector, composer, approval, selection, overlay, and focus [types.ts:WorkbenchViewState]
- `WorkbenchViewSelection` — `selectedRunId`, `selectedAgentId`, `selectedTaskId`, `selectedArtifactId`; undefined is the explicit aggregate scope [types.ts:WorkbenchViewSelection]
- `WorkbenchViewRoster` — `agents`, `tasks`, `artifacts`, each nullable [types.ts:WorkbenchViewRoster]
- `WorkbenchViewTranscript` — conversation plus `mode`, `filter`, `scope`, `followTail`, and optional `scrollRowsFromTail` [types.ts:WorkbenchViewTranscript]
- `WorkbenchViewComposer` — composer, coordination entry, and queued messages [types.ts:WorkbenchViewComposer]
- `WorkbenchViewOverlay` — overlay stack/scroll, drawer/scroll, and `agentRosterExpanded` [types.ts:WorkbenchViewOverlay]
- `WorkbenchViewStateInput`, `WorkbenchFrameViewInput` — assembly inputs [assemble.ts:WorkbenchViewStateInput], [assemble.ts:WorkbenchFrameViewInput]
- `assembleWorkbenchViewState(input)` — pure composer [assemble.ts:assembleWorkbenchViewState]
- `buildWorkbenchFrameViewState(input)` — the single agent-surface frame assembly both renderers consume [assemble.ts:buildWorkbenchFrameViewState]
- No subdirectories.

## Invariants
- `assembleWorkbenchViewState` is pure: it reads only the supplied snapshot, UI store, chrome projection, and transcript sources — no runtime service or event log [assemble.ts:assembleWorkbenchViewState]
- Header and footer are the same `OperatorShellSnapshot` value; chrome is one model rendered on two rows [assemble.ts:assembleWorkbenchViewState]
- The transcript is built by the memoized `projectConversation`, so it is never projected twice per frame [assemble.ts:assembleWorkbenchViewState]
- Transcript mode narrows to `detailed` or `compact` for projection while the view state preserves the original `ui.transcriptMode` [assemble.ts:assembleWorkbenchViewState]
- `approval` falls back to `snapshot.approvals?.pending ?? []` when no explicit list is supplied [assemble.ts:assembleWorkbenchViewState]
- `scrollRowsFromTail` defaults to `0` when not supplied [assemble.ts:assembleWorkbenchViewState]
- Selection fields are copied verbatim from the UI store; absent fields stay absent rather than being synthesized [assemble.ts:assembleWorkbenchViewState]
- `buildWorkbenchFrameViewState` forwards pending approvals with `args: {}` and `requestedBy: 'system'` [assemble.ts:buildWorkbenchFrameViewState]
- `buildWorkbenchFrameViewState` supplies the chrome projection itself (legacy/live inputs needed), whereas `assembleWorkbenchViewState` requires it [assemble.ts:buildWorkbenchFrameViewState], [assemble.ts:assembleWorkbenchViewState]
- Renderers treat this type as read-only presentation input and do not add semantic state [types.ts:WorkbenchViewState]

## Side Effects
- `["None"]` — no disk, network, clock, or store writes; assembly is an in-memory object composition [assemble.ts:assembleWorkbenchViewState]

## Verification
- Run: `pnpm test`
