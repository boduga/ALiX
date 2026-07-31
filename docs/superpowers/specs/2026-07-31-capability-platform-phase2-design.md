# ALiX Capability Platform — Phase 2 Design (TUI Consumers)

**Status:** Approved Design
**Date:** 2026-07-31
**Depends on:** Phase 1 (`docs/superpowers/specs/2026-07-31-capability-platform-design.md`) — merged 2026-07-31

> The first consumers of the Capability Platform: the **Command Palette** and the **Capabilities tab** in the ALiX TUI. ALiX is fundamentally conversational — capabilities are execution primitives, the chat is the operator timeline, and the platform stays UI-unaware.

## Goal

Deliver two TUI interfaces over the Phase-1 Capability Platform:

1. **Command Palette** — a fast launcher ("I know what I want to do"): fuzzy-search capabilities, Enter to invoke.
2. **Capabilities tab** — a searchable catalog ("What can ALiX do?"): browse, inspect, learn, discover.

Both share one in-process `CapabilityPlatform` instance and one **Invocation Presenter** that routes invocation output into the chat/agent timeline. The platform itself never imports from `src/tui/`.

## Design Decisions

| # | Decision |
|---|---|
| D1 | **One spec/plan for both interfaces**, implemented in sequence: Palette first (smaller, high-leverage), Capabilities tab second. |
| D2 | **In-process platform**: the TUI owns a `CapabilityPlatform` instance; invocations run natively via `runtime.invoke`. Events bridge to the existing `EventLog` via `toAlixEvent` so invocations are observable. |
| D3 | **Full working set**: `registerInitialCapabilities` + `registerSessionCapabilities` (real session API) + the tool adapter (`createToolExecutorAdapter` over the real `ToolExecutor`) — everything Phase 1 defined can be genuinely invoked. |
| D4 | **Invocation Presenter** is the presentation boundary: the palette/capabilities tab are *launchers*, the chat view is the operator's execution history, the EventLog is the audit trail. The platform never knows about any UI. |
| D5 | **Palette behavior is capability-only this phase**, but its **architecture supports multiple providers day one** (`CapabilityProvider` enabled, `ActionProvider` stubbed empty). UI actions are **not** capabilities — they use a separate `PaletteAction { id, title, run() }` interface. |
| D6 | **Capabilities is a dedicated 9th TUI tab** (tabs represent content, not interaction). Palette = modal overlay. |
| D7 | **Module boundary**: `src/tui/capabilities/` owns the service + presenter + palette + tab. |
| D8 | **`CapabilityService.invoke()` presents automatically** — the service owns the `InvocationPresenter` and wires it internally, so every invocation is presented (EventLog + chat + streaming) without each caller remembering to call the presenter. Presentation policy is centralized. |
| D9 | **Invocation ownership invariant**: only `CapabilityService.invoke()` may create user-facing capability execution — views and palette entries never call `CapabilityRuntime` directly. |
| D10 | **Infrastructure is bootstrap-owned**: the CLI bootstrap constructs the `ToolExecutor`/session dependencies and passes them to the service (via `CapabilityServiceOptions.toolExecutor`); the service wires them into the platform but does not construct infrastructure. |

## Architecture

```
src/tui/capabilities/
├── capability-service.ts    CapabilityService — the TUI façade over the platform. Owns the
│                            process-local CapabilityPlatform instance + the
│                            InvocationPresenter, wires the full working set (bootstrap-owned
│                            ToolExecutor passed in) + EventLog bridge; exposes
│                            query/find/getStatus/invoke. invoke() internally calls
│                            presenter.present(input) so every invocation is presented.
├── invocation-presenter.ts  InvocationPresenter interface (present(input: InvocationInput))
│                            + ChatInvocationPresenter (appends a structured entry to the chat
│                            timeline).
├── palette.ts               Command Palette modal: PaletteProvider + CapabilityProvider
│                            (enabled) + ActionProvider (stub); PaletteAction interface.
└── capabilities-view.ts     The Capabilities tab: searchable list + detail pane.
```

`CapabilityService.invoke()` is the single invocation path — no caller ever touches the runtime or the presenter directly:

```ts
async invoke(id: string, args: Record<string, unknown>): Promise<Invocation> {
  const invocation = this.runtime.invoke(id, args, this.makeContext());
  this.presenter.present(invocation);   // centralized presentation policy
  return invocation;
}
```

**TuiApp wiring:**

- `TAB_ORDER` += `capabilities`; `views/index.ts` registers `capabilities-view`.
- `parseKey`: `0x10` → `'Ctrl+p'`; `/` opens the palette when the chat input is empty.
- Palette renders as a modal overlay painted last (the `paintPlanApprovalCard` precedent).
- The presenter gets one small hook into the chat view: an `appendEntry` for non-LLM capability-invocation entries.

**Invariants:**

- Capabilities flow only `Registry → Runtime → Invocation`; never bypassed.
- UI actions use `PaletteAction`, never `Capability`.
- The platform (`src/capability/*`) never imports from `src/tui/` (Phase-1 invariant 9).

## Data Flow

```
Palette / Capabilities tab
        │  capabilityService.invoke(id, args)   ← the ONLY invocation path
        ▼
CapabilityService.invoke
        ├── CapabilityRuntime.invoke → Invocation
        ├── presenter.present({ invocation, capabilityId, args })   ← centralized
        └── return invocation
              │
              ├──(a) Audit:  platform.events (EventBus) ──toAlixEvent──▶ EventLog.append
              │              (started / completed / failed / cancelled, actor "system")
              │
              └──(b) Present: InvocationPresenter.present(input)
                              └─ ChatInvocationPresenter: appends a structured
                                 timeline entry — "⚡ core.session.list [running]" →
                                 "completed ✓ {output}" / "failed ✗ {error}" / "cancelled"
```

