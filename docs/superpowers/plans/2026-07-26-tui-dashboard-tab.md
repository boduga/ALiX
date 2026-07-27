# TUI Dashboard Tab + Full-Viewport Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right-hand sidebar (DAEMON/APPROVALS/RUNTIME/SOPs & POLICY panels) with a new `dashboard` tab as the default landing tab, and expand the chat/agent views to use the full width and height of the terminal.

**Architecture:** The 4 sidebar panels already have dedicated paint functions in `dashboard-renderer.ts` (paintDaemonPanel / paintApprovalsPanel / paintRuntimePanel / paintSopsAndPolicyPanel). The sidebar's `renderSidebar()` is a thin layout wrapper that stacks them. We promote that wrapper to a first-class `DashboardView` (`src/tui/views/dashboard-view.ts`), register it as the first entry in `TAB_ORDER`, and set it as `state.activeTab`'s default. The chat/agent views lose their hard-coded `PANEL_H = 14` reservation so their scrollback uses the full vertical space. `paintFullFrame()` drops the 75/25 split, the vertical divider, the `renderSidebar()` call, and uses the full width for the active view.

**Tech Stack:** TypeScript, Node.js, blessed-style ANSI escape sequences (raw `canvas.write`).

## Global Constraints

- TabId union in `src/tui/state.ts:11` must include `'dashboard'`; default `activeTab` in `src/tui/state.ts:142` becomes `'dashboard'`.
- `TAB_ORDER` in `src/tui/app.ts:45` is a `readonly TabId[]`. First entry is the default tab.
- The plan approval card overlay (`paintPlanApprovalCard`, called at `app.ts:852`) stays. It renders on top of the active view's scrollback regardless of the view.
- The bottom status row (TOKENS, FILES, DAEMON, SOPS, RULES, EVENTS) at `app.ts:909-946` stays. It is footer chrome, not a sidebar panel.
- The 4 per-tab views (`daemon`, `approvals`, `runtime`, `sops`, `policy`) stay in `TAB_ORDER` after `dashboard` so the operator can drill into any panel.
- `panelScrollOffsets` and `panelFocus` flow into the dashboard's approvals and sops panels just like the old sidebar did, so per-tab focus state is preserved.
- All paint functions come from `dashboard-renderer.ts` — no re-implementation.

---

## File Structure

**Create:**
- `src/tui/views/dashboard-view.ts` — new view; renders the 4 panels in a responsive 2×2 or stacked layout.
- `docs/superpowers/plans/2026-07-26-tui-dashboard-tab.md` — this plan (already created).

**Modify:**
- `src/tui/state.ts` — add `'dashboard'` to `TabId`; set default `activeTab: 'dashboard'`.
- `src/tui/views/index.ts` — import and register `DashboardView`.
- `src/tui/app.ts` — add `'dashboard'` as first entry in `TAB_ORDER`; in `paintFullFrame()`, remove the 75/25 split, vertical divider, `renderSidebar()` call; expand the tab row and status row to use full width; update cursor-positioning branch for the new `'dashboard'` tab.
- `src/tui/views/agent-view.ts` — change `PANEL_H = 14` to `PANEL_H = 0` so the scrollback uses the full vertical viewport.
- `src/tui/views/chat-view.ts` — same `PANEL_H = 0` change; remove the `renderDashboard(ctx.snap, c, startY)` call at line 84 (those panels now live in the dashboard tab).

**Delete:**
- Nothing yet. `src/tui/sidebar.ts` stays — the per-tab view (daemon/approvals/runtime/sops/policy) and the chat/agent views still call its `renderDashboard` for their own bottom-strip; wait — verify before deleting. The actual deletion is out of scope for this plan; we only stop calling `renderSidebar()` from `paintFullFrame`.

---

### Task 1: Add 'dashboard' to TabId and set as default

**Files:**
- Modify: `src/tui/state.ts:11` — TabId union
- Modify: `src/tui/state.ts:142` — default activeTab

**Interfaces:**
- Consumes: nothing.
- Produces: `TabId` type now includes `'dashboard'`. `state.activeTab` defaults to `'dashboard'`.

- [ ] **Step 1: Add 'dashboard' to TabId**

Open `src/tui/state.ts`. Replace line 11:

```typescript
export type TabId = 'chat' | 'agent' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy';
```

with:

```typescript
export type TabId = 'dashboard' | 'chat' | 'agent' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy';
```

- [ ] **Step 2: Set default activeTab to 'dashboard'**

In the same file, replace line 142:

```typescript
    activeTab: 'chat',
```

with:

