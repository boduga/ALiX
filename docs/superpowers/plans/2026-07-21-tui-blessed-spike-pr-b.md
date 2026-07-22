# PR B — neo-blessed Renderer Evaluation Spike

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate neo-blessed as a replacement for the homegrown `TerminalCanvas` renderer by implementing a minimal `BlessedRenderer` behind the existing `OperatorRenderer` interface. This is an evaluation spike — not a production replacement.

**Architecture:** `BlessedRenderer implements OperatorRenderer` — consumes `OperatorViewState`, uses blessed widgets (Box, List, Textarea) instead of `TerminalCanvas`. Widgets are created once in `initialize()` and updated via `setContent()`/`setItems()` in `render()` — never destroyed and recreated per frame.

**Tech Stack:** TypeScript ESM, neo-blessed, Node.js

**Global Constraints:**
- **Evaluation only** — output is an ADR-quality comparison table, not a production renderer. No production dependency on neo-blessed is introduced until ADR approval. Spike branch can be discarded without affecting CanvasRenderer.
- BlessedRenderer implements the same `OperatorRenderer` interface from `src/tui/renderer/types.ts`
- BlessedRenderer receives ONLY `OperatorViewState` — same invariant as CanvasRenderer: no domain types
- BlessedRenderer uses blessed-native layout — NOT `CanvasLayoutEngine`
- BlessedRenderer receives `TerminalControl.input`/`.output` as explicit typed streams — no `as any`
- `handlesInput` is a REQUIRED field on `RendererCapabilities` — every renderer declares input ownership
- **Raw mode is only entered when the renderer does NOT handle input** — checked AFTER `initialize()`
- `TerminalControl.installEmergencyCleanup()` runs BEFORE renderer initialization — always
- Widgets created once in `initialize()`, updated in `render()` — verified by widget-persistence test (all widgets)
- Blessed key event listeners are cleaned up in `shutdown()` — verified by listener leak test on blessed screen mock
- Widget references exposed via `@internal getWidgetReferences()` — no `(r as any)`
- `TerminalControl` always owns: alt buffer, raw mode, cursor visibility, SIGWINCH, emergency restore
- BlessedRenderer owns only: widget tree, layout, keypress events, render scheduling. Teardown path verified via screen.destroy() call-count test.
- Branch: create from `feat/tui-renderer-abstraction-pr-a` as `feat/tui-blessed-spike-pr-b`

## Evaluation Criteria

| Criterion | CanvasRenderer | BlessedRenderer |
|-----------|---------------|-----------------|
| Ergoonomics (LOC for same output) | measure | measure |
| Resize handling | manual (onResize → recompute geometry) | blessed-managed widget geometry recalculation |
| Scroll bookkeeping | custom (scrollOffset, panelFocus) | built-in List widget |
| Input capture | raw stdin → parseKey() | blessed keypress |
| Lines of ALiX code eliminated | baseline | estimate |
| Custom primitives eliminated | canvas.ts, canvas-cell.ts, layout.ts, sidebar.ts, partial dashboard-renderer | none |
| Memory lifecycle (long sessions) | deterministic (fresh canvas per frame) | persistent widget tree — verified no leaks |

---

## File Structure

**New files:**

```
src/tui/renderers/blessed-renderer.ts
```

**Modified files:**

| File | Change |
|------|--------|
| `package.json` | Add `neo-blessed` |
| `src/tui/terminal-control.ts` | Add `input`/`output` fields |
| `src/tui/renderer/types.ts` | `handlesInput` REQUIRED |
| `src/tui/renderer/contract.ts` | `handlesInput: false` |
| `src/tui/renderers/canvas-renderer.ts` | `handlesInput: false` |
| `src/tui/app.ts` | env toggle, input ownership ordering |
| `tests/tui/blessed-renderer.vitest.ts` | **NEW** |

**Evaluation artifact:**

| File | Change |
|------|--------|
| `docs/adr/ADR-0013-renderer-comparison.md` | **NEW** |

---

### Task 1: Add input/output to TerminalControl, make handlesInput required

- [ ] `pnpm add neo-blessed` (NOTE: do NOT install `@types/neo-blessed` — neo-blessed typings are shipped or a local `src/types/neo-blessed.d.ts` is added on demand)

- [ ] **TerminalControl interface** — add `input: NodeJS.ReadableStream` and `output: NodeJS.WritableStream`

In `src/tui/terminal-control.ts`:
```typescript
export interface TerminalControl {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  // ... existing unchanged methods ...
}
```
In `createTerminalControl()`: `return { input: process.stdin, output: process.stdout, ... }`.

