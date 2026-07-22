# TUI Renderer Abstraction — Architecture and Migration Plan

**Date**: 2026-07-21  
**Status**: Approved with revisions  
**Author**: Operator + Claude Code  

---

## Problem

The TUI has two independent architectural issues:

1. **Renderer lock-in**: The homegrown `canvas.ts` is tightly coupled to `app.ts`. There is no abstraction boundary between `DashboardSnapshot` production and pixel-level rendering. Replacing the renderer requires touching every view file.

2. **Scope bloat**: The TUI mirrors capabilities that the web Inspector does better — daemon stats, runtime event streams, SOP browsing, policy rules.

**These are separate concerns addressed in separate PRs.** This spec covers the renderer abstraction (PR A) and the architectural roadmap (PRs B–E).

---

## Principle

> Snapshots are the contract. Renderers are replaceable.

The `DashboardSnapshot` is the stable domain contract. The renderer is an adapter behind a minimal interface — it never consumes application state directly.

---

## Architecture

```
DashboardSnapshot
        ↓
 SnapshotBuilder
        ↓
 ViewModelBuilder
        ↓
 OperatorViewState
        ↓
 +-- LayoutEngine --+
 |                   |
 v                   v
 CanvasRenderer   BlessedRenderer
```

- **ViewModelBuilder** transforms `DashboardSnapshot` → `OperatorViewState` (purely logical, no geometry)
- **LayoutEngine** computes dimensions from terminal size + view state (only used by CanvasRenderer; BlessedRenderer uses blessed layout)
- **OperatorRenderer** consumes `OperatorViewState` only — no knowledge of snapshots, app state, or ALiX internals

---

## OperatorRenderer Interface

```typescript
interface RendererCapabilities {
  supportsMouse: boolean;
  supportsColor: boolean;
  supportsUnicode: boolean;
  supportsTrueColor: boolean;
}

interface OperatorRenderer {
  /** Advertise terminal capabilities for upstream negotiation. */
  capabilities(): RendererCapabilities;

  /** One-time setup. TerminalController provides raw mode, alt buffer, resize events. */
  initialize(terminal: TerminalController): Promise<void>;

  /** Render a single frame from the view model. Called every ~1s. */
  render(viewState: OperatorViewState): void;

  /** Terminal dimensions changed. */
  resize(columns: number, rows: number): void;

  /** Cleanup: restore terminal, free resources. */
  shutdown(): Promise<void>;
}
```

The renderer receives **only** `OperatorViewState`. It does not know `DashboardSnapshot` exists.

---

## OperatorViewState

Purely logical view model — no geometry, no layout, no terminal coordinates.

```typescript
interface OperatorViewState {
  activeTab: TabId;
  tabs: TabInfo[];
  panels: PanelViewModel[];
  input: InputViewModel;
  statusBar: StatusBarViewModel;
}

interface PanelViewModel {
  id: string;
  title: string;
  items: PanelItem[];
  scrollOffset: number;
  focused: boolean;
  // NO dims — layout is the renderer's concern
}
```

The `ViewModelBuilder` produces this from `DashboardSnapshot` + per-tab `PerTabState`.

---

## Directory Structure (PR A target)

```
src/tui/
├── renderer/
│   ├── index.ts          # barrel
│   ├── types.ts          # OperatorRenderer, RendererCapabilities, OperatorViewState
│   └── contract.ts       # canary/test helpers
│
├── renderers/
│   └── canvas-renderer.ts
│
├── view-model/
│   ├── index.ts
│   ├── builder.ts        # ViewModelBuilder
│   └── types.ts          # PanelViewModel, InputViewModel, StatusBarViewModel
│
├── layout/
│   └── layout-engine.ts  # geometry computation (CanvasRenderer uses this)
│
├── app.ts
└── ...
```

Future: `renderers/blessed-renderer.ts`, `renderers/web-renderer.ts`

---

## Strangler Pattern

PR A is a strangler — all canvas rendering moves behind `CanvasRenderer`. No mixed mode:

**Before:**
```typescript
app.render() {
  canvas.clear()
  canvas.drawPanel()
  canvas.drawStatus()
}
```

**After:**
```typescript
app.render() {
  const vm = viewModelBuilder.build(snapshot, perTab);
  renderer.render(vm);
}
```

`app.ts` never calls `canvas.ts` directly again.

---

## Migration Roadmap

