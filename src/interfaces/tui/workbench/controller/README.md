# Workbench Controller

## Overview
Renderer-neutral intent layer for the Workbench. Both the ANSI canvas host and the OpenTUI host route a `WorkbenchInputIntent` here, and this package decides which transition layer owns it — a pure store dispatch, an effectful host call, or a selection change — without touching terminal I/O or runtime services.

## Interface
- `applyWorkbenchIntent(store, intent, context)` composes the three appliers and is the single intent entry for both renderers [intent.ts:applyWorkbenchIntent]
- `WorkbenchIntentContext` supplies the selection snapshot, host ports, and coordination availability [intent.ts:WorkbenchIntentContext]
- `applyWorkbenchSelectionIntent` resolves follow-toggle, agent shortcuts, drawer movement, and run movement [intent.ts:applyWorkbenchSelectionIntent]
- `applyWorkbenchStoreIntent(store, intent, context)` dispatches store-only intents and returns declarative host effects (`repaint`, `syncComposer`, `followToBottom`, `pinnedBottom`, `transcriptMode`) [store-intent.ts:applyWorkbenchStoreIntent]
- `WorkbenchStoreIntentResult` and `WorkbenchStoreIntentContext` [store-intent.ts:WorkbenchStoreIntentResult]
- `applyWorkbenchHostIntent(store, intent, ports)` executes effectful intents through `WorkbenchHostPorts` [host-intent.ts:applyWorkbenchHostIntent]
- `WorkbenchHostPorts` is the host contract (`repaint`, `syncComposer`, `submitTurn`, `submitCoordination`, `resolveApproval`, `cancelActiveTurn`, and related ports) [host-intent.ts:WorkbenchHostPorts]
- `selectAgentShortcut`, `moveAgentSelection`, `moveTaskSelection`, `moveArtifactSelection`, `moveRunSelection`, and `SelectionSnapshot` are the pure selection helpers [selection-intent.ts:SelectionSnapshot]
- `NavigationDirection` is `-1 | 1` [selection-intent.ts:NavigationDirection]

## Invariants
- Layers are tried in order: store-only, then host-effectful, then selection; a store-only result short-circuits the rest [intent.ts:applyWorkbenchIntent]
- Unrecognized intents fall through each applier to `false` / `{ handled: false, repaint: false }` rather than being silently mutated [store-intent.ts:applyWorkbenchStoreIntent] [host-intent.ts:applyWorkbenchHostIntent]
- Store-only intents only dispatch to `WorkbenchStore`; host effects are returned declaratively for the caller to apply [store-intent.ts:applyWorkbenchStoreIntent]
- Follow-toggle is selection-layer and anchors the transcript before dispatching when follow is currently on [intent.ts:applyWorkbenchSelectionIntent]
- Drawer movement dispatches only the selection action matching the open drawer (`agents`, `tasks`, `artifacts`) and no-ops when the drawer has no move target [intent.ts:applyWorkbenchSelectionIntent]
- `coordination.inspect` reports a launch-unavailable status in the store when `coordinationAvailable` is false [store-intent.ts:applyWorkbenchStoreIntent]
- Overlay scroll clamps to `[0, overlayScrollLimit()]` before dispatching a relative delta [host-intent.ts:applyWorkbenchHostIntent]
- `turn.submit` is refused through `reportSubmitUnavailable` when no snapshot exists [host-intent.ts:applyWorkbenchHostIntent]
- Approval resolution never infers a decision locally; it resolves the requested card or the host's oldest pending target and de-duplicates while a decision is in flight [host-intent.ts:applyWorkbenchHostIntent]
- Selection navigation clamps agent/task/artifact indices into range; run selection wraps modulo the run list [selection-intent.ts:moveRunSelection]
- Selections are scoped by `selectedRunId` through `visibleForRun`; labels never establish identity [selection-intent.ts:selectAgentShortcut]

## Side Effects
- Mutates only the `WorkbenchStore` via `store.dispatch(...)` [store-intent.ts:applyWorkbenchStoreIntent]
- Calls host ports for terminal-adjacent effects: repaint, composer mirror, anchor, transcript mode, turn submit/queue, slash, approval resolution, permission cycle, cancel [host-intent.ts:applyWorkbenchHostIntent]
- `turn.queue` stamps `createdAt: Date.now()` on the queued message [host-intent.ts:applyWorkbenchHostIntent]
- No direct terminal I/O, file, or network access in this package [host-intent.ts:WorkbenchHostPorts]

## Verification
- Run: `pnpm test`
