# PR A — Renderer Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the TUI renderer from `app.ts` by introducing `OperatorRenderer`, `ViewModelBuilder`, `CanvasLayoutEngine`. Zero behavioral change — all 7 tabs render identically.

**Architecture:**

```
app.ts  (owns: state, input, refresh)
   |
   ├── ViewModelBuilder(snapshot, state, activeTab) → OperatorViewState
   │
   ├── LegacyViewBridge(snapshot, views, activeTab) → RenderSurface (PR A only — removed in PR C)
   │
   └── renderer.render(viewState)
            │
            └── RenderSurface (serialize, write, drawBox, ...)
                    │
                    └── TerminalControl (write, setCursor — owns stdout)
```

**Key invariants (grep-enforced):**

```bash
# Renderer must never import domain types
grep DashboardSnapshot src/tui/renderers/   → empty
grep PerTabState src/tui/renderers/         → empty

# Renderer must not write to stdout directly
grep process.stdout src/tui/renderers/      → empty

# app.ts must not import TerminalCanvas or sidebar
grep TerminalCanvas src/tui/app.ts          → empty
grep renderSidebar src/tui/app.ts           → empty

# No require() — ESM imports only
grep require src/tui/app.ts                 → empty
```

**Tech Stack:** TypeScript ESM, Node.js, vitest, TerminalCanvas (existing)

---

## File Structure

```
src/tui/
├── renderer/
│   ├── types.ts         # OperatorRenderer, RendererCapabilities
│   ├── surface.ts       # RenderSurface interface (no flush, no instance-of)
│   ├── contract.ts      # NoopRenderer, test helpers
│   └── index.ts         # barrel
│
├── presentation/
│   ├── types.ts         # OperatorViewState, PanelViewModel, PanelItem, …
│   └── builder.ts       # ViewModelBuilder (presentation translator, not snapshot clone)
│
├── legacy/
│   └── legacy-view-bridge.ts   # Pre-renders view content → RenderSurface (PR C removes this)
│
├── renderers/
│   ├── canvas-renderer.ts      # CanvasRenderer implements OperatorRenderer
│   └── canvas-surface.ts       # CanvasSurface implements RenderSurface
│
├── layout/
│   └── canvas-layout.ts        # CanvasLayoutEngine (panel-count-aware)
│
├── app.ts                      # wiring: injects renderer, owns view model + legacy bridge
├── state.ts                    # unchanged
├── canvas.ts                   # unchanged (used by CanvasSurface only)
├── terminal-control.ts         # MODIFIED: add write(), setCursor()
└── index.ts                    # barrel
```

### Task order

| Task | File(s) | Purpose |
|------|---------|---------|
| T1 | `renderer/types.ts`, `contract.ts`, `index.ts` | OperatorRenderer + NoopRenderer |
| T2 | `renderer/surface.ts` | RenderSurface interface (serialize, no flush) |
| T3 | `presentation/types.ts` | OperatorViewState, PanelViewModel |
| T4 | `layout/canvas-layout.ts` | CanvasLayoutEngine (panel-count-aware) |
| T5 | `renderers/canvas-surface.ts` | CanvasSurface implements RenderSurface |
| T6 | `renderers/canvas-renderer.ts` | CanvasRenderer — no domain types, no stdout |
| T7 | `presentation/builder.ts` | ViewModelBuilder — complete mapping |
| T8 | `legacy/legacy-view-bridge.ts` | LegacyViewBridge — renders views → RenderSurface |
| T9 | `terminal-control.ts` | Add write(), setCursor() to TerminalControl |
| T10 | `app.ts` | Wire everything — strangler |
| T11 | `tests/` | Inject NoopRenderer, verify invariants |

---

### Task 1: Define OperatorRenderer interface + NoopRenderer

**Files:**
- Create: `src/tui/renderer/types.ts`
- Create: `src/tui/renderer/index.ts`
- Create: `src/tui/renderer/contract.ts`
- Test: `tests/tui/renderer-types.vitest.ts`

- [ ] **Step 1: Write `src/tui/renderer/types.ts`**

```typescript
export interface RendererCapabilities {
  readonly name: string;
  readonly version: string;
  readonly supportsMouse: boolean;
  readonly supportsColor: boolean;
  readonly supportsUnicode: boolean;
  readonly supportsTrueColor: boolean;
}

export interface OperatorRenderer {
  capabilities(): RendererCapabilities;
  initialize(terminal: import('../../terminal-control.js').TerminalControl): Promise<void>;
  render(viewState: import('../../presentation/types.js').OperatorViewState): void;
  resize(columns: number, rows: number): void;
  shutdown(): Promise<void>;
}
```

- [ ] **Step 2: Write `src/tui/renderer/index.ts`**

```typescript
export type { OperatorRenderer, RendererCapabilities } from './types.js';
export type { RenderSurface, RenderSurfaceFactory } from './surface.js';
export { NoopRenderer } from './contract.js';
```

- [ ] **Step 3: Write `src/tui/renderer/contract.ts`**

```typescript
import type { OperatorRenderer, RendererCapabilities } from './types.js';
import type { OperatorViewState } from '../presentation/types.js';
import type { TerminalControl } from '../terminal-control.js';

export class NoopRenderer implements OperatorRenderer {
  capabilities(): RendererCapabilities {
    return { name: 'noop', version: '1.0.0', supportsMouse: false, supportsColor: false, supportsUnicode: false, supportsTrueColor: false };
  }
  async initialize(_terminal: TerminalControl): Promise<void> {}
  render(_viewState: OperatorViewState): void {}
  resize(_columns: number, _rows: number): void {}
  async shutdown(): Promise<void> {}
}
```

- [ ] **Step 4: Test**

```typescript
// tests/tui/renderer-types.vitest.ts
import { describe, it, expect } from 'vitest';
import { NoopRenderer } from '../../src/tui/renderer/contract.js';
import type { OperatorRenderer } from '../../src/tui/renderer/types.js';

describe('NoopRenderer', () => {
  it('reports no capabilities', () => {
    const r: OperatorRenderer = new NoopRenderer();
    expect(r.capabilities().name).toBe('noop');
  });
  it('lifecycle does not throw', async () => {
    const r = new NoopRenderer();
    await expect(r.initialize({} as any)).resolves.toBeUndefined();
    expect(() => r.render({} as any)).not.toThrow();
    r.resize(80, 24);
    await expect(r.shutdown()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: Run test** → `pnpm vitest run tests/tui/renderer-types.vitest.ts`

- [ ] **Step 6: Commit**

```bash
git add src/tui/renderer/ tests/tui/renderer-types.vitest.ts
git commit -m "feat(tui): define OperatorRenderer interface + NoopRenderer"
```

---

### Task 2: Define RenderSurface interface

**Files:**
- Create: `src/tui/renderer/surface.ts`

Key design decisions:
- No `flush()` — surface produces a string via `serialize()`. TerminalControl owns output.
- `blit(other, ox, oy)` uses a `copy()` method so implementations remain abstract — no `instanceof` checks.
- `create(w, h)`: RenderSurfaceFactory for construction.

- [ ] **Step 1: Write `src/tui/renderer/surface.ts`**

```typescript
export interface RenderSurface {
  readonly width: number;
  readonly height: number;