```typescript
    activeTab: 'dashboard',
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: tsc reports errors elsewhere (`'dashboard' not in TAB_ORDER`, `paintFullFrame` no longer handles the active tab, etc.) — those are the next tasks. The state.ts changes themselves must compile cleanly. If they don't, the change is wrong.

- [ ] **Step 4: Commit**

```bash
git add src/tui/state.ts
git commit -m "feat(tui): add 'dashboard' to TabId and set as default"
```

---

### Task 2: Create the DashboardView

**Files:**
- Create: `src/tui/views/dashboard-view.ts`
- Modify: `src/tui/views/index.ts` — register the new view

**Interfaces:**
- Consumes: `paintDaemonPanel`, `paintApprovalsPanel`, `paintRuntimePanel`, `paintSopsAndPolicyPanel` from `../dashboard-renderer.js`. Each takes `(canvas, snap, x, y, w, h, options?)` (see `dashboard-renderer.ts:77, 155, 243, 336`).
- Consumes: `PerTabState` and `TabId` from `../state.js`; `ViewRenderContext` and `TuiView` from `./types.js`.
- Produces: `DashboardView` class implementing `TuiView` with `id = 'dashboard'`.

The view is pure: `render(ctx)` never mutates `ctx`; the same `ctx` always produces the same frame.

- [ ] **Step 1: Write the new view file**

Create `src/tui/views/dashboard-view.ts` with the following contents:

```typescript
import type { PerTabState, TabId } from '../state.js';
import type {
  TuiView,
  ViewAction,
  ViewInputContext,
  ViewRenderContext,
  ViewRenderResult,
} from './types.js';
import type { TerminalCanvas } from '../canvas.js';
import {
  DEFAULT_PANEL_H,
  paintApprovalsPanel,
  paintDaemonPanel,
  paintRuntimePanel,
  paintSopsAndPolicyPanel,
} from '../dashboard-renderer.js';

/**
 * DashboardView — the default landing tab. Renders the same 4 panels
 * that used to live in the right-hand sidebar (DAEMON, APPROVALS,
 * RUNTIME, SOPs & POLICY), now consuming the full viewport.
 *
 * Layout adapts to terminal size so the operator can resize without
 * losing information density:
 *   - cols >= 120 AND bodyH >= 28: 2×2 grid (panels side by side)
 *   - otherwise:                  4 panels stacked vertically
 *
 * Each panel is rendered through the same `paint*Panel` exports from
 * `dashboard-renderer.ts`, so a dashboard panel is byte-for-byte the
 * same render as the matching per-tab view. This view owns only the
 * *layout* — where each panel's rectangle starts — and per-panel
 * focus/scroll plumbing (approvals and sops only).
 */
export class DashboardView implements TuiView {
  readonly id: TabId = 'dashboard';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas as TerminalCanvas;
    const cols = ctx.dimensions.columns;
    const rows = ctx.dimensions.rows;

    // Header (3 rows) + footer (3 rows) reserve. Body region:
    //   top:    row 3
    //   bottom: row rows-4 (just above the tab bar)
    const HEADER_H = 3;
    const FOOTER_H = 3;
    const top = HEADER_H;
    const bottom = Math.max(top, rows - FOOTER_H - 1);
    const bodyH = Math.max(1, bottom - top + 1);
    const bodyW = Math.max(20, cols);

    // 2×2 grid only when there's enough room for the bars in
    // DAEMON/RUNTIME to render without truncation. Otherwise stack.
    const useGrid = cols >= 120 && bodyH >= 28;

    if (useGrid) {
      this.renderGrid(ctx, c, top, bodyW, bodyH);
    } else {
      this.renderStack(ctx, c, top, bodyW, bodyH);
    }