- **Invocation inputs:** `actor` = current session actor (default `operator`), `cwd`/`workspace` = the TUI working dir, `sessionId` = current session id (empty when none) — so `core.session.*` work against real sessions.
- **Async lifecycle:** the presenter subscribes to the invocation's own `events()` stream (Phase-1 fix means terminal events flow there), so the chat entry transitions running → completed/failed/cancelled live. `Invocation.events()` is backed by the `AsyncEventQueue`, which **buffers emitted events until consumed — so a late subscriber still receives the full lifecycle** (no race between `invoke()` returning and the presenter attaching).
- **Errors surface as data:** unknown capability / missing executor throw at `invoke()` (launcher catches → status line); validation/permission/executor failures become `Invocation.status === "failed"` with `error` → presented.

## UI Details

**Command Palette (modal overlay)**

- Opens with **Ctrl+P**, or **/** when the chat input is empty.
- Input line + filtered results below; **subsequence fuzzy match** over capability `title` + `id` (via `registry.query`) — `cslist` finds `core.session.list`.
- ArrowUp/Down (or j/k) move selection; **Enter** invokes → presenter → dismiss; **Esc** dismisses; typing refilters; empty query shows the full catalog.
- Row: `title` + `id` (subtitle) + risk glyph + availability dot (green/yellow/red from `getStatus`).
- `ActionProvider` registered but empty — only capabilities appear this phase.

**Capabilities tab (9th tab, "Capabilities")**

- **Left:** search input + scrollable list — `title`, `id`, availability dot.
- **Right (detail):** `description`, `category`, `tags`, `risk`, `requiredPermissions`, `execution {strategy, timeout, cancellable}`, `argsSchema` (pretty-printed), `resultSchema`, `examples`, `dependencies`, `extensions`, `availability` + `lastChecked`.
- **Interaction:** typing filters; ArrowUp/Down (or j/k) move; **Enter** invokes with `{}` args this phase (arg entry deferred — required-arg capabilities surface a clean "argument required" error via the presenter); **Tab** toggles detail; **Esc** returns home.
- Empty query → all capabilities; no matches → "No capabilities found".

## Error Handling

- **Unknown capability id / missing executor** → typed error at `invoke()`; launcher catches → one-line status/toast; palette stays usable.
- **Validation / permission / executor failures** → `Invocation` `failed` with `error` string → presenter renders it in the timeline entry.
- **Cancel:** no cancel affordance this phase; a cancelled invocation renders as `cancelled`.
- **EventLog bridge non-fatal:** `toAlixEvent`/append wrapped in try/catch — observability never breaks an invocation (same pattern as the server's `fileAudit`).
- **Platform init degradation:** if wiring the real session API or tool executor throws, `CapabilityService` logs and continues — the catalog still lists everything, affected capabilities report `unavailable` via `getStatus`.
- **Launcher args are `{}` this phase:** required-arg capabilities surface their own clean "argument required" error — no silent partial invocations.

## Testing Strategy

- **Unit (vitest)** per component:
  - `capability-service` — full wiring; `query/find/getStatus`; event bridge appends to a mock EventLog (started→completed, `capability.*` type); **`invoke()` calls `presenter.present` automatically** (recorder mock asserts it); unknown id → typed error.
  - `invocation-presenter` — recorder mock asserts `present` receives the invocation; `ChatInvocationPresenter` appends running→completed/failed entries against a mock chat `appendEntry` hook.
  - `palette` providers — `CapabilityProvider.search`: fuzzy match, empty query → full catalog, no match → `[]`; `ActionProvider` → `[]`; entry `invoke()` → `service.invoke`.
  - `capabilities-view` — list/detail render from a seeded registry; selection; Enter; Tab; empty state.
  - Error paths — unknown id → status; failed invocation → presenter error entry.
- **Integration (vitest):** palette + capabilities view against a real `CapabilityPlatform` with `registerInitialCapabilities` + fake session handler + fake tool executor — end-to-end `query → invoke → presenter → chat entry`, no real TTY.
- **Render:** tab + modal use canvas primitives, tested via the existing `render.vitest.ts` pattern.
- **Boundary principle:** the platform keeps its own 46-test suite; TUI tests verify only the adapter layer.

## Success Criteria

- `Ctrl+P` opens the palette from any tab; fuzzy search finds `core.session.list`, `tool.shell.run`, etc.; Enter invokes and the result appears in the chat timeline; `platform.events` events land in the EventLog.
- The Capabilities tab lists all registered capabilities with live availability; detail pane shows full metadata; Enter invokes.
- `pnpm test:vitest` green (new tests + no regressions); `tsc --noEmit` clean.
- Phase 2 adds consumers only — `src/capability/*` is not modified.

## Non-Goals (Phase 2)

- ❌ Arg entry UI (invocations use `{}`).
- ❌ Invocation cancellation UI.
- ❌ Invocation history persistence (`InvocationStore` — still Phase-1 non-goal).
- ❌ `ActionProvider` entries (UI actions in the palette — architecture exists, empty).
- ❌ Web/MCP consumers.
- ❌ Any change to the platform's public API or behavior.

## Future Direction (Phase 3, not this phase)

The `InvocationPresenter` boundary is designed to host more targets later — Web UI, REST, MCP, notifications. When multiple targets coexist, the presenter can become a multicast interface (EventBus-style) so one invocation fans out to every presentation target. `CapabilityService` is the seam where that happens; this phase ships a single `ChatInvocationPresenter`.