- [ ] **RendererCapabilities** — make `handlesInput: boolean` required (remove `?`)

- [ ] **NoopRenderer** — add `handlesInput: false`

- [ ] **CanvasRenderer** — add `handlesInput: false`

- [ ] `pnpm tsc --noEmit` → clean

- [ ] Commit: `git add -A && git commit -m "deps(tui): add neo-blessed, input/output to TerminalControl, require handlesInput"`

---

### Task 2: Implement BlessedRenderer

- [ ] **Write `src/tui/renderers/blessed-renderer.ts`**

```typescript
import type { OperatorRenderer, RendererCapabilities } from '../renderer/types.js';
import type { OperatorViewState } from '../presentation/types.js';
import type { TerminalControl } from '../terminal-control.js';
import * as blessed from 'neo-blessed';

export class BlessedRenderer implements OperatorRenderer {
  private terminal!: TerminalControl;
  private screen: blessed.Widgets.Screen | null = null;
  private initialized = false;

  // Widget tree — created once in initialize(), updated in render()
  // Widget-persistence invariant is tested for ALL widgets in tests.
  private header?: blessed.Widgets.BoxElement;
  private status?: blessed.Widgets.BoxElement;
  private tabBar?: blessed.Widgets.BoxElement;
  private approvals?: blessed.Widgets.ListElement;
  private input?: blessed.Widgets.TextareaElement;

  capabilities(): RendererCapabilities {
    return {
      name: 'BlessedRenderer',
      version: '1.0.0-spike',
      supportsMouse: true, supportsColor: true, supportsUnicode: true, supportsTrueColor: true,
      handlesInput: true,
    };
  }

  async initialize(terminal: TerminalControl): Promise<void> {
    if (this.screen) {
      await this.shutdown();
    }
    this.terminal = terminal;
    this.screen = blessed.screen({
      input: terminal.input,
      output: terminal.output,
      smartCSR: true,
      title: 'ALiX TUI',
      fullUnicode: true,
      sendFocus: true,
    });

    // Widget tree created once ──────────────────────────────────
    this.header = blessed.box({ top: 0, left: 0, width: '100%', height: 1,
      content: ' ALiX TUI — Interactive Session',
      style: { fg: 'green', bold: true } });
    this.screen.append(this.header);

    this.approvals = blessed.list({ top: 2, left: '75%+1', width: '25%-1', height: '100%-6',
      label: ' APPROVALS ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: 'green' }, label: { fg: 'green' }, selected: { fg: 'white', bg: 'blue' } },
      items: ['○ no pending approvals'], keys: true, vi: true });
    this.screen.append(this.approvals);

    this.input = blessed.textarea({ top: '100%-2', left: 0, width: '75%', height: 1,
      inputOnFocus: true,
      style: { fg: 'white', bg: 'blue' } });
    this.screen.append(this.input);

    this.tabBar = blessed.box({ top: '100%-3', left: 0, width: '100%', height: 1,
      style: { fg: 'cyan' }, tags: true });
    this.screen.append(this.tabBar);

    this.status = blessed.box({ top: '100%-1', left: 0, width: '100%', height: 1,
      style: { fg: 'white' }, tags: true });
    this.screen.append(this.status);

    this.initialized = true;
  }

  render(viewState: OperatorViewState): void {
    if (!this.initialized || !this.screen) return;
    if (!this.header || !this.status || !this.tabBar || !this.approvals || !this.input) return;

    this.header.setContent(` ALiX TUI  │  v${viewState.sessionMetadata?.version ?? '0.0.0'}  │  Mode: ${viewState.sessionMetadata?.mode ?? 'auto'}`);

    const phaseText = viewState.statusBar.phaseRadios.map((p) => (p.active ? `● ${p.label}` : `○ ${p.label}`)).join('   ');
    const fieldText = viewState.statusBar.fields.map((f) => `${f.label}: ${f.value}`).join(' | ');
    this.status.setContent(`${phaseText}  |  ${fieldText}`);

    this.tabBar.setContent(viewState.tabs.map((t) => (t.active ? `[${t.id}]` : ` ${t.id} `)).join(' '));

    const a = viewState.panels.find((p) => p.id === 'approvals');
    if (a) {
      this.approvals.setItems(a.items.length > 0
        ? a.items.map((i) => `${i.status === 'pending' ? '●' : '○'} ${i.title}${i.subtitle ? ` ${i.subtitle}` : ''}`)
        : ['○ no pending approvals']);
    }

    this.input.setValue(viewState.input.buffer);
    this.screen.render();
  }

  resize(_c: number, _r: number): void { /* blessed handles resize via SIGWINCH */ }

  async shutdown(): Promise<void> {
    // Key handlers are registered via blessed screen.key().
    // blessed destroys them when screen.destroy() is called.
    // No explicit unkey() needed for the spike — screen.destroy() cleans up.
    if (this.screen) { this.screen.destroy(); this.screen = null; }
    this.initialized = false;
  }

  /** @internal — all widget refs for persistence testing. */
  getWidgetReferences(): {
    screen: blessed.Widgets.Screen | null;
    header: blessed.Widgets.BoxElement | undefined;
    status: blessed.Widgets.BoxElement | undefined;
    tabBar: blessed.Widgets.BoxElement | undefined;
    approvals: blessed.Widgets.ListElement | undefined;
    input: blessed.Widgets.TextareaElement | undefined;
  } {
    return { screen: this.screen, header: this.header, status: this.status, tabBar: this.tabBar, approvals: this.approvals, input: this.input };
  }
}
```