    return { rows: [] };
  }

  private renderGrid(
    ctx: ViewRenderContext,
    c: TerminalCanvas,
    top: number,
    bodyW: number,
    bodyH: number,
  ): void {
    const halfW = Math.max(40, Math.floor(bodyW / 2));
    const halfH = Math.max(10, Math.floor(bodyH / 2));
    const panelW = halfW - 1; // 1-col gap between columns
    const perTab = ctx.perTab;
    const snap = ctx.snap;

    // Top-left: DAEMON. Top-right: APPROVALS.
    paintDaemonPanel(c, snap, 0, top, panelW, halfH);
    paintApprovalsPanel(
      c, snap, halfW, top, panelW, halfH,
      {
        scrollOffset: perTab.panelScrollOffsets.approvals,
        focused: perTab.panelFocus === 'approvals',
      },
    );
    // Bottom-left: RUNTIME. Bottom-right: SOPs & POLICY.
    paintRuntimePanel(c, snap, 0, top + halfH, panelW, halfH);
    paintSopsAndPolicyPanel(
      c, snap, halfW, top + halfH, panelW, halfH,
      {
        scrollOffset: perTab.panelScrollOffsets.sops,
        focused: perTab.panelFocus === 'sops',
      },
    );
  }

  private renderStack(
    ctx: ViewRenderContext,
    c: TerminalCanvas,
    top: number,
    bodyW: number,
    bodyH: number,
  ): void {
    const perTab = ctx.perTab;
    const snap = ctx.snap;

    // Equal-height scaling. If we can't fit DEFAULT_PANEL_H × 4,
    // drop uniformly so all four panels stay the same size.
    const target = DEFAULT_PANEL_H * 4;
    const perPanelH = target <= bodyH
      ? DEFAULT_PANEL_H
      : Math.max(5, Math.floor(bodyH / 4));

    let y = top;
    paintDaemonPanel(c, snap, 0, y, bodyW, perPanelH);
    y += perPanelH;
    paintApprovalsPanel(
      c, snap, 0, y, bodyW, perPanelH,
      {
        scrollOffset: perTab.panelScrollOffsets.approvals,
        focused: perTab.panelFocus === 'approvals',
      },
    );
    y += perPanelH;
    paintRuntimePanel(c, snap, 0, y, bodyW, perPanelH);
    y += perPanelH;
    paintSopsAndPolicyPanel(
      c, snap, 0, y, bodyW, perPanelH,
      {
        scrollOffset: perTab.panelScrollOffsets.sops,
        focused: perTab.panelFocus === 'sops',
      },
    );
  }

  handleKey(key: string, _ctx: ViewInputContext): ViewAction {
    // J/K cycle focus through the two scrollable panels. The
    // dispatch layer applies the resulting ViewAction.
    switch (key) {
      case 'j':
      case 'J':
        return { type: 'panelFocus', focus: 'approvals' };
      case 'k':
      case 'K':
        return { type: 'panelFocus', focus: 'sops' };
      default:
        return { type: 'handled' };
    }
  }

  onActivate(_perTab: PerTabState): void {
    // No-op.
  }

  onDeactivate(_perTab: PerTabState): void {
    // No-op.
  }
}
```

- [ ] **Step 2: Register the new view**

Open `src/tui/views/index.ts`. Add the import:

```typescript
import { DashboardView } from './dashboard-view.js';
```

Add the entry to the `_views` record (place it first to match `TAB_ORDER`):

```typescript
const _views: Record<string, TuiView> = {
  dashboard: new DashboardView(),
  agent: new AgentView(),
  // ...rest unchanged
};
```

Add `DashboardView` to the re-export line:

```typescript
export { AgentView, ApprovalsView, ChatView, DashboardView, DaemonView, PolicyView, RuntimeView, SopsView };
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: errors that reference `paintFullFrame` and `TAB_ORDER` (next task) but **no errors** in `dashboard-view.ts` or `views/index.ts`. If those two files have errors, fix them before moving on.

- [ ] **Step 4: Commit**

```bash
git add src/tui/views/dashboard-view.ts src/tui/views/index.ts
git commit -m "feat(tui): add DashboardView with responsive 2x2/stacked panel layout"
```

---

### Task 3: Wire 'dashboard' into TAB_ORDER and strip the sidebar from paintFullFrame

**Files:**
- Modify: `src/tui/app.ts:45` — add `'dashboard'` as first entry in `TAB_ORDER`.
- Modify: `src/tui/app.ts:822-967` — `paintFullFrame()` body: drop the 75/25 split, drop the vertical divider, drop the `renderSidebar()` call, expand tab row and status row to full width, handle the new `'dashboard'` branch in cursor positioning.

**Interfaces:**
- Consumes: `DashboardView` (now registered in `views/index.ts`); `TerminalCanvas` from `./canvas.js`; `paintFullFrame` private method on `TuiApp`.
- Produces: `paintFullFrame` now uses the full terminal width for the active view; no sidebar; no vertical divider; tab row and status row span the full width; cursor positioning places the cursor at column 1 row 4 for the dashboard tab.

- [ ] **Step 1: Add 'dashboard' to TAB_ORDER**

Open `src/tui/app.ts`. Replace line 45:

```typescript
const TAB_ORDER: readonly TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
```

with:

```typescript
const TAB_ORDER: readonly TabId[] = ['dashboard', 'chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
```

- [ ] **Step 2: Replace the paintFullFrame body**

Open `src/tui/app.ts`. Replace the body of `paintFullFrame` (lines 822-967). The replacement is a single contiguous block; do it as one `Edit` with the old block as `old_string` and the new block as `new_string`.

