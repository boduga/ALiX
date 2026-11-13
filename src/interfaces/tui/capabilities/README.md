# TUI Capability Surface

## Overview
This directory binds the Capability Platform to the terminal UI. `CapabilityService` is a thin façade that owns the platform instance and an `InvocationPresenter`, bridging `capability.*` platform events into the runtime `EventLog`. `CapabilitiesView` is the full-tab browser (list + detail), `PaletteModal` is the Command Palette provider, `ChatInvocationPresenter` routes settled invocations into the chat timeline, and `schema-renderer` turns declared JSON schemas into readable terminal lines. Everything here is presentation: it invokes capabilities and renders their state, but it never decides whether an invocation is permitted.

## Interface
- `CapabilityService` — TUI façade: `platform`, `ready`, `query`, `find`, `getStatus`, `setPresenter`, `invoke` `[capability-service.ts:CapabilityService]`.
- `CapabilityServiceOptions` — `eventLog`, `sessionId`, `actor`, `cwd`, `toolExecutor`, `catalogDir` `[capability-service.ts:CapabilityServiceOptions]`.
- `ToolExecutorLike` — the bootstrap-owned `execute(req)` seam used for `tool.*` capabilities `[capability-service.ts:ToolExecutorLike]`.
- `setCapabilityService`, `getCapabilityService`, `clearCapabilityService` — module-level singleton accessor; `getCapabilityService` throws when unset `[capability-service.ts:getCapabilityService]`.
- `CapabilitiesView` — `TuiView` with `id: 'capabilities'`, implemented by `render` and `handleKey` `[capabilities-view.ts:CapabilitiesView]`.
- `PaletteAction`, `PaletteEntry`, `PaletteProvider` — palette contracts; a UI action is explicitly not a capability `[palette.ts:PaletteProvider]`.
- `CapabilityProvider` — palette provider that maps capabilities to entries whose `invoke` calls `service.invoke` `[palette.ts:CapabilityProvider]`.
- `ActionProvider` — currently stub support as an empty provider `[palette.ts:ActionProvider]`.
- `PaletteModal` — pure modal state over entries and a cursor: `setEntries`, `refresh`, `list`, `empty`, `selected`, `selectedIndex`, `move` `[palette.ts:PaletteModal]`.
- `InvocationPresenter`, `InvocationInput`, `CapabilityStatus` — presenter contracts; `InvocationInput` optionally carries the capability's `resultSchema` `[invocation-presenter.ts:InvocationPresenter]` `[invocation-presenter.ts:InvocationInput]`.
- `CapabilityEmitContext` — `eventLog` plus `sessionId` for the authoritative `chat.response` settlement entry `[invocation-presenter.ts:CapabilityEmitContext]`.
- `capabilityStatusText` — formats `id [running]` / `[completed ✓]` / `[failed ✗]` / `[cancelled]` `[invocation-presenter.ts:capabilityStatusText]`.
- `ChatInvocationPresenter` — consumes an invocation's event stream, awaits `wait()`, and emits one `chat.response` entry `[invocation-presenter.ts:ChatInvocationPresenter]`.
- `renderSchemaResult` — renders runtime output against a declared result schema, falling back to stringified JSON `[schema-renderer.ts:renderSchemaResult]`.
- `renderSchemaShape` — renders a declared schema's shape for the detail pane `[schema-renderer.ts:renderSchemaShape]`.
- Sibling tab contract: [../AGENTS.md](../AGENTS.md).