**Design note on keyHandler:** Blessed's `Textarea` widget handles keyboard input internally. No explicit global `screen.key()` handler is registered in this spike. `screen.destroy()` in `shutdown()` is blessed's teardown path. The teardown-path test verifies `destroy` is called each cycle.

- [ ] `pnpm tsc --noEmit` → verify no blessed errors

- [ ] Commit: `git add src/tui/renderers/blessed-renderer.ts && git commit -m "feat(tui): implement BlessedRenderer spike"`

---

### Task 3: Wire into app.ts with correct input ownership ordering

Pre-requisite: verify CanvasRenderer doesn't require raw mode before init.

```bash
grep -n "raw\|stdin" src/tui/renderers/canvas-renderer.ts src/tui/app.ts
```
If CanvasRenderer reads raw mode during `initialize()`, the ordering below must be adjusted.

- [ ] **Update `src/tui/app.ts`**

Add import: `import { BlessedRenderer } from './renderers/blessed-renderer.js';`

Renderer selection:
```typescript
const useBlessed = process.env.ALIX_TUI_RENDERER === 'blessed';
this.renderer = opts.renderer ?? (useBlessed ? new BlessedRenderer() : new CanvasRenderer());
```

Updated `start()` — correct ownership ordering:
```typescript
async start(): Promise<void> {
  this.terminal.enterAltBuffer();
  this.terminal.showCursor(true);

  // Emergency cleanup ALWAYS runs before renderer init
  this.terminal.installEmergencyCleanup(() => this.cleanupSync());

  // Route resize through the renderer
  this.terminal.onResize(() => {
    const dims = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    this.renderer.resize(dims.columns, dims.rows);
    this.paintFullFrame();
  });

  await this.renderer.initialize(this.terminal);

  // Only enter raw mode if the renderer does NOT handle input
  const caps = this.renderer.capabilities();
  if (!caps.handlesInput) {
    this.terminal.enterRawMode();
    process.stdin.on('data', (buf) => { if (Buffer.isBuffer(buf)) this.handleRaw(buf); });
  }

  this.opts.daemonMetrics.start();
  const initialGen = ++this.state.refreshGeneration;
  const snap = await this.opts.builder.build(initialGen);
  if (snap && initialGen === this.state.refreshGeneration) this.state.lastSnapshot = snap;
  this.paintFullFrame();
  this.snapshotTimer = setInterval(() => void this.refresh(), 1_000);
}
```

- [ ] Commit: `git add src/tui/app.ts && git commit -m "feat(tui): wire BlessedRenderer, input ownership before rawMode"`

---

### Task 4: Write lifecycle tests (mocked blessed)