OLD block to find (begins after the `private paintFullFrame(): void {` line, ends before the `private async cleanupSync(): Promise<void> {` line):

```typescript
    if (!this.state.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    // 75/25 split — left column for chat/agent scrollback, right column for
    // the 4 dashboard panels stacked vertically. Reserve 1 column for the
    // vertical divider so the active view doesn't bleed into the sidebar.
    const SPLIT_RATIO = 0.75;
    const leftW = Math.max(40, Math.floor(dims.columns * SPLIT_RATIO));
    const rightW = Math.max(20, dims.columns - leftW - 1);
    const FOOTER_H = 3;
    const HEADER_H = 3;

    // Render the active view into a sub-canvas sized to the left column,
    // then blit it into the main canvas. This keeps each view's existing
    // row-4 prompt / row-5 status layout untouched while preventing writes
    // past the divider.
    const leftCanvas = new TerminalCanvas(leftW, dims.rows);
    const leftCtx: ViewRenderContext = {
      snap: this.state.lastSnapshot,
      dimensions: { columns: leftW, rows: dims.rows },
      perTab: this.state.views[this.state.activeTab],
      canvas: leftCanvas,
    };
    this.views[this.state.activeTab]!.render(leftCtx);

    // Plan approval card — drawn into the same left canvas as the active
    // view. Visible from any tab; the gate's keyboard handler makes the
    // keys available globally. Renders last so it overlays the view's
    // scrollback area (the view's scrollback ends at rows-18 on the agent
    // tab; the card sits at rows-7..rows-4, safely below).
    this.paintPlanApprovalCard(leftCanvas, leftW, dims.rows, HEADER_H, FOOTER_H);

    const c = new TerminalCanvas(dims.columns, dims.rows);
    const snap = this.state.lastSnapshot;
    const session = snap.session;

    // Header — top divider, content row, bottom divider (full width).
    // Row 0: top rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 0, `\x1b[90m─\x1b[0m`);
    // Row 1: left "ALiX TUI - Interactive Session" + right-aligned meta
    c.write(2, 1, `\x1b[32mALiX TUI\x1b[0m\x1b[1m - Interactive Session\x1b[0m`);
    const liveVersion: string | undefined =
      (this.opts.agentSession as { getVersion?: () => string } | undefined)?.getVersion?.();
    const version = liveVersion || session?.version || '0.0.0';
    const sessionMode = session?.mode ?? 'auto';
    const rightText = `\x1b[90mAgent OS v${version}  │  Session: ${sessionMode}  │  Mode: ${sessionMode}\x1b[0m`;
    const rightLen = `Agent OS v${version}  │  Session: ${sessionMode}  │  Mode: ${sessionMode}`.length;
    c.write(Math.max(2, dims.columns - rightLen), 1, rightText);
    // Row 2: bottom rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 2, `\x1b[90m─\x1b[0m`);

    // Blit the left canvas into the main canvas at offset (0, 0).
    c.blit(leftCanvas, 0, 0);

    // Vertical divider between left and right columns.
    for (let y = HEADER_H; y < dims.rows - FOOTER_H; y++) {
      c.write(leftW, y, `\x1b[90m│\x1b[0m`);
    }

    // Render the sidebar into its own canvas and blit it on the right.
    // Per-tab scroll state flows from the active tab so the operator's
    // `J`/`K` keys (where applicable) keep the panel cursor in sync.
    const activePerTab = this.state.views[this.state.activeTab];
    const sidebarCanvas = renderSidebar(
      snap, rightW, dims.rows, HEADER_H, FOOTER_H,
      activePerTab.panelScrollOffsets,
      activePerTab.panelFocus,
    );
    c.blit(sidebarCanvas, leftW + 1, 0);
    // Tabs row (with key-hint suffix, right-aligned).
    let tabLine = '';
    for (const id of TAB_ORDER) {
      const active = id === this.state.activeTab;
      tabLine += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
    }
    const tabHintsVisible = '↑/↓ navigate   |   tab next   |   ? help   |   q quit';
    const hintsLen = tabHintsVisible.length;
    // Reserve room so the hints fit on the same line, right-aligned.
    // Footer is clipped to the LEFT column so it doesn't bleed into the
    // sidebar's footer area.
    const tabRowBudget = Math.max(0, leftW - hintsLen - 1);
    const tabText = tabLine.length <= tabRowBudget
      ? tabLine + ' '.repeat(tabRowBudget - tabLine.length)
      : tabLine.slice(0, tabRowBudget);
    c.write(0, dims.rows - 3, tabText);
    c.write(leftW - hintsLen, dims.rows - 3, `\x1b[90m${tabHintsVisible}\x1b[0m`);

    // Status row — phase radios (left) | pipeline fields (right).
    const phaseDefs: ReadonlyArray<{ readonly phase: SessionPhase; readonly label: string }> = [
      { phase: SessionPhase.Understanding, label: 'UNDERSTANDING' },
      { phase: SessionPhase.Planning, label: 'PLANNING' },
      { phase: SessionPhase.Executing, label: 'EXECUTING' },
      { phase: SessionPhase.Verifying, label: 'VERIFYING' },
      { phase: SessionPhase.Summarizing, label: 'SUMMARIZING' },
    ];
    const activePhase = session?.phase ?? SessionPhase.Idle;
    let phaseLine = '';
    for (const p of phaseDefs) {
      const active = activePhase === p.phase;
      if (active) phaseLine += `\x1b[32m● ${p.label}\x1b[0m   `;
      else phaseLine += `\x1b[90m○ ${p.label}\x1b[0m   `;
    }
    const sep = `\x1b[90m|\x1b[0m`;
    const daemonLabel = snap.daemon !== null
      ? `\x1b[32m● running\x1b[0m`
      : `\x1b[90m○ stopped\x1b[0m`;
    const sopCount = snap.sops?.totalLoaded ?? 0;
    const ruleCount = snap.policy?.rules.length ?? 0;
    const eventsCount = (snap.runtime?.totalEventCount ?? 0).toLocaleString('en-US');
    const fields = [
      'TOKENS: —',   // schema gap: DashboardSnapshot has no tokens field yet
      'FILES: 0',         // schema gap: no fileCount field yet
      `DAEMON: ${daemonLabel}`,
      `SOPS: ${sopCount}`,
      `RULES: ${ruleCount}`,
      `EVENTS: ${eventsCount}`,
    ];
    // Phase radios are workflow-lifecycle signals — they only make sense on
    // the agent tab. On chat, skip the phase segment and start with the
    // pipeline field chain so the operator doesn't see stale workflow
    // phase from a previous processTurn run.
    const statusLine = this.state.activeTab === 'chat'
      ? `${sep} ${fields.join(` ${sep} `)}`
      : `${phaseLine} ${sep} ${fields.join(` ${sep} `)}`;
    c.write(0, dims.rows - 1, statusLine.slice(0, Math.max(0, leftW - 2)));

    // Write the complete frame — cursor home + canvas render.
    this.output.write('\x1b[H' + c.renderFrame());

    // Place the terminal cursor at the active tab's input prompt position.
    // Without this the cursor sits at the bottom of the screen (blinking on
    // top of the status line) while typed text accumulates in the buffer,
    // creating both an invisible-typing experience and a visual "flash" on
    // every keypress as the full frame redraw overwrites the cursor area.
    if (this.state.activeTab === 'chat') {
      const bufLen = this.state.views.chat.inputBuffer.length;
      this.output.write(`\x1b[5;${7 + bufLen + 1}H`);
    } else if (this.state.activeTab === 'agent') {
      const bufLen = this.state.views.agent.inputBuffer.length;
      this.output.write(`\x1b[5;${13 + bufLen + 1}H`);
    } else {
      // Non-input tabs: move cursor to a safe column (row 4, col 1) so it
      // doesn't blink on top of the status line.
      this.output.write(`\x1b[5;1H`);
    }
  }
```

NEW block to insert:

```typescript
    if (!this.state.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    const FOOTER_H = 3;
    const HEADER_H = 3;

    // Render the active view into a canvas sized to the full terminal.
    // The dashboard tab consumes the entire body region (rows 3..rows-4)
    // with its 2×2 or stacked panel layout. Chat and agent get the full
    // width/height for their scrollback — the previous 75/25 split and
    // vertical divider are gone.
    const viewCanvas = new TerminalCanvas(dims.columns, dims.rows);
    const viewCtx: ViewRenderContext = {
      snap: this.state.lastSnapshot,
      dimensions: { columns: dims.columns, rows: dims.rows },
      perTab: this.state.views[this.state.activeTab],
      canvas: viewCanvas,
    };
    this.views[this.state.activeTab]!.render(viewCtx);

    // Plan approval card — drawn into the same canvas as the active view.
    // Visible from any tab; the gate's keyboard handler makes the keys
    // available globally. Renders last so it overlays the view's
    // scrollback area (sits at rows-7..rows-4, which is inside the
    // expanded scrollback now — the card wins because it paints last).
    this.paintPlanApprovalCard(viewCanvas, dims.columns, dims.rows, HEADER_H, FOOTER_H);

    const c = new TerminalCanvas(dims.columns, dims.rows);
    const snap = this.state.lastSnapshot;
    const session = snap.session;

    // Header — top divider, content row, bottom divider (full width).
    // Row 0: top rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 0, `\x1b[90m─\x1b[0m`);
    // Row 1: left "ALiX TUI - Interactive Session" + right-aligned meta
    c.write(2, 1, `\x1b[32mALiX TUI\x1b[0m\x1b[1m - Interactive Session\x1b[0m`);
    const liveVersion: string | undefined =
      (this.opts.agentSession as { getVersion?: () => string } | undefined)?.getVersion?.();
    const version = liveVersion || session?.version || '0.0.0';
    const sessionMode = session?.mode ?? 'auto';
    const rightText = `\x1b[90mAgent OS v${version}  │  Session: ${sessionMode}  │  Mode: ${sessionMode}\x1b[0m`;
    const rightLen = `Agent OS v${version}  │  Session: ${sessionMode}  │  Mode: ${sessionMode}`.length;
    c.write(Math.max(2, dims.columns - rightLen), 1, rightText);
    // Row 2: bottom rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 2, `\x1b[90m─\x1b[0m`);

    // Blit the view canvas into the main canvas at offset (0, 0).
    c.blit(viewCanvas, 0, 0);

    // Tabs row (with key-hint suffix, right-aligned). Now uses the
    // full width — no sidebar column to clip against.
    let tabLine = '';
    for (const id of TAB_ORDER) {
      const active = id === this.state.activeTab;
      tabLine += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
    }
    const tabHintsVisible = '↑/↓ navigate   |   tab next   |   ? help   |   q quit';
    const hintsLen = tabHintsVisible.length;
    const tabRowBudget = Math.max(0, dims.columns - hintsLen - 1);
    const tabText = tabLine.length <= tabRowBudget
      ? tabLine + ' '.repeat(tabRowBudget - tabLine.length)
      : tabLine.slice(0, tabRowBudget);
    c.write(0, dims.rows - 3, tabText);
    c.write(dims.columns - hintsLen, dims.rows - 3, `\x1b[90m${tabHintsVisible}\x1b[0m`);

    // Status row — phase radios (left) | pipeline fields (right).
    // Phase radios are workflow-lifecycle signals — they only make sense
    // on the agent tab. On chat and dashboard, skip the phase segment
    // so the operator doesn't see stale workflow phase from a previous
    // processTurn run.
    const phaseDefs: ReadonlyArray<{ readonly phase: SessionPhase; readonly label: string }> = [
      { phase: SessionPhase.Understanding, label: 'UNDERSTANDING' },
      { phase: SessionPhase.Planning, label: 'PLANNING' },
      { phase: SessionPhase.Executing, label: 'EXECUTING' },
      { phase: SessionPhase.Verifying, label: 'VERIFYING' },
      { phase: SessionPhase.Summarizing, label: 'SUMMARIZING' },
    ];
    const activePhase = session?.phase ?? SessionPhase.Idle;
    let phaseLine = '';
    for (const p of phaseDefs) {
      const active = activePhase === p.phase;
      if (active) phaseLine += `\x1b[32m● ${p.label}\x1b[0m   `;
      else phaseLine += `\x1b[90m○ ${p.label}\x1b[0m   `;
    }
    const sep = `\x1b[90m|\x1b[0m`;
    const daemonLabel = snap.daemon !== null
      ? `\x1b[32m● running\x1b[0m`
      : `\x1b[90m○ stopped\x1b[0m`;
    const sopCount = snap.sops?.totalLoaded ?? 0;
    const ruleCount = snap.policy?.rules.length ?? 0;
    const eventsCount = (snap.runtime?.totalEventCount ?? 0).toLocaleString('en-US');
    const fields = [
      'TOKENS: —',   // schema gap: DashboardSnapshot has no tokens field yet
      'FILES: 0',         // schema gap: no fileCount field yet
      `DAEMON: ${daemonLabel}`,
      `SOPS: ${sopCount}`,
      `RULES: ${ruleCount}`,
      `EVENTS: ${eventsCount}`,
    ];
    const statusLine = this.state.activeTab === 'agent'
      ? `${phaseLine} ${sep} ${fields.join(` ${sep} `)}`
      : `${sep} ${fields.join(` ${sep} `)}`;
    c.write(0, dims.rows - 1, statusLine.slice(0, Math.max(0, dims.columns - 2)));

    // Write the complete frame — cursor home + canvas render.
    this.output.write('\x1b[H' + c.renderFrame());

    // Place the terminal cursor at the active tab's input prompt position.
    // Without this the cursor sits at the bottom of the screen (blinking
    // on top of the status line) while typed text accumulates in the
    // buffer, creating both an invisible-typing experience and a visual
    // "flash" on every keypress as the full frame redraw overwrites the
    // cursor area.
    if (this.state.activeTab === 'chat') {
      const bufLen = this.state.views.chat.inputBuffer.length;
      this.output.write(`\x1b[5;${7 + bufLen + 1}H`);
    } else if (this.state.activeTab === 'agent') {
      const bufLen = this.state.views.agent.inputBuffer.length;
      this.output.write(`\x1b[5;${13 + bufLen + 1}H`);
    } else {
      // Non-input tabs (dashboard, daemon, approvals, runtime, sops,
      // policy): move cursor to a safe column (row 4, col 1) so it
      // doesn't blink on top of the status line.
      this.output.write(`\x1b[5;1H`);
    }
  }
```

- [ ] **Step 3: Drop the unused `renderSidebar` import**

Open `src/tui/app.ts` and delete this line (the import is no longer referenced):

```typescript
import { renderSidebar } from './sidebar.js';
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: only errors in `agent-view.ts` and `chat-view.ts` (their `PANEL_H = 14` is now wrong; that's the next task). If `app.ts` itself has errors, fix them before moving on.

- [ ] **Step 5: Commit**

```bash
git add src/tui/app.ts
git commit -m "feat(tui): add 'dashboard' to TAB_ORDER, strip sidebar, expand viewport"
```

---

### Task 4: Expand the agent scrollback to full height

**Files:**
- Modify: `src/tui/views/agent-view.ts:170` — `PANEL_H = 14` → `PANEL_H = 0`.

**Interfaces:**
- Consumes: `ctx.dimensions.rows` (the full terminal height) and the `FOOTER_H = 3` constant.
- Produces: `startY = max(0, rows - PANEL_H - FOOTER_H) = rows - 3`, so the scrollback extends to `rows - 4` (just above the tab bar) instead of stopping at `rows - 18`.

- [ ] **Step 1: Change PANEL_H to 0**

Open `src/tui/views/agent-view.ts`. Replace the `PANEL_H` constant on line 170:

```typescript
    const PANEL_H = 14;
```

with:

```typescript
    // The 14-row dashboard reservation is gone (panels now live in
    // the dashboard tab). Scrollback uses the full vertical space.
    const PANEL_H = 0;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: only errors in `chat-view.ts` remain. `agent-view.ts` should compile clean.

- [ ] **Step 3: Commit**

```bash
git add src/tui/views/agent-view.ts
git commit -m "feat(tui): expand agent scrollback to full viewport height"
```

---

### Task 5: Expand the chat scrollback to full height and drop the in-view dashboard

**Files:**
- Modify: `src/tui/views/chat-view.ts:33` — `PANEL_H = 14` → `PANEL_H = 0`.
- Modify: `src/tui/views/chat-view.ts:1` — remove the `renderDashboard` import.
- Modify: `src/tui/views/chat-view.ts:84` — remove the `renderDashboard(ctx.snap, c, startY);` call.
- Modify: `src/tui/views/chat-view.ts:29-32` — update the comment block above the now-removed `PANEL_H` line.

**Interfaces:**
- Consumes: same as the agent view — `ctx.dimensions.rows` and the existing `FOOTER_H`.
- Produces: chat scrollback extends to `rows - 4`; no in-view dashboard render (the panels live in the dashboard tab now).

- [ ] **Step 1: Drop the `renderDashboard` import**

Open `src/tui/views/chat-view.ts`. Delete line 1:

```typescript
import { renderDashboard } from '../dashboard-renderer.js';
```

- [ ] **Step 2: Update the comment + PANEL_H**

Replace the comment + `PANEL_H` line:

```typescript
    // Pin the 4-panel dashboard to the bottom of the canvas, flush above
    // the 3-row footer painted by app.ts (tab row at N-3, gap row at N-2,
    // status row at N-1). Floor at 0 so very small canvases still render
    // a meaningful frame instead of overlapping the prompt.
    const PANEL_H = 14;
```

with:

```typescript
    // The 4-panel dashboard strip at the bottom of the chat tab is gone;
    // the panels now live in the new `dashboard` tab. Scrollback uses
    // the full vertical viewport (down to the tab bar at N-3). Floor
    // at 0 so very small canvases still render a meaningful frame.
    const PANEL_H = 0;
```

- [ ] **Step 3: Drop the in-view `renderDashboard` call**

Replace line 84:

```typescript
    renderDashboard(ctx.snap, c, startY);
```

with a comment explaining why it's gone:

```typescript
    // The 4 dashboard panels (DAEMON/APPROVALS/RUNTIME/SOPs) used to
    // render here at the bottom of the chat tab. They now live in the
    // new `dashboard` tab as the default landing surface.
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: zero errors anywhere in `src/`. (Any remaining errors are in the test files we haven't touched — those are the next task.)

- [ ] **Step 5: Commit**

```bash
git add src/tui/views/chat-view.ts
git commit -m "feat(tui): expand chat scrollback to full viewport, drop in-view dashboard"
```

---

### Task 6: Update tests that assert against the old sidebar layout

**Files:**
- Likely modify: `tests/tui/integration-parity.vitest.ts` and `tests/tui/app.vitest.ts` (these are the test files GitNexus flagged as `paintFullFrame` upstream callers at depth 2).
- Possibly modify: any test that asserts the 75/25 split, the vertical divider character, `renderSidebar` being called, or the default active tab.

**Interfaces:**
- Consumes: existing test fixtures and snapshots.
- Produces: tests reflect the new layout — no sidebar; full-width views; `'dashboard'` is the default active tab.

- [ ] **Step 1: Find tests that reference the old sidebar**

Run: `grep -rn "renderSidebar\|SPLIT_RATIO\|leftW\|rightW\|activeTab.*chat\b\|activeTab: 'chat'" tests/ 2>/dev/null | head -30`
Expected: a list of test files and line numbers that need updating. If the list is empty, skip to step 4.

- [ ] **Step 2: For each test, update the assertion to the new layout**

For each test file in the list:
- Replace assertions like `activeTab === 'chat'` (when checking the default) with `activeTab === 'dashboard'`.
- Replace canvas-width assertions that check `cols * 0.75` with `cols`.
- Drop any test that asserts the vertical divider is rendered.
- Drop any test that asserts `renderSidebar` is called from `paintFullFrame`.

Read the test before changing it. Tests should encode *behavior*, not implementation; update the behavior, not the code path.

- [ ] **Step 3: Run the test suite**

Run: `npx vitest run tests/tui/ 2>&1 | tail -40`
Expected: all TUI tests pass. If any fail, fix them by updating the test (not the production code — production is correct from Tasks 1-5).

- [ ] **Step 4: Commit**

```bash
git add tests/tui/
git commit -m "test(tui): update tests for dashboard tab and full-viewport layout"
```

---

### Task 7: Verify end-to-end with gitnexus + manual smoke

**Files:** none.

**Interfaces:**
- Consumes: the full diff from Tasks 1-6.
- Produces: a clean `gitnexus detect_changes` report that names the new symbols and the affected execution flows.

- [ ] **Step 1: Run gitnexus detect_changes**

Run: `npx gitnexus detect_changes 2>&1 | head -60`
Expected: the report names the new `DashboardView` symbol, the new `'dashboard'` tab in `TAB_ORDER`, and the modified symbols in `paintFullFrame`, `agent-view`, `chat-view`. Confirm none of the named execution flows are unexpected.

- [ ] **Step 2: Run the full vitest suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: all tests pass (the count should match the pre-change baseline ± a small delta for new tests, if any).

- [ ] **Step 3: Manual smoke (informational)**

The user is the operator here. Confirm with the user that the TUI launches on the dashboard tab, the 4 panels are visible (DAEMON / APPROVALS / RUNTIME / SOPs & POLICY), chat and agent views now use the full width and height, and the tab row at the bottom shows all 8 tabs in the new order: `dashboard chat agent daemon approvals runtime sops policy`.

This step has no commit — it just gates the task as "done."

---

## Self-Review

**1. Spec coverage:**
- Dashboard tab at the beginning as default → Task 1 (default activeTab) + Task 3 (TAB_ORDER first entry).
- Move all panels to the dashboard tab → Task 2 (DashboardView) + Task 3 (drop renderSidebar from paintFullFrame) + Task 5 (drop renderDashboard from chat).
- Update tabs to use max screen size → Task 3 (full width in paintFullFrame) + Task 4 (PANEL_H = 0 in agent) + Task 5 (PANEL_H = 0 in chat).
- Make it dynamic → Task 2 (responsive 2×2 vs stacked layout based on cols/rows).
- Tests updated → Task 6.
- End-to-end verify → Task 7.

**2. Placeholder scan:** No "TBD" or "implement later" — every step has explicit code, paths, and run commands. The manual smoke in Task 7 step 3 is intentionally gate-by-user rather than gate-by-test because the TUI is interactive.

**3. Type consistency:** `TabId` is the source of truth and is updated first in Task 1. Every later task references `'dashboard'` as a string literal that matches the union. `panelScrollOffsets` and `panelFocus` come from `PerTabState` (already defined in `state.ts`) and are used consistently in the new view. The four `paint*Panel` calls match the signatures in `dashboard-renderer.ts`.