## Invariants
- `getCapabilityService` throws `CapabilityService not initialized` rather than returning a partial service `[capability-service.ts:getCapabilityService]`.
- `CapabilitiesView.render` and `handleKey` both catch the missing-service case: `render` paints an offline line and returns no rows, `handleKey` returns `{ type: 'handled' }` as a no-op `[capabilities-view.ts:CapabilitiesView]`.
- A service constructed without an `eventLog` gets a throwaway `EventLog` under the OS temp dir; it never falls back to `process.cwd()` or `cwd`, because registration appends synchronously at construction `[capability-service.ts:CapabilityService]` `[../AGENTS.md:CapabilityService]`.
- The default `catalogDir` is also a temp directory, applied after the options spread so an explicitly-undefined `catalogDir` cannot reset it to `process.cwd()` `[capability-service.ts:CapabilityService]`.
- The event bridge subscribes before initial capabilities are registered, because the EventBus does not replay past events to late subscribers `[capability-service.ts:wireEventBridge]`.
- Registry-derived `tool.*` capabilities are registered synchronously in the constructor, so the palette surface is complete and deterministically ordered before async session wiring resolves `[capability-service.ts:CapabilityService]`.
- `ready()` resolves only after the async session/tool wiring settles `[capability-service.ts:ready]`.
- A missing `toolExecutor` leaves tool capabilities unavailable instead of crashing; session-integration failure is logged and tolerated `[capability-service.ts:initialize]`.
- `invoke` is the single invocation path and presents automatically; a presenter rejection is swallowed and logged so it cannot fail the invocation `[capability-service.ts:invoke]`.
- `invoke` passes the capability's `resultSchema` to the presenter so structured output can be rendered `[capability-service.ts:invoke]`.
- `ChatInvocationPresenter` never pushes into per-tab state; the EventLog is the single timeline source of truth `[invocation-presenter.ts:ChatInvocationPresenter]`.
- Settled output/error are merged from `wait()` only when consistent with the event-path terminal status, so a diverged result cannot clobber a terminal status `[invocation-presenter.ts:ChatInvocationPresenter]`.
- `InvocationCompleted` carries no output — output lives only on the `wait()` result `[invocation-presenter.ts:ChatInvocationPresenter]`.
- `capabilityStatusText` appends output only when it is present and non-empty, avoiding `[completed ✓] ""` and `undefined` `[invocation-presenter.ts:capabilityStatusText]`.
- `CapabilitiesView` search is subsequence-fuzzy over the capability title or id, matching the palette behavior `[capabilities-view.ts:filtered]` `[palette.ts:subsequenceMatches]`.
- Detail selection lazily initializes to the first filtered capability; `render` otherwise treats `ctx.perTab` as read-only and all other writes happen in `handleKey` `[capabilities-view.ts:CapabilitiesView]`.
- Key handling is arrow/`j`/`k` cycling with wraparound, `Enter` to invoke, `Backspace` to trim the query, and any single character appended to the query `[capabilities-view.ts:handleKey]`.
- Availability dots map available (or no status) to green, degraded to yellow, and anything else to red `[capabilities-view.ts:CapabilitiesView]`.
- The activity block renders only when measured activity exists (`invocationCount > 0` or `toolInvocationCount > 0`), never as a zero placeholder `[capabilities-view.ts:CapabilitiesView]`.
- `PaletteModal.refresh` clamps the cursor into the new entry range, and `move` wraps modulo the entry count while leaving an empty list at cursor 0 `[palette.ts:PaletteModal]`.
- `PaletteModal` defaults to `[CapabilityProvider, ActionProvider]`; `ActionProvider.search` returns an empty list `[palette.ts:PaletteModal]` `[palette.ts:ActionProvider]`.
- `renderSchemaShape` returns `[]` for an absent or type-less schema, `["object"]` for an object with no properties, and `[] T` for an array `[schema-renderer.ts:renderSchemaShape]`.
- `renderSchemaResult` falls back to stringified JSON when the schema is absent or has no `type`, and degrades cyclic structures to `(cycle)` instead of overflowing `[schema-renderer.ts:renderSchemaResult]`.

## Side Effects
- Capability registration writes definitions to the platform store under `catalogDir` and appends `capability.*` events to the resolved `EventLog` `[capability-service.ts:CapabilityService]` `[capability-service.ts:wireEventBridge]`.
- `invoke` starts a platform invocation with `actor`, `cwd`, `workspace`, and `sessionId`, which may run tools, sessions, or other capability implementations `[capability-service.ts:invoke]`.
- `ChatInvocationPresenter` appends a `chat.response` log entry with the settled status text when an emit context is supplied `[invocation-presenter.ts:ChatInvocationPresenter]`.
- Session integration and tool providers are registered asynchronously on construction `[capability-service.ts:initialize]`.
- Session-integration and presenter failures are written to `console.error` `[capability-service.ts:initialize]` `[capability-service.ts:invoke]`.
- `CapabilitiesView.render` writes directly to the terminal canvas, including ANSI-styled list and detail rows `[capabilities-view.ts:CapabilitiesView]`.

## Verification
- Run: `pnpm test`