```
PR A   Renderer abstraction — OperatorRenderer + CanvasRenderer + ViewModelBuilder
   ↓
PR B   Blessed spike (one-day evaluation)
   ↓
   → ADR-0013: Renderer Abstraction Boundary ←
   ↓
PR C   Adopt Blessed (if spike passes)
PR D   Simplify TUI tabs (deprecate non-core tabs)
PR E   Remove deprecated tabs (after Inspector parity)
```

---

### PR A — Renderer Abstraction (this PR)

1. Define `OperatorRenderer` interface + `RendererCapabilities`
2. Add `ViewModelBuilder` + `OperatorViewState` types
3. Move layout computation to `LayoutEngine` (decoupled from renderer)
4. Wrap current `canvas.ts` rendering as `CanvasRenderer implements OperatorRenderer`
5. Wire into `app.ts` — strangler, no mixed mode, 100% backward compatible
6. All 7 tabs preserved, rendering identical

**Files to create:**

| File | Purpose |
|------|---------|
| `src/tui/renderer/types.ts` | `OperatorRenderer`, `RendererCapabilities` |
| `src/tui/renderer/index.ts` | Barrel |
| `src/tui/renderer/contract.ts` | Test helpers (canary constraints) |
| `src/tui/renderers/canvas-renderer.ts` | `CanvasRenderer implements OperatorRenderer` |
| `src/tui/view-model/types.ts` | `OperatorViewState`, `PanelViewModel`, etc. |
| `src/tui/view-model/builder.ts` | `ViewModelBuilder.build(snapshot, perTab) → OperatorViewState` |
| `src/tui/view-model/index.ts` | Barrel |
| `src/tui/layout/layout-engine.ts` | Geometry computation |

**Files to modify:**

| File | Change |
|------|--------|
| `src/tui/app.ts` | Inject `OperatorRenderer`; use `initialize()`; call `renderer.render(vm)` |
| `src/tui/index.ts` | Export new modules |
| `src/tui/sidebar.ts` | May simplify as side effect of view model extraction |
| `src/tui/dashboard-renderer.ts` | Panel painters → moved/adapted into view model builder |

### PR B — Blessed Spike (one day)

Implement only:
- Status bar
- One panel (approvals)
- Tab bar (no switching logic)
- Chat input

**Evaluation criteria:**

| Criterion | Measure |
|-----------|---------|
| Ergonomics | Lines of blessed setup vs current canvas.ts for same output |
| Resize | Does blessed reflow? Manual handler needed? |
| Scroll | Does blessed List handle scroll or need manual bookkeeping? |
| Input capture | Blessed key handling vs current raw-mode dispatch |
| Code deletion | How many ALiX primitives disappear? (canvas.ts, layout.ts, focus.ts, scroll.ts) |

**Maintenance burden comparison:**

| Metric | Canvas | Blessed |
|--------|--------|---------|
| LOC for same UI | | |
| Custom primitives | | |
| Resize code | | |
| Focus management | | |
| Scroll bookkeeping | | |
| Tests required | | |

### PR C — Adopt Blessed (conditional on spike)

Replace `CanvasRenderer` with `BlessedRenderer`. Remove `canvas.ts`, `layout.ts`, scroll/focus primitives.

### PR D — Simplify TUI Tabs

Reduce from 7 to 5:

```
Chat         → interaction
Agent        → execution
Approvals    → governance (operator action surface)
Overview     → observability (replaces Runtime — daemon health + event count + policy mode)
```

Deprecated (tab stays but labeled):
- Policy (deprecated — use Inspector)
- SOPs (deprecated — use Inspector)

### PR E — Remove Deprecated Tabs

After Inspector reaches feature parity for policy and SOP views.

---

## ADR-0013 (After PR A)

Decision:
> The TUI renderer must never consume application state directly. All rendering receives a renderer-specific view model (`OperatorViewState`) produced from stable domain snapshots. Renderers have no knowledge of `DashboardSnapshot`, `TuiAppState`, or any ALiX domain concept.

---

## Verification

### PR A
1. `pnpm vitest run` — 0 failures
2. `pnpm tsc --noEmit` — clean
3. Manual: `alix tui` starts identically — same 7 tabs, same rendering
4. `alix serve` (Inspector) — unaffected

### PR D/E
1. Updated tab structure reflected in UI
2. Deprecated tabs render but are marked
3. Approvals/chat/agent behavior preserved

---

## Revisions History

| Date | Change |
|------|--------|
| 2026-07-21 | Initial spec — combined renderer + tab reduction |
| 2026-07-21 | Split PRs (review feedback); added `initialize()`, `OperatorViewState`, `RendererCapabilities`; separated layout; added strangler pattern; added ADR-0013 |