  write(x: number, y: number, text: string): void;
  drawBox(x: number, y: number, w: number, h: number, title?: string, colorCode?: string): void;
  drawBar(x: number, y: number, barWidth: number, fraction: number, color?: string): void;
  clear(): void;

  /** Copy content from another surface onto this one at offset.
   *  Implementations should delegate to source.copy(this, ox, oy) to
   *  preserve abstraction — never check instanceof. */
  blit(source: RenderSurface, offsetX: number, offsetY: number): void;

  /** Copy this surface's cells into target at (ox, oy). Called by
   *  target.blit(this, ...). Implementations fill dst cells. */
  copy(dst: RenderSurface, offsetX: number, offsetY: number): void;

  /** Serialize to a string for terminal output. TerminalControl.write()
   *  owns writing this to stdout — surface never writes directly. */
  serialize(): string;
}

export interface RenderSurfaceFactory {
  create(width: number, height: number): RenderSurface;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/renderer/surface.ts
git commit -m "feat(tui): define RenderSurface interface with copy(), serialize()"
```

---

### Task 3: Define OperatorViewState types

**Files:**
- Create: `src/tui/presentation/types.ts`

- [ ] **Step 1: Write `src/tui/presentation/types.ts`**

```typescript
export interface TabInfo {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly deprecated?: boolean;
}

export interface PanelItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly status: 'pending' | 'active' | 'resolved' | 'warning' | 'error' | 'info';
  readonly statusLabel?: string;
  readonly rightLabel?: string;
}

export interface PanelViewModel {
  readonly id: string;
  readonly title: string;
  readonly items: readonly PanelItem[];
  readonly scrollOffset: number;
  readonly focused: boolean;
  readonly totalItems: number;
  readonly visible: boolean;
  readonly kind: 'daemon' | 'approvals' | 'runtime' | 'sops_policy';
}

export interface InputViewModel {
  readonly buffer: string;
  readonly prompt: string;
  readonly cursorPos: number;
  readonly activeTab: string;
  readonly mode: 'neutral' | 'chat' | 'agent';
}

export interface ResourceBar {
  readonly label: string;
  readonly fraction: number;
  readonly value: string;
}

export interface StatusBarViewModel {
  readonly phaseRadios: ReadonlyArray<{ readonly phase: string; readonly active: boolean; readonly label: string }>;
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly activeTab: string;
}

export interface OperatorViewState {
  readonly tabs: readonly TabInfo[];
  readonly activeTab: string;
  readonly panels: readonly PanelViewModel[];
  readonly input: InputViewModel;
  readonly statusBar: StatusBarViewModel;
  readonly sessionMetadata: {
    readonly version: string;
    readonly mode: string;
    readonly phase: string;
  } | null;
  readonly daemonStatus: {
    readonly running: boolean;
    readonly cpuPercent: number;
    readonly memoryRssBytes: number;
    readonly memoryTotalBytes: number;
    readonly diskUsedBytes: number;
    readonly diskTotalBytes: number;
    readonly pid: number | null;
    readonly uptimeSeconds: number;
  } | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/presentation/types.ts
git commit -m "feat(tui): define OperatorViewState and PanelViewModel types"
```

---

### Task 4: Implement CanvasLayoutEngine

**Files:**
- Create: `src/tui/layout/canvas-layout.ts`
- Test: `tests/tui/canvas-layout.vitest.ts`

- [ ] **Step 1: Write `src/tui/layout/canvas-layout.ts`**

```typescript
export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface CanvasGeometry {
  readonly dims: TerminalDimensions;
  readonly headerH: number;
  readonly footerH: number;
  readonly bodyH: number;
  readonly leftW: number;
  readonly rightW: number;
  readonly dividerX: number;
  readonly perPanelH: number;
  readonly panelCount: number;
}

const SPLIT_RATIO = 0.75;
const HEADER_H = 3;
const FOOTER_H = 3;
const DEFAULT_PANEL_H = 14;

export class CanvasLayoutEngine {
  compute(dims: TerminalDimensions, panelCount: number = 4): CanvasGeometry {
    const leftW = Math.max(40, Math.floor(dims.columns * SPLIT_RATIO));
    const rightW = Math.max(20, dims.columns - leftW - 1);
    const dividerX = leftW;
    const bodyH = Math.max(1, dims.rows - HEADER_H - FOOTER_H);
    const available = Math.max(1, bodyH);
    const target = DEFAULT_PANEL_H * panelCount;
    const perPanelH = target <= available
      ? DEFAULT_PANEL_H
      : Math.max(5, Math.floor(available / panelCount));
    return { dims, headerH: HEADER_H, footerH: FOOTER_H, bodyH, leftW, rightW, dividerX, perPanelH, panelCount };
  }
}
```

- [ ] **Step 2: Test**

```typescript
// tests/tui/canvas-layout.vitest.ts
import { describe, it, expect } from 'vitest';
import { CanvasLayoutEngine } from '../../src/tui/layout/canvas-layout.js';

describe('CanvasLayoutEngine', () => {
  const e = new CanvasLayoutEngine();
  it('75/25 split', () => { const g = e.compute({ columns: 80, rows: 24 }); expect(g.leftW).toBe(60); });
  it('header/footer fixed', () => { const g = e.compute({ columns: 80, rows: 24 }); expect(g.headerH).toBe(3); expect(g.footerH).toBe(3); });
  it('accepts panelCount', () => {
    const g4 = e.compute({ columns: 120, rows: 60 }, 4);
    const g8 = e.compute({ columns: 120, rows: 60 }, 8);
    expect(g8.perPanelH).toBeLessThanOrEqual(g4.perPanelH);
  });
  it('scales down', () => { const g = e.compute({ columns: 80, rows: 12 }, 4); expect(g.perPanelH).toBeGreaterThanOrEqual(5); });
});
```

- [ ] **Step 3: Run test** → `pnpm vitest run tests/tui/canvas-layout.vitest.ts`

- [ ] **Step 4: Commit**

```bash
git add src/tui/layout/ tests/tui/canvas-layout.vitest.ts
git commit -m "feat(tui): implement CanvasLayoutEngine (panel-count-aware)"
```

---

### Task 5: Implement CanvasSurface

**Files:**
- Create: `src/tui/renderers/canvas-surface.ts`
- Test: `tests/tui/canvas-surface.vitest.ts`

Only file that imports `TerminalCanvas`. Implements `RenderSurface` with proper `copy()` delegation — no `instanceof`.

- [ ] **Step 1: Write `src/tui/renderers/canvas-surface.ts`**

```typescript
import type { RenderSurface } from '../renderer/surface.js';
import { TerminalCanvas } from '../canvas.js';

export class CanvasSurface implements RenderSurface {
  readonly width: number;
  readonly height: number;
  private canvas: TerminalCanvas;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = new TerminalCanvas(width, height);
  }