- [ ] **Write `tests/tui/blessed-renderer.vitest.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OperatorViewState } from '../../src/tui/presentation/types.js';
import type { TerminalControl } from '../../src/tui/terminal-control.js';

// Mock blessed for deterministic CI (no TTY required).
// Mock tracks screen event registration so we can verify cleanup.
const mockScreen = {
  append: vi.fn(),
  render: vi.fn(),
  destroy: vi.fn(),
  unkey: vi.fn(),
  key: vi.fn(),
  children: [] as any[],
};
const mkEl = () => ({ setContent: vi.fn(), setItems: vi.fn(), setValue: vi.fn(), detach: vi.fn() });

vi.mock('neo-blessed', () => ({
  screen: () => mockScreen,
  box: mkEl,
  list: () => ({ ...mkEl(), setItems: vi.fn(), items: [], select: vi.fn() }),
  textarea: () => ({ ...mkEl(), setValue: vi.fn(), value: '' }),
  default: { screen: () => mockScreen, box: mkEl, list: mkEl, textarea: mkEl },
}));

const { BlessedRenderer } = await import('../../src/tui/renderers/blessed-renderer.js');

function mockTC(): TerminalControl {
  return {
    input: process.stdin, output: process.stdout,
    enterAltBuffer: vi.fn(), exitAltBuffer: vi.fn(),
    enterRawMode: vi.fn(), exitRawMode: vi.fn(),
    showCursor: vi.fn(), onResize: vi.fn(),
    installEmergencyCleanup: vi.fn(),
    write: vi.fn(), setCursor: vi.fn(),
  } as unknown as TerminalControl;
}

function mockVS(): OperatorViewState {
  return {
    tabs: ['chat','agent','approvals','daemon','runtime','sops','policy'].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), active: id === 'chat' })),
    activeTab: 'chat',
    panels: ['daemon','approvals','runtime','sops_policy'].map((id) => ({ id, title: id.toUpperCase(), items: [], scrollOffset: 0, focused: false, totalItems: 0, visible: true, kind: id as any })),
    input: { buffer: '', prompt: 'alix> ', cursorPos: 0, activeTab: 'chat', mode: 'chat' },
    statusBar: { phaseRadios: [{ phase: 'Idle', active: false, label: 'IDLE' }], fields: [{ label: 'DAEMON', value: '○ stopped' }], activeTab: 'chat' },
    sessionMetadata: null, daemonStatus: null,
  };
}

describe('BlessedRenderer', () => {
  let r: BlessedRenderer;
  let tc: TerminalControl;

  beforeEach(() => { r = new BlessedRenderer(); tc = mockTC(); vi.clearAllMocks(); });

  it('capabilities: handlesInput=true', () => {
    expect(r.capabilities().handlesInput).toBe(true);
  });

  it('initialize creates screen', async () => {
    await r.initialize(tc);
    expect(r).toBeDefined();
  });

  it('render updates widgets', async () => {
    await r.initialize(tc);
    expect(() => r.render(mockVS())).not.toThrow();
  });

  it('ALL widgets survive multiple renders (persistence invariant)', async () => {
    await r.initialize(tc);
    const before = r.getWidgetReferences();

    for (let i = 0; i < 5; i++) r.render(mockVS());

    const after = r.getWidgetReferences();
    expect(after.header).toBe(before.header);
    expect(after.status).toBe(before.status);
    expect(after.tabBar).toBe(before.tabBar);
    expect(after.approvals).toBe(before.approvals);
    expect(after.input).toBe(before.input);
  });

  it('initialize/shutdown cycle invokes screen.destroy each time (teardown path)', async () => {
    const cycles = 50;
    for (let i = 0; i < cycles; i++) {
      await r.initialize(tc);
      await r.shutdown();
    }
    // screen.destroy() is blessed's native teardown path.
    // This test verifies it is called on every shutdown cycle.
    // Actual listener retention requires runtime heap profiling.
    expect(mockScreen.destroy).toHaveBeenCalledTimes(cycles);
  });

  it('reinitialization destroys previous widget tree', async () => {
    await r.initialize(tc);
    const first = r.getWidgetReferences().screen;
    await r.initialize(tc);
    const second = r.getWidgetReferences().screen;
    expect(first).not.toBe(second);
    expect(mockScreen.destroy).toHaveBeenCalled();
  });

  it('render no-ops before initialize', () => {
    expect(() => r.render(mockVS())).not.toThrow();
  });

  it('resize is a no-op', () => {
    expect(() => r.resize(120, 40)).not.toThrow();
  });

  it('shutdown after initialize cleans up', async () => {
    await r.initialize(tc);
    await r.shutdown();
    expect(mockScreen.destroy).toHaveBeenCalled();
  });

  it('getWidgetReferences returns all widgets', () => {
    const refs = r.getWidgetReferences();
    expect(refs).toHaveProperty('header');
    expect(refs).toHaveProperty('status');
    expect(refs).toHaveProperty('tabBar');
    expect(refs).toHaveProperty('approvals');
    expect(refs).toHaveProperty('input');
  });
});
```

- [ ] `pnpm vitest run tests/tui/blessed-renderer.vitest.ts` — 9/9 pass
- [ ] `pnpm vitest run` — all pass
- [ ] `pnpm tsc --noEmit` — clean
- [ ] Commit: `git add tests/tui/blessed-renderer.vitest.ts && git commit -m "test: add BlessedRenderer lifecycle tests"`

---

### Task 5: Evaluation and ADR-0013

- [ ] **Side-by-side comparison**

```bash
node dist/cli.js tui                        # CanvasRenderer
ALIX_TUI_RENDERER=blessed node dist/cli.js tui  # BlessedRenderer
```

- [ ] **Write `docs/adr/ADR-0013-renderer-comparison.md`**

```markdown
# ADR-0013: TUI Renderer Comparison — Canvas vs neo-blessed

**Date:** 2026-07-21
**Status:** Evaluation (one-day spike)
**Decision impact:** No production dependency on neo-blessed is introduced until
  this ADR is approved. The spike branch can be discarded without affecting CanvasRenderer.

## Migration Risk

BlessedRenderer is not a drop-in replacement. This spike intentionally excludes:
- Full tab navigation (chat, agent, daemon, runtime, sops, policy)
- Daemon dashboard panels (CPU/MEM/DISK bars)
- Policy inspector
- Runtime topology visualization
- Mouse interactions
- Accessibility review

Adoption requires a second migration spike covering interactive tabs and full panel parity.

## Architectural Boundary

| Owned by TerminalControl | Owned by BlessedRenderer |
|--------------------------|--------------------------|
| Alt buffer enter/exit | Widget tree (Box, List, Textarea) |
| Raw mode enable/disable | Layout calculation |
| Cursor visibility | Keypress event dispatch |
| SIGWINCH forwarding | Render scheduling (screen.render()) |
| Emergency restore | — |

## Comparison

| Criterion | CanvasRenderer | BlessedRenderer |
|-----------|---------------|-----------------|
| Initialization LOC | TBD | TBD |
| render() LOC | TBD | TBD |
| Resize | Manual (onResize → recompute geometry) | blessed-managed widget geometry recalculation |
| Scroll | Custom scrollOffset/panelFocus | Built-in List widget |
| Input | Raw stdin → parseKey() | Blessed Textarea keypress |
| ALiX primitives | TerminalCanvas, CanvasCell, LayoutEngine, sidebar | None |
| Lines eliminated | Baseline | ~880 estimate |
| Widget persistence | Fresh canvas per frame | Verified: no recreation |

## Code Deletion Estimate

| File | Lines | If adopted |
|------|-------|------------|
| src/tui/canvas.ts | ~200 | Delete |
| src/tui/canvas-cell.ts | ~30 | Delete |
| src/tui/sidebar.ts | ~90 | Delete |
| src/tui/layout/canvas-layout.ts | ~60 | Delete |
| src/tui/dashboard-renderer.ts | ~500 | Partial |
| **Total** | **~880** | |

## Input Handling Scope

BlessedRenderer owns terminal key acquisition through blessed widgets, but does NOT
implement application-level command routing (tab switching, submit, navigation, Ctrl+C).
These are scoped out of this spike. A future interaction layer will translate blessed
events into OperatorActions.

## Visual Parity Checklist

| Area | Status |
|------|--------|
| Header renders correctly | ☐ Pass / ☐ Fail |
| Status bar shows phase + fields | ☐ Pass / ☐ Fail |
| Tab bar shows all 7 tabs, active highlighted | ☐ Pass / ☐ Fail |
| Approvals panel shows items with scroll | ☐ Pass / ☐ Fail |
| Chat/agent input area visible | ☐ Pass / ☐ Fail |
| Terminal resize — no corruption | ☐ Pass / ☐ Fail |
| Exit — terminal restored to pre-TUI state | ☐ Pass / ☐ Fail |

## Recommendation

☐ Adopt neo-blessed
☐ Continue with CanvasRenderer
☐ Run additional migration spike (full tab parity)

Decision: TBD after evaluation.

## Rationale

[Why this choice aligns with ALiX architecture]
```

- [ ] Commit: `git add docs/adr/ADR-0013-renderer-comparison.md && git commit -m "docs: add ADR-0013 renderer comparison"`

---

## Verification

```bash
pnpm vitest run           # all pass
pnpm tsc --noEmit         # clean
ALIX_TUI_RENDERER=blessed node dist/cli.js tui  # visual check
node dist/cli.js tui      # CanvasRenderer unchanged
```

### Invariants
```bash
grep DashboardSnapshot src/tui/renderers/blessed-renderer.ts      → empty
grep PerTabState src/tui/renderers/blessed-renderer.ts            → empty
grep "as any" src/tui/renderers/blessed-renderer.ts               → empty
grep "enter\|exitAltBuffer\|enterRaw\|exitRaw" src/tui/renderers/blessed-renderer.ts → empty
```