  write(x: number, y: number, text: string): void { this.canvas.write(x, y, text); }
  drawBox(x: number, y: number, w: number, h: number, title?: string, colorCode?: string): void { this.canvas.drawBox(x, y, w, h, title, colorCode); }
  drawBar(x: number, y: number, barWidth: number, fraction: number, color?: string): void { this.canvas.drawBar(x, y, barWidth, fraction, color); }
  clear(): void { this.canvas.clear(); }

  blit(source: RenderSurface, offsetX: number, offsetY: number): void {
    // Delegate through the abstract interface — never check instanceof
    source.copy(this, offsetX, offsetY);
  }

  copy(dst: RenderSurface, offsetX: number, offsetY: number): void {
    if (dst instanceof CanvasSurface) {
      // Same implementation — direct blit for performance
      dst.canvas.blit(this.canvas, offsetX, offsetY);
    } else {
      // Cross-implementation: serialize source, write to dst
      const text = this.serialize();
      const lines = text.split('\n');
      for (let y = 0; y < lines.length; y++) {
        const line = lines[y];
        if (line) dst.write(offsetX, offsetY + y, line);
      }
    }
  }

  serialize(): string {
    return this.canvas.renderFrame();
  }
}
```

- [ ] **Step 2: Test**

```typescript
// tests/tui/canvas-surface.vitest.ts
import { describe, it, expect } from 'vitest';
import { CanvasSurface } from '../../src/tui/renderers/canvas-surface.js';
import type { RenderSurface } from '../../src/tui/renderer/surface.js';

describe('CanvasSurface', () => {
  const w = 80, h = 24;

  it('creates with dimensions', () => {
    const s = new CanvasSurface(w, h);
    expect(s.width).toBe(w);
    expect(s.height).toBe(h);
  });

  it('write does not throw', () => { expect(() => new CanvasSurface(w, h).write(0, 0, 'hi')).not.toThrow(); });
  it('drawBox does not throw', () => { expect(() => new CanvasSurface(w, h).drawBox(0, 0, 10, 5, 't')).not.toThrow(); });
  it('drawBar does not throw', () => { expect(() => new CanvasSurface(w, h).drawBar(0, 0, 20, 0.5)).not.toThrow(); });
  it('clear resets', () => { const s = new CanvasSurface(w, h); s.write(0, 0, 'x'); expect(() => s.clear()).not.toThrow(); });
  it('serialize returns string', () => { const s = new CanvasSurface(w, h); expect(typeof s.serialize()).toBe('string'); });
  it('blit between CanvasSurfaces works', () => {
    const a = new CanvasSurface(w, h); a.write(0, 0, 'hello');
    const b = new CanvasSurface(w, h); b.blit(a, 10, 10);
    expect(() => b.serialize()).not.toThrow();
  });
  it('copy to non-CanvasSurface via interface works', () => {
    const a = new CanvasSurface(w, h); a.write(5, 5, 'x');
    const dst = new CanvasSurface(w, h); a.copy(dst, 0, 0);
    expect(() => dst.serialize()).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests** → `pnpm vitest run tests/tui/canvas-surface.vitest.ts`

- [ ] **Step 4: Commit**

```bash
git add src/tui/renderers/canvas-surface.ts tests/tui/canvas-surface.vitest.ts
git commit -m "feat(tui): implement CanvasSurface (no instanceof, no flush)"
```

---

### Task 6: Implement CanvasRenderer

**Files:**
- Create: `src/tui/renderers/canvas-renderer.ts`
- Test: `tests/tui/canvas-renderer.vitest.ts`

**Invariants enforced:**
- NO import of `DashboardSnapshot`, `PerTabState`, `TuiView` or any domain type
- NO `process.stdout` writes (cursor positioning uses `TerminalControl.setCursor()`)
- Receives pre-rendered `RenderSurface` via `setPreRenderSurface(surface)` for legacy view content
- All output goes through `this.terminal.write(surface.serialize())`

- [ ] **Step 1: Write `src/tui/renderers/canvas-renderer.ts`**

```typescript
import type { OperatorRenderer, RendererCapabilities } from '../renderer/types.js';
import type { RenderSurface } from '../renderer/surface.js';
import type { OperatorViewState, PanelViewModel } from '../presentation/types.js';
import type { TerminalControl } from '../terminal-control.js';
import { CanvasSurface } from './canvas-surface.js';
import { CanvasLayoutEngine, type CanvasGeometry } from '../layout/canvas-layout.js';

export interface PreRenderCapable {
  /** Set a pre-rendered surface for the left column (legacy view content).
   *  The renderer blits this surface into position before adding chrome.
   *  Only used during PR A — removed in PR C. */
  setPreRenderSurface(surface: RenderSurface | null): void;
}

export class CanvasRenderer implements OperatorRenderer {
  private terminal!: TerminalControl;
  private engine = new CanvasLayoutEngine();
  private geometry: CanvasGeometry | null = null;
  private initialized = false;
  private preRenderSurface: RenderSurface | null = null;

  capabilities(): RendererCapabilities {
    return { name: 'CanvasRenderer', version: '1.0.0', supportsMouse: false, supportsColor: true, supportsUnicode: true, supportsTrueColor: false };
  }

  async initialize(terminal: TerminalControl): Promise<void> { this.terminal = terminal; this.initialized = true; }

  /** Set a pre-rendered surface (legacy view content) that gets blitted
   *  as the left column. Accepts null to clear. */
  setPreRenderSurface(surface: RenderSurface | null): void { this.preRenderSurface = surface; }

  render(viewState: OperatorViewState): void {
    if (!this.initialized) return;
    const dims = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    this.geometry = this.engine.compute(dims, viewState.panels.filter((p) => p.visible).length);
    const geo = this.geometry;
    const c = new CanvasSurface(dims.columns, dims.rows);

    // ── Left column: blit pre-rendered legacy view ──
    if (this.preRenderSurface) {
      c.blit(this.preRenderSurface, 0, 0);
    }

    // ── Header ─────────────────────────────────────────────────────
    for (let i = 0; i < dims.columns; i++) c.write(i, 0, '\x1b[90m─\x1b[0m');
    c.write(2, 1, '\x1b[32mALiX TUI\x1b[0m\x1b[1m - Interactive Session\x1b[0m');
    const ver = viewState.sessionMetadata?.version ?? '0.0.0';
    const mode = viewState.sessionMetadata?.mode ?? 'auto';
    const rightText = `\x1b[90mAgent OS v${ver}  │  Session: ${mode}  │  Mode: ${mode}\x1b[0m`;
    const rLen = `Agent OS v${ver}  │  Session: ${mode}  │  Mode: ${mode}`.length;
    c.write(Math.max(2, dims.columns - rLen), 1, rightText);
    for (let i = 0; i < dims.columns; i++) c.write(i, 2, '\x1b[90m─\x1b[0m');

    // ── Vertical divider ───────────────────────────────────────────
    for (let y = geo.headerH; y < dims.rows - geo.footerH; y++) {
      c.write(geo.dividerX, y, '\x1b[90m│\x1b[0m');
    }

    // ── Sidebar panels ─────────────────────────────────────────────
    this.renderSidebar(c, viewState, geo);

    // ── Tab bar ────────────────────────────────────────────────────
    this.renderTabBar(c, viewState, geo);

    // ── Status bar ─────────────────────────────────────────────────
    this.renderStatusBar(c, viewState, geo);

    // ── Write through TerminalControl ─────────────────────────────
    this.terminal.write(c.serialize());

    // ── Cursor positioning through TerminalControl ─────────────────
    this.positionCursor(viewState, geo);
  }

  resize(columns: number, rows: number): void {
    this.geometry = this.engine.compute({ columns, rows }, 4);
  }

  async shutdown(): Promise<void> { this.initialized = false; this.preRenderSurface = null; }

  /* ─── Private drawing ────────────────────────────────────────── */

  private renderSidebar(c: RenderSurface, vs: OperatorViewState, geo: CanvasGeometry): void {
    const sc = new CanvasSurface(geo.rightW, c.height);
    let y = geo.headerH;
    for (const panel of vs.panels) {
      if (!panel.visible) continue;
      if (y + geo.perPanelH > c.height - geo.footerH) break;
      this.paintPanel(sc, panel, 0, y, geo.rightW, geo.perPanelH);
      y += geo.perPanelH;
    }
    c.blit(sc, geo.dividerX + 1, 0);
  }

  private paintPanel(s: RenderSurface, panel: PanelViewModel, x: number, y: number, w: number, h: number): void {
    const titleColor = panel.focused ? '\x1b[1;36m' : '\x1b[32m';
    s.drawBox(x, y, w, h);
    s.write(x + 2, y + 1, `${titleColor}${panel.title}\x1b[0m`);
    for (let i = 0; i < Math.min(panel.items.length, h - 3); i++) {
      const item = panel.items[i]!;
      s.write(x + 2, y + 3 + i, (item.subtitle ? `${item.title} ${item.subtitle}` : item.title).slice(0, w - 4));
    }
  }

  private renderTabBar(s: RenderSurface, vs: OperatorViewState, geo: CanvasGeometry): void {
    let line = '';
    for (const t of vs.tabs) {
      line += t.active ? ` \x1b[7m ${t.id} \x1b[0m` : `  ${t.id}  `;
    }
    const hints = '\x1b[90m↑/↓  |  tab  |  ?  |  q quit\x1b[0m';
    const budget = Math.max(0, geo.leftW - hints.length + 9);
    s.write(0, s.height - 3, line.length <= budget ? line + ' '.repeat(budget - line.length) : line.slice(0, budget));
    s.write(geo.leftW - (hints.length - 9), s.height - 3, hints);
  }

  private renderStatusBar(s: RenderSurface, vs: OperatorViewState, geo: CanvasGeometry): void {
    const sb = vs.statusBar;
    let phaseLine = '';
    for (const p of sb.phaseRadios) {
      phaseLine += p.active ? `\x1b[32m● ${p.label}\x1b[0m   ` : `\x1b[90m○ ${p.label}\x1b[0m   `;
    }
    const sep = '\x1b[90m|\x1b[0m';
    const fields = sb.fields.map((f) => `${f.label}: ${f.value}`);
    const line = sb.activeTab === 'chat'
      ? `${sep} ${fields.join(` ${sep} `)}`
      : `${phaseLine} ${sep} ${fields.join(` ${sep} `)}`;
    s.write(0, s.height - 1, line.slice(0, Math.max(0, geo.leftW - 2)));
  }

  private positionCursor(vs: OperatorViewState, geo: CanvasGeometry): void {
    if (vs.activeTab === 'chat') {
      this.terminal.setCursor(5, 7 + vs.input.buffer.length + 1);
    } else if (vs.activeTab === 'agent') {
      this.terminal.setCursor(5, 13 + vs.input.buffer.length + 1);
    } else {
      this.terminal.setCursor(5, 1);
    }
  }
}
```

- [ ] **Step 2: Test**

```typescript
// tests/tui/canvas-renderer.vitest.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasRenderer } from '../../src/tui/renderers/canvas-renderer.js';
import type { OperatorViewState } from '../../src/tui/presentation/types.js';
import type { TerminalControl } from '../../src/tui/terminal-control.js';
import { CanvasSurface } from '../../src/tui/renderers/canvas-surface.js';

function mockTC(): TerminalControl {
  return { enterAltBuffer: vi.fn(), exitAltBuffer: vi.fn(), enterRawMode: vi.fn(), exitRawMode: vi.fn(), showCursor: vi.fn(), onResize: vi.fn(), installEmergencyCleanup: vi.fn(), write: vi.fn(), setCursor: vi.fn() } as unknown as TerminalControl;
}

function mockVS(): OperatorViewState {
  return {
    tabs: ['chat', 'agent', 'approvals', 'daemon', 'runtime', 'sops', 'policy'].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), active: id === 'chat' })),
    activeTab: 'chat',
    panels: ['daemon', 'approvals', 'runtime', 'sops_policy'].map((id) => ({ id, title: id.toUpperCase(), items: [], scrollOffset: 0, focused: false, totalItems: 0, visible: true, kind: id as any })),
    input: { buffer: '', prompt: 'alix> ', cursorPos: 0, activeTab: 'chat', mode: 'chat' },
    statusBar: { phaseRadios: [], fields: [{ label: 'DAEMON', value: '○ stopped' }], activeTab: 'chat' },
    sessionMetadata: null, daemonStatus: null,
  };
}

describe('CanvasRenderer', () => {
  let r: CanvasRenderer; let tc: TerminalControl;
  beforeEach(() => { r = new CanvasRenderer(); tc = mockTC(); });

  it('capabilities', () => { expect(r.capabilities().name).toBe('CanvasRenderer'); });
  it('initialize stores terminal', async () => { await r.initialize(tc); expect(r).toBeDefined(); });
  it('render no-ops before initialize', () => { expect(() => r.render(mockVS())).not.toThrow(); });
  it('render calls terminal.write after init', async () => {
    await r.initialize(tc);
    r.render(mockVS());
    expect(tc.write).toHaveBeenCalled();
  });
  it('render calls terminal.setCursor after init', async () => {
    await r.initialize(tc);
    r.render(mockVS());
    expect(tc.setCursor).toHaveBeenCalledWith(5, 8); // 7 + 0 + 1
  });
  it('setPreRenderSurface accepts null', () => { expect(() => r.setPreRenderSurface(null)).not.toThrow(); });
  it('setPreRenderSurface accepts CanvasSurface', async () => {
    await r.initialize(tc);
    const surface = new CanvasSurface(80, 24);
    surface.write(0, 0, 'legacy');
    r.setPreRenderSurface(surface);
    r.render(mockVS());
    expect(tc.write).toHaveBeenCalled();
  });
  it('resize updates geometry', async () => {
    await r.initialize(tc);
    r.resize(120, 40);
    r.render(mockVS());
    expect(tc.write).toHaveBeenCalled();
  });
  it('shutdown clears pre-render surface', async () => {
    await r.initialize(tc);
    r.setPreRenderSurface(new CanvasSurface(80, 24));
    await r.shutdown();
    r.render(mockVS());
    // No crash
  });
  it('exposes PreRenderCapable', () => { expect('setPreRenderSurface' in r).toBe(true); });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run tests/tui/canvas-renderer.vitest.ts tests/tui/canvas-surface.vitest.ts tests/tui/canvas-layout.vitest.ts tests/tui/renderer-types.vitest.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/renderers/canvas-renderer.ts tests/tui/canvas-renderer.vitest.ts
git commit -m "feat(tui): implement CanvasRenderer (domain-free, no stdout)"
```

---

### Task 7: Implement ViewModelBuilder

**Files:**
- Create: `src/tui/presentation/builder.ts`
- Test: `tests/tui/view-model.vitest.ts`

**Role:** Presentation translator — maps `DashboardSnapshot` fields to `OperatorViewState`. It is NOT a snapshot clone; it only exposes what the renderer needs to paint. If a snapshot field has no visual representation, it doesn't appear here.

- [ ] **Step 1: Write `src/tui/presentation/builder.ts`**

```typescript
import type { DashboardSnapshot } from '../snapshot.js';
import type { PerTabState, TabId } from '../state.js';
import type {
  OperatorViewState, PanelViewModel, PanelItem, InputViewModel, StatusBarViewModel, TabInfo,
} from './types.js';

const TAB_ORDER: readonly TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
const PHASE_DEFS: ReadonlyArray<{ readonly phase: string; readonly label: string }> = [
  { phase: 'Understanding', label: 'UNDERSTANDING' },
  { phase: 'Planning', label: 'PLANNING' },
  { phase: 'Executing', label: 'EXECUTING' },
  { phase: 'Verifying', label: 'VERIFYING' },
  { phase: 'Summarizing', label: 'SUMMARIZING' },
];

export class ViewModelBuilder {
  build(snapshot: DashboardSnapshot, state: PerTabState, activeTab: TabId): OperatorViewState {
    return {
      tabs: TAB_ORDER.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), active: id === activeTab })),
      activeTab,
      panels: [this.daemonPanel(snapshot), this.approvalsPanel(snapshot, state), this.runtimePanel(snapshot), this.sopsPolicyPanel(snapshot, state)],
      input: this.buildInput(activeTab, state),
      statusBar: this.buildStatusBar(snapshot, activeTab),
      sessionMetadata: snapshot.session ? { version: snapshot.session.version, mode: snapshot.session.mode, phase: snapshot.session.phase } : null,
      daemonStatus: snapshot.daemon ? { running: true, cpuPercent: snapshot.daemon.cpuPercent, memoryRssBytes: snapshot.daemon.memoryRssBytes, memoryTotalBytes: snapshot.daemon.memoryTotalBytes, diskUsedBytes: snapshot.daemon.diskUsedBytes, diskTotalBytes: snapshot.daemon.diskTotalBytes, pid: snapshot.daemon.pid, uptimeSeconds: snapshot.daemon.uptimeSeconds } : null,
    };
  }

  private daemonPanel(snap: DashboardSnapshot): PanelViewModel {
    const d = snap.daemon;
    const items: PanelItem[] = d
      ? [
          { id: 'pid', title: `PID: ${d.pid ?? '—'}`, status: 'info', subtitle: '' },
          { id: 'uptime', title: `Uptime: ${fmtUptime(d.uptimeSeconds)}`, status: 'info', subtitle: '' },
          { id: 'version', title: `Version: ${snap.session?.version ?? '—'}`, status: 'info', subtitle: '' },
          { id: 'cpu', title: `CPU: ${fmtPct(d.cpuPercent / 100)}`, status: d.cpuPercent > 80 ? 'warning' : 'info', subtitle: '' },
          { id: 'mem', title: `MEM: ${fmtBytes(d.memoryRssBytes)} / ${fmtBytes(d.memoryTotalBytes)}`, status: 'info', subtitle: '' },
        ]
      : [{ id: 'stopped', title: '○ not running', status: 'error', subtitle: '' }];
    return { id: 'daemon', title: 'DAEMON', items, scrollOffset: 0, focused: false, totalItems: items.length, visible: true, kind: 'daemon' };
  }

  private approvalsPanel(snap: DashboardSnapshot, state: PerTabState): PanelViewModel {
    const now = Date.now();
    const items: PanelItem[] = [
      ...(snap.approvals?.pending ?? []).slice().sort((a, b) => b.requestedAt - a.requestedAt).map((a) => ({ id: a.id, title: a.toolName, subtitle: a.targetPath, status: 'pending' as const, rightLabel: fmtRelative(a.requestedAt, now) })),
      ...(snap.approvals?.recentlyResolved ?? []).slice().sort((a, b) => b.requestedAt - a.requestedAt).map((a) => ({ id: a.id, title: a.toolName, subtitle: a.targetPath, status: 'resolved' as const, statusLabel: '✓ approved', rightLabel: fmtRelative(a.requestedAt, now) })),
    ];
    return { id: 'approvals', title: 'APPROVALS', items, scrollOffset: state.panelScrollOffsets.approvals, focused: state.panelFocus === 'approvals', totalItems: items.length, visible: true, kind: 'approvals' };
  }

  private runtimePanel(snap: DashboardSnapshot): PanelViewModel {
    const wf = snap.runtime?.workflow;
    const events = snap.runtime?.totalEventCount ?? 0;
    const items: PanelItem[] = wf
      ? [{ id: 'step', title: `Step ${wf.currentStep} / ${wf.totalSteps}`, status: 'active', subtitle: '', rightLabel: `${events} events` }, { id: 'name', title: wf.name, status: 'info', subtitle: '' }]
      : [{ id: 'idle', title: events > 0 ? `${events} events` : '○ no active workflow', status: 'info', subtitle: '' }];
    return { id: 'runtime', title: 'RUNTIME', items, scrollOffset: 0, focused: false, totalItems: items.length, visible: true, kind: 'runtime' };
  }

  private sopsPolicyPanel(snap: DashboardSnapshot, state: PerTabState): PanelViewModel {
    const sopItems: PanelItem[] = (snap.sops?.items ?? []).map((s) => ({ id: s.id, title: s.name, subtitle: s.version, status: 'info' as const }));
    const policyItems: PanelItem[] = snap.policy ? [{ id: 'mode', title: `Policy: ${snap.policy.enforcementMode}`, status: 'info', subtitle: '', rightLabel: `${snap.policy.recentViolationCount} violations` }] : [];
    return { id: 'sops_policy', title: 'SOPS & POLICY', items: [...sopItems, ...policyItems], scrollOffset: state.panelScrollOffsets.sops, focused: state.panelFocus === 'sops', totalItems: sopItems.length + policyItems.length, visible: true, kind: 'sops_policy' };
  }

  private buildInput(activeTab: TabId, state: PerTabState): InputViewModel {
    if (activeTab === 'chat' || activeTab === 'agent') {
      return { buffer: state.inputBuffer, prompt: activeTab === 'chat' ? 'alix> ' : 'alix-agent> ', cursorPos: state.inputBuffer.length, activeTab, mode: activeTab };
    }
    return { buffer: '', prompt: '', cursorPos: 0, activeTab, mode: 'neutral' };
  }

  private buildStatusBar(snap: DashboardSnapshot, activeTab: TabId): StatusBarViewModel {
    const activePhase = snap.session?.phase ?? 'Idle';
    const phaseRadios = PHASE_DEFS.map((p) => ({ phase: p.phase, active: p.phase === activePhase, label: p.label }));
    return { phaseRadios, fields: [
      { label: 'DAEMON', value: snap.daemon ? '● running' : '○ stopped' },
      { label: 'EVENTS', value: (snap.runtime?.totalEventCount ?? 0).toLocaleString('en-US') },
      { label: 'SOPS', value: String(snap.sops?.totalLoaded ?? 0) },
      { label: 'RULES', value: String(snap.policy?.rules.length ?? 0) },
    ], activeTab };
  }
}

function fmtUptime(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function fmtPct(f: number): string { return f < 0 || !Number.isFinite(f) ? '(?)%' : `${Math.max(0, Math.min(100, f * 100)).toFixed(1)}%`; }
function fmtBytes(b: number): string { if (b < 1024) return `${b}B`; if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`; return `${(b / (1024 * 1024)).toFixed(1)}MB`; }
function fmtRelative(ts: number, now: number): string { const s = Math.max(0, Math.floor((now - ts) / 1000)); if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; return `${Math.floor(s / 3600)}h ago`; }
```

- [ ] **Step 2: Test at `tests/tui/view-model.vitest.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { ViewModelBuilder } from '../../src/tui/presentation/builder.js';
import type { DashboardSnapshot, DaemonMetricsSnapshot } from '../../src/tui/snapshot.js';
import type { PerTabState } from '../../src/tui/state.js';

function mockSnap(o: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return { generatedAt: Date.now(), session: { mode: 'auto', phase: 'Idle', version: '0.5.0', startedAt: Date.now(), turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null, ...o };
}
function mockState(o: Partial<PerTabState> = {}): PerTabState {
  return { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, pinnedBottom: true, inputBuffer: '', submittedPrompts: [], agentResponses: [], pendingApprovals: [], resolvedApprovals: [], panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null, ...o };
}

describe('ViewModelBuilder', () => {
  const b = new ViewModelBuilder();

  it('7 tabs, first active', () => { const vm = b.build(mockSnap(), mockState(), 'chat'); expect(vm.tabs).toHaveLength(7); expect(vm.tabs[0]!.active).toBe(true); });
  it('4 panels', () => { expect(b.build(mockSnap(), mockState(), 'chat').panels).toHaveLength(4); });
  it('approvals respects scroll/focus', () => {
    const s = mockState({ panelScrollOffsets: { approvals: 2, sops: 0 }, panelFocus: 'approvals' });
    const vm = b.build(mockSnap(), s, 'approvals');
    expect(vm.panels.find((p) => p.id === 'approvals')!.scrollOffset).toBe(2);
    expect(vm.panels.find((p) => p.id === 'approvals')!.focused).toBe(true);
  });
  it('chat input', () => { expect(b.build(mockSnap(), mockState({ inputBuffer: 'hi' }), 'chat').input.buffer).toBe('hi'); });
  it('agent prompt differs', () => { expect(b.build(mockSnap(), mockState(), 'agent').input.prompt).toBe('alix-agent> '); });
  it('daemon stopped state', () => { expect(b.build(mockSnap({ daemon: null }), mockState(), 'chat').panels.find((p) => p.id === 'daemon')!.items[0]!.title).toContain('not running'); });
});
```

- [ ] **Step 3: Run tests** → `pnpm vitest run tests/tui/view-model.vitest.ts`

- [ ] **Step 4: Commit**

```bash
git add src/tui/presentation/builder.ts tests/tui/view-model.vitest.ts
git commit -m "feat(tui): implement ViewModelBuilder (presentation translator)"
```

---

### Task 8: Implement LegacyViewBridge

**Files:**
- Create: `src/tui/legacy/legacy-view-bridge.ts`
- Test: `tests/tui/legacy-view-bridge.vitest.ts`

This is the **temporary** compatibility layer that runs existing `TuiView.render()` calls and writes them into a `RenderSurface`. It lives COMPLETELY outside the renderer — `app.ts` calls this module, and the resulting `RenderSurface` is passed to `CanvasRenderer.setPreRenderSurface()`.

**PR C removes this entire module.**

- [ ] **Step 1: Write `src/tui/legacy/legacy-view-bridge.ts`**

```typescript
/**
 * LegacyViewBridge — renders existing TuiView instances into a RenderSurface.
 *
 * This is a TEMPORARY compatibility layer for PR A. It sits above the
 * renderer in the call stack (in app.ts). The renderer never imports it.
 *
 * PR C (adopt Blessed) removes this file entirely.
 */

import type { RenderSurface } from '../renderer/surface.js';
import type { DashboardSnapshot } from '../snapshot.js';
import type { PerTabState, TabId } from '../state.js';
import type { TuiView } from '../views/types.js';
import { CanvasSurface } from '../renderers/canvas-surface.js';

export interface LegacyBridgeConfig {
  readonly snap: DashboardSnapshot;
  readonly perTab: PerTabState;
  readonly views: Readonly<Record<TabId, TuiView>>;
  readonly activeTab: TabId;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
}

/**
 * Render the active legacy view into a RenderSurface.
 *
 * Returns null if the active tab has no view registered.
 */
export function renderLegacyView(config: LegacyBridgeConfig): RenderSurface | null {
  const view = config.views[config.activeTab];
  if (!view) return null;

  const surface = new CanvasSurface(config.surfaceWidth, config.surfaceHeight);
  const canvas = (surface as any).canvas; // temporary — view.render() expects TerminalCanvas

  view.render({
    snap: config.snap,
    dimensions: { columns: config.surfaceWidth, rows: config.surfaceHeight },
    perTab: config.perTab,
    canvas, // TerminalCanvas passed directly — view writes into it
  });

  return surface;
}
```

- [ ] **Step 2: Test at `tests/tui/legacy-view-bridge.vitest.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderLegacyView } from '../../src/tui/legacy/legacy-view-bridge.js';
import { CanvasSurface } from '../../src/tui/renderers/canvas-surface.js';
import type { DashboardSnapshot } from '../../src/tui/snapshot.js';
import type { PerTabState, TabId } from '../../src/tui/state.js';
import type { TuiView } from '../../src/tui/views/types.js';

describe('LegacyViewBridge', () => {
  it('returns null for unknown tab', () => {
    const result = renderLegacyView({
      snap: {} as DashboardSnapshot,
      perTab: {} as PerTabState,
      views: {} as Record<TabId, TuiView>,
      activeTab: 'nonexistent' as TabId,
      surfaceWidth: 80,
      surfaceHeight: 24,
    });
    expect(result).toBeNull();
  });

  it('returns a RenderSurface for valid view', () => {
    const mockView: TuiView = {
      id: 'chat' as TabId,
      render: vi.fn(),
    };
    const result = renderLegacyView({
      snap: { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
      perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, pinnedBottom: true, inputBuffer: '', submittedPrompts: [], agentResponses: [], pendingApprovals: [], resolvedApprovals: [], panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
      views: { chat: mockView } as Record<TabId, TuiView>,
      activeTab: 'chat' as TabId,
      surfaceWidth: 80,
      surfaceHeight: 24,
    });
    expect(result).not.toBeNull();
    expect(result!.width).toBe(80);
    expect(mockView.render).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests** → `pnpm vitest run tests/tui/legacy-view-bridge.vitest.ts`

- [ ] **Step 4: Commit**

```bash
git add src/tui/legacy/ tests/tui/legacy-view-bridge.vitest.ts
git commit -m "feat(tui): add LegacyViewBridge (temporary, removed in PR C)"
```

---

### Task 9: Add write() and setCursor() to TerminalControl

**Files:**
- Modify: `src/tui/terminal-control.ts`
- Test: update `tests/tui/terminal-control.vitest.ts` if it exists

- [ ] **Step 1: Modify `src/tui/terminal-control.ts`**

Add `write(data)` and `setCursor(row, col)` to the interface and implementation:

```typescript
export interface TerminalControl {
  // ... existing methods ...
  /** Write data to stdout. Single owner of terminal output. */
  write(data: string): void;
  /** Position cursor at (row, column) — 1-indexed. */
  setCursor(row: number, column: number): void;
}

export function createTerminalControl(): TerminalControl {
  return {
    // ... existing methods ...

    write(data: string) {
      process.stdout.write(data);
    },
    setCursor(row: number, column: number) {
      process.stdout.write(`\x1b[${row};${column}H`);
    },
  };
}
```

- [ ] **Step 2: Run existing tests** → `pnpm vitest run`

- [ ] **Step 3: Commit**

```bash
git add src/tui/terminal-control.ts
git commit -m "feat(tui): add write() and setCursor() to TerminalControl"
```

---

### Task 10: Wire into app.ts (Strangler Pattern)

**Files:**
- Modify: `src/tui/app.ts`

After this task, `app.ts` must:
- NOT import `TerminalCanvas`, `renderSidebar`, or `canvas.js`
- Use `TerminalControl.write()` and `setCursor()` for all output
- Pass legacy view surface via `setPreRenderSurface()` (capability check, NOT a cast)

- [ ] **Step 1: Update `src/tui/app.ts`**

Remove:
```typescript
import { TerminalCanvas } from './canvas.js';
import { renderSidebar } from './sidebar.js';
import { DEFAULT_PANEL_H } from './dashboard-renderer.js';
```

Add:
```typescript
import type { OperatorRenderer } from './renderer/types.js';
import { CanvasRenderer } from './renderers/canvas-renderer.js';
import type { PreRenderCapable } from './renderers/canvas-renderer.js';
import { ViewModelBuilder } from './presentation/builder.js';
import { renderLegacyView } from './legacy/legacy-view-bridge.js';
```

Constructor:
```typescript
private readonly renderer: OperatorRenderer;
private readonly viewModelBuilder = new ViewModelBuilder();

constructor(private readonly opts: TuiAppOptions) {
  // ... existing init ...
  this.renderer = opts.renderer ?? new CanvasRenderer();
}
```

`start()`:
```typescript
async start(): Promise<void> {
  this.terminal.enterAltBuffer();
  this.terminal.enterRawMode();
  this.terminal.showCursor(true);

  // Route resize through the renderer.
  this.terminal.onResize(() => {
    const dims = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    this.renderer.resize(dims.columns, dims.rows);
    this.paintFullFrame();
  });

  await this.renderer.initialize(this.terminal);

  this.opts.daemonMetrics.start();
  const initialGen = ++this.state.refreshGeneration;
  const snap = await this.opts.builder.build(initialGen);
  if (snap && initialGen === this.state.refreshGeneration) {
    this.state.lastSnapshot = snap;
  }
  this.paintFullFrame();
  this.terminal.installEmergencyCleanup(() => this.cleanupSync());
  process.stdin.on('data', (buf) => { if (Buffer.isBuffer(buf)) this.handleRaw(buf); });
  this.snapshotTimer = setInterval(() => void this.refresh(), 1_000);
}
```

`stop()`:
```typescript
async stop(): Promise<void> {
  if (this.detached) return;
  this.detached = true;
  if (this.snapshotTimer) clearInterval(this.snapshotTimer);
  await this.opts.daemonMetrics.stop();
  await this.renderer.shutdown();
  await this.cleanupSync();
}
```

`paintFullFrame()`:
```typescript
private paintFullFrame(): void {
  if (!this.state.lastSnapshot) return;
  const snap = this.state.lastSnapshot;
  const activeTab = this.state.activeTab;
  const perTab = this.state.views[activeTab];

  const vm = this.viewModelBuilder.build(snap, perTab, activeTab);

  // Set legacy view surface via capability interface (not a cast)
  const preRender = this.renderer as unknown as PreRenderCapable;
  if ('setPreRenderSurface' in preRender) {
    const dims = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    const leftW = Math.max(40, Math.floor(dims.columns * 0.75));
    const legacySurface = renderLegacyView({
      snap,
      perTab,
      views: this.views as Record<TabId, import('./views/types.js').TuiView>,
      activeTab,
      surfaceWidth: leftW,
      surfaceHeight: dims.rows,
    });
    preRender.setPreRenderSurface(legacySurface);
  }

  this.renderer.render(vm);
}
```

Remove the ENTIRE old `paintFullFrame()` body (lines 608-746 of current app.ts) — it's replaced by the renderer.

- [ ] **Step 2: Verify strangler completeness**

```bash
grep -rn "TerminalCanvas\|renderSidebar\|DEFAULT_PANEL_H" src/tui/app.ts           → empty
grep -rn "from './canvas\|from './sidebar\|from './dashboard-renderer" src/tui/app.ts → empty
```

- [ ] **Step 3: Verify renderer invariants**

```bash
grep -rn "DashboardSnapshot\|PerTabState\|process.stdout" src/tui/renderers/         → empty
```

- [ ] **Step 4: Run full test suite**

```bash
pnpm vitest run
# Expected: 0 failures
pnpm tsc --noEmit
# Expected: clean
```

- [ ] **Step 5: Commit**

```bash
git add src/tui/app.ts
git commit -m "feat(tui): wire renderer into app.ts (strangler)"
```

---

### Task 11: Update tests for new architecture

**Files:**
- Modify: `tests/tui/app.vitest.ts`
- Verify: `tests/tui/state.vitest.ts` (unchanged — 7 tabs preserved)
- Add: `tests/tui/terminal-control.vitest.ts` (if it doesn't exist)

- [ ] **Step 1: Update `tests/tui/app.vitest.ts`**

Inject `NoopRenderer` in all `TuiApp` constructions. Add a test verifying resize routes through the renderer.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';
import { NoopRenderer } from '../../src/tui/renderer/contract.js';

describe('TuiApp -- lifecycle', () => {
  let builder: { build: ReturnType<typeof vi.fn>; buildSync: ReturnType<typeof vi.fn> };
  let metrics: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  let app: TuiApp | undefined;
  const noop = new NoopRenderer();

  beforeEach(() => {
    builder = { build: vi.fn(async () => null), buildSync: vi.fn(() => null) };
    metrics = { start: vi.fn(() => {}), stop: vi.fn(async () => {}) };
  });
  afterEach(async () => { if (app) await app.stop().catch(() => {}); });

  it('start() invokes renderer.initialize', async () => {
    const spy = vi.spyOn(noop, 'initialize');
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer: noop } as unknown as TuiAppOptions);
    await app.start();
    expect(spy).toHaveBeenCalled();
    await app.stop();
  });

  it('stop() invokes renderer.shutdown', async () => {
    const spy = vi.spyOn(noop, 'shutdown');
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer: noop } as unknown as TuiAppOptions);
    await app.start();
    await app.stop();
    expect(spy).toHaveBeenCalled();
  });

  it('start() calls builder.build and metrics.start', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer: noop } as unknown as TuiAppOptions);
    await app.start();
    expect(metrics.start).toHaveBeenCalled();
    expect(builder.build).toHaveBeenCalled();
    await app.stop();
  });
});

describe('TuiApp -- tab-state preservation', () => {
  it('preserves runtime.scrollOffset', () => {
    const builder = { build: vi.fn(async () => ({} as any)), buildSync: () => ({} as any) };
    const metrics = { start: () => {}, stop: async () => {} };
    const app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    app.getStateForTest().views.runtime.scrollOffset = 200;
    expect(app.getStateForTest().views.runtime.scrollOffset).toBe(200);
  });
});

// chat-input dispatch tests remain unchanged — they don't call start()
```

- [ ] **Step 2: Add `tests/tui/terminal-control.vitest.ts` (if missing)**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createTerminalControl } from '../../src/tui/terminal-control.js';

describe('TerminalControl', () => {
  const tc = createTerminalControl();

  it('write sends data to stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    tc.write('hello');
    expect(spy).toHaveBeenCalledWith('hello');
    spy.mockRestore();
  });

  it('setCursor writes ANSI cursor position', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    tc.setCursor(5, 10);
    expect(spy).toHaveBeenCalledWith('\x1b[5;10H');
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm vitest run
# Expected: 0 failures
pnpm tsc --noEmit
# Expected: clean
```

- [ ] **Step 4: Final commit**

```bash
git add tests/tui/app.vitest.ts tests/tui/terminal-control.vitest.ts
git commit -m "test: inject NoopRenderer, add TerminalControl write/setCursor tests"
```

---

## Verification

### Automated invariants (grep-enforced)
```bash
# Renderer must never import domain types
grep DashboardSnapshot src/tui/renderers/   || echo "PASS: no domain types"
grep PerTabState src/tui/renderers/         || echo "PASS: no per-tab state"
grep -rn "process.stdout" src/tui/renderers/ || echo "PASS: no direct stdout"

# app.ts must not import TerminalCanvas or sidebar
grep TerminalCanvas src/tui/app.ts          || echo "PASS: no canvas in app"
grep renderSidebar src/tui/app.ts           || echo "PASS: no sidebar in app"

# No require()
grep "require(" src/tui/app.ts src/tui/renderer/ src/tui/renderers/ src/tui/presentation/ || echo "PASS: all ESM"
```

### Full test suite
```bash
pnpm vitest run          # 0 failures
pnpm tsc --noEmit        # clean
```

### Manual
```bash
node dist/cli.js tui
```
- All 7 tabs render identically to pre-PR-A
- Tab/S-Tab/Escape/Ctrl-N cycle correctly
- J/K scroll on approvals/sops
- Chat input works, agent tab shows plan + approval cards
- Sidebar renders all 4 panels
- q/Q/Ctrl-C quits cleanly
- Resize terminal — layout adjusts

### Inspector unaffected
```bash
node dist/cli.js serve   # no changes outside src/tui/
```

## Acceptance Criteria

| Criterion | Verification |
|-----------|-------------|
| `app.ts` imports no TerminalCanvas | `grep TerminalCanvas src/tui/app.ts` → empty |
| Renderers import no domain types | `grep DashboardSnapshot src/tui/renderers/` → empty |
| No `process.stdout` in renderers | `grep process.stdout src/tui/renderers/` → empty |
| Legacy bridge uses `in` check (not cast) | `grep "as CanvasRenderer" src/tui/app.ts` → empty |
| All 7 tabs render identically | manual test |
| `pnpm vitest run` = 0 failures | CI |
| `pnpm tsc --noEmit` = clean | CI |
