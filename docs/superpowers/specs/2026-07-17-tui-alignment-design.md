# ALiX TUI Alignment — Final Design

**Date:** 2026-07-17
**Status:** Approved
**Author:** Brainstorming session (Claude + user), 6 design sections iterated to convergence.

---

## 1. Purpose & Background

The current `alix tui` command renders a single-pane readline-based chat interface with limited operational visibility. This design aligns the TUI with the visual target depicted in the user-provided reference image — a multi-pane dashboard with persistent header, body region (per active tab), tab bar, and status bar — while preserving the existing chat workflow as the default landing tab.

The existing `src/tui/` directory already contains substantial infrastructure: panel widgets (`chronicle`, `coordination`, `cost`, `health`, `ifamas`, `dashboard-renderer.ts`, etc.), ANSI primitives (`ansi.ts`, `box.ts`, `cursor.ts`), and the existing `TuiRenderer` / `TuiStore` / `EventLogBridge`. This design wires those primitives into a unified `TuiApp` application class — no from-scratch rebuild — but adds snapshot-driven data flow, tabbed workspaces, and lifecycle phase tracking.

---

## 2. Architecture Overview

### Layering

```
AgentSession              (owns SessionPhase + event stream)
    ↓
SnapshotBuilder          (composes one immutable snapshot per refresh)
    ├── ApprovalManager
    ├── PolicyEngine
    ├── SopRegistry
    ├── EventLog / runtime snapshot
    └── DaemonMetricsCollector
        ↓
DashboardSnapshot        (immutable DTO; all fields readonly; subsystem fields nullable)
        ↓
TuiApp                    (input loop, refresh tick, lifecycle; owns mutable UI state)
    ↓
TuiRenderer               (paint pipeline + framebuffer + region composers)
    ↓
TuiView (× 6, singleton instances)
    ↓
Widgets (passive)
```

### Critical invariants (architectural)

1. **Widgets never fetch state.** `Snapshot → View → Widget`. Never `Widget → Manager → Source`.
2. **`DashboardSnapshot` is immutable and pure data.** All nested DTOs are readonly. Subsystem fields are explicitly nullable (`T | null`).
3. **`SnapshotBuilder` is the only polling boundary.** No view, widget, or renderer polls subsystems directly.
4. **`AgentSession` owns `SessionPhase`.** TUI observes only — never mutates.
5. **`render(ctx)` is a pure function.** Same `ctx` → same `rows`. No I/O, no time, no mutation.
6. **Region boundaries are renderer-owned.** Views never decide where they appear.
7. **TuiRenderer owns the repaint queue.** TuiApp requests; TuiRenderer executes.
8. **TuiApp owns refresh generation.** SnapshotBuilder only validates.

### File layout

```
src/
├── cli/
│   └── commands/
│       └── tui.ts                    ← CLI bootstrap only (~30-50 lines)
│
└── tui/
    ├── app.ts                        ← TuiApp class (single owner of UI lifecycle)
    ├── index.ts                      ← barrel exports
    ├── state.ts                      ← TuiAppState, PerTabState, SessionPhase enum
    ├── snapshot.ts                   ← DashboardSnapshot type + builder structure
    ├── snapshot-builder.ts           ← SnapshotBuilder class
    ├── daemon-metrics-collector.ts   ← NEW: 1s sampler for CPU/MEM/DISK
    ├── render.ts                     ← existing (kept; coordinated by TuiRenderer)
    ├── navigation.ts                 ← tab/keyboard routing
    ├── dashboard-renderer.ts         ← existing (kept; reused for compact panels)
    ├── panel-renderer.ts             ← existing (kept)
    ├── views/
    │   ├── index.ts                  ← view registry
    │   ├── chat-view.ts              ← input + 4-panel compact dashboard
    │   ├── daemon-view.ts            ← full daemon subsystem
    │   ├── approvals-view.ts         ← approval queue + details
    │   ├── runtime-view.ts           ← live event stream + workflow
    │   ├── sops-view.ts              ← SOP explorer
    │   └── policy-view.ts            ← rule browser + violations
    ├── box.ts, ansi.ts, cursor.ts    ← existing primitives (kept; views never reach around these)
    └── widgets/                      ← existing widgets (kept; passive consumers of snapshot)
```

---

## 3. State & Data Flow

### Subsystem requirements

| Panel | Backing subsystem | Phase 1 access |
|---|---|---|
| DAEMON (PID, uptime, version, workspace, CPU/MEM/DISK) | DaemonManager + DaemonMetricsCollector | per-tick |
| DAEMON (recent events) | EventLog | on switch |
| APPROVALS (pending + resolved) | ApprovalManager | per-tick |
| RUNTIME (events, workflow, progress) | EventLog + workflow state | per-tick |
| SOPS (loaded, versions) | SopRegistry | on switch |
| POLICY (rules, violations) | PolicyEngine | per-tick |
| TOKEN bar | SessionStore (existing) | per-tick |
| FILES counter | SessionStore (existing) | per-tick |
| MODE label (auto/ask/bypass) | config.permissions.sessionMode | on switch |
| Phase radio (5 phases + idle) | AgentSession.phase | per-tick |

### `TuiAppState`

```ts
interface TuiAppState {
  lastSnapshot?: DashboardSnapshot;        // most recently composed snapshot (readonly)
  activeTab: TabId;                         // 'chat' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy'
  views: Record<TabId, PerTabState>;       // per-tab persisted UI state
  refreshGeneration: number;                // monotonic; incremented each refresh; cancellation token
  refreshStatus: 'idle' | 'building' | 'rendering';
  history: TabId[];                         // for back-button navigation if desired later
}

interface PerTabState {
  cursor: number;                           // selected item index
  scrollOffset: number;
  searchQuery: string;
  expandedSections: string[];               // serializable (not Set<string>)
  lastEventArrivedAt: number;                // for RuntimeView "live stream" indicator
}
```

### `DashboardSnapshot` (immutable DTO)

```ts
export interface DashboardSnapshot {
  readonly generatedAt: number;
  readonly session: SessionMetadata;             // mode, phase, version, startedAt, turns
  readonly daemon: DaemonMetricsSnapshot | null;  // all subsystems explicitly nullable
  readonly approvals: ApprovalSnapshot | null;
  readonly runtime: RuntimeSnapshot | null;
  readonly sops: SopSnapshot | null;
  readonly policy: PolicySnapshot | null;
}
```

Each subsystem DTO (e.g. `DaemonMetricsSnapshot`) has all fields marked `readonly`. Builders `Object.freeze()` the result.

**Consistency model:** a `DashboardSnapshot` is an *approximately-consistent observation window*, not an atomic system snapshot. Field timestamps may differ by single-digit milliseconds. This is acceptable at the 1-second cadence.

---

## 4. `AgentSession.phase` ownership

```ts
enum SessionPhase {
  Understanding,
  Planning,
  Executing,
  Verifying,
  Summarizing,
  Idle,                                    // all phases empty after response delivered
}
```

**Invariant:** `AgentSession` is the only writer of `phase`. The TUI may observe `snapshot.session.phase` for rendering. The TUI may never mutate it.

Transition rules (engines own these):

| From | Trigger | To |
|---|---|---|
| (any) | User submits request | `Understanding` |
| `Understanding` | First planning event | `Planning` |
| `Planning` | First tool-call event | `Executing` |
| `Executing` | First verification/proof event | `Verifying` |
| `Verifying` | Summary line emitted | `Summarizing` |
| `Summarizing` | Response delivered + no work pending | `Idle` |
| any | idle timeout (60s) | `Idle` |

Transitions emit `agent:phase` events on the `EventLog` that `SnapshotBuilder` projects into `snapshot.session.phase`.

---

## 5. `SnapshotBuilder` + `DaemonMetricsCollector`

### `DaemonMetricsCollector`

```ts
export interface DaemonMetricsSnapshot {
  readonly pid: number | null;
  readonly uptimeSeconds: number;
  readonly cpuPercent: number;
  readonly memoryRssBytes: number;
  readonly memoryTotalBytes: number;
  readonly diskUsedBytes: number;
  readonly diskTotalBytes: number;
  readonly clients: readonly ClientSnapshot[];     // moved from raw daemon-client API (Section 5)
  readonly sampledAt: number;
}

export interface DaemonMetricsCollector {
  start(): void;                                   // schedules 1s tick; non-blocking
  stop(): Promise<void>;
  snapshot(): Promise<DaemonMetricsSnapshot>;      // returns cached value (zero I/O)
  /** Test-only — protected. */
  protected setReaderForTesting(reader: PlatformMetricsReader): void;
}
```

Platform-specific metric collection (Linux: `/proc/[pid]/stat`, `/proc/meminfo`, `fs.statfs`; macOS: `ps`/`sysctl`/`statvfs`; Windows: `Get-*` cmdlets). Direct syscalls only; no shell-out. Platform branch resolved once at construction.

**Daemon disappearance:** cache is updated each tick. If `pid` is gone, the next tick returns `pid: null, cpuPercent: 0, memoryRssBytes: 0` — a valid state, not an exception.

### `SnapshotBuilder`

```ts
export class SnapshotBuilder {
  constructor(
    private readonly session: AgentSession,
    private readonly approvals: ApprovalManager,
    private readonly policy: PolicyEngine,
    private readonly sops: SopRegistry,
    private readonly eventLog: EventLog,
    private readonly daemonMetrics: DaemonMetricsCollector,
  ) {}

  /** Build one immutable snapshot. Returns null if `generation` was invalidated. */
  async build(generation: number): Promise<DashboardSnapshot | null>;

  /** Build using cached subsystems only — no I/O. Used for keypress-driven refreshes. */
  buildSync(generation: number): DashboardSnapshot | null;
}
```

**Implementation contract:** every field is built into a local before `Object.freeze()` is applied. Field assignment is never incremental. Any subsystem throwing sets that field to `null`; the builder never throws upward. Cancellation is the only way `build()` returns `null`.

**Failure isolation** (explicit): a broken subsystem produces `field: null`; the rest of the dashboard still renders.

---

## 6. `TuiView` contract

```ts
export type TabId = 'chat' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy';

export interface ViewRenderContext {
  readonly snapshot: DashboardSnapshot;
  readonly dimensions: TerminalDimensions;
  readonly perTab: Readonly<PerTabState>;
}

export interface ViewInputContext {
  readonly snapshot: DashboardSnapshot;
  readonly dimensions: TerminalDimensions;
  readonly perTab: PerTabState;                       // mutable; handleKey may write here
}

export interface ViewRenderResult {
  readonly rows: string[];                            // lines to paint into the body region
  readonly hint?: string;                             // optional one-liner above the tab bar
}

export type ViewAction =
  | { type: 'handled' }
  | { type: 'moveCursor'; cursor: number }
  | { type: 'scheduleRefresh' }
  | { type: 'switchTab'; tab: TabId };

export interface TuiView {
  readonly id: TabId;

  render(ctx: ViewRenderContext): ViewRenderResult;

  handleKey?(
    key: string,
    ctx: ViewInputContext,
  ): ViewAction;

  onActivate?(perTab: PerTabState): void;             // tab entered
  onDeactivate?(perTab: PerTabState): void;           // tab left
}
```

**Purity invariant:** `render()` is a pure function. `snapshot A, perTab B, dimensions C` always produces identical `rows D`. No mutation, no I/O, no time-based branching. Test pattern:

```ts
const expected = formatRuntime(ctx.snapshot, ctx.perTab);
const actual = view.render(ctx).rows.join('\n');
expect(actual).toBe(expected);
```

### Per-view specifics

| View | Inputs read from `ctx.snapshot` | Per-tab state owned | Special keys |
|---|---|---|---|
| `ChatView` | session, daemon, approvals, runtime, sops, policy (all 5 panels at half-width) | inputBuffer (in TuiApp, not view) | (input handled by TuiApp raw-mode loop) |
| `DaemonView` | daemon | cursor (connected client) | `↑/↓`, `Enter` (attach client) |
| `ApprovalsView` | approvals | cursor, scrollOffset | `↑/↓`, `a` approve, `d` deny, `Enter` view diff |
| `RuntimeView` | runtime | scrollOffset, expandedSections, lastEventArrivedAt | `↑/↓/PgUp/PgDn`, `/` search |
| `SopsView` | sops | cursor, scrollOffset, searchQuery | `↑/↓`, `/` search, `Tab` (toggle detail focus) |
| `PolicyView` | policy | cursor, scrollOffset, searchQuery, expandedSections | `↑/↓`, `/` search |

### View instantiation

Views are **singleton instances** owned by `TuiApp`. Never recreated on tab switch — local state must survive across switches.

---

## 7. Rendering Pipeline

### Region model

```
┌─────────────────────────────────────────────────┐
│  Header                          (2 rows, fixed)│
├─────────────────────────────────────────────────┤
│                                                 │
│  Body (= active view)         (rest − 3 rows)   │
│                                                 │
├─────────────────────────────────────────────────┤
│  Tab Bar                          (1 row, fixed) │
├─────────────────────────────────────────────────┤
│  Status Bar                       (2 rows, fixed) │
└─────────────────────────────────────────────────┘
```

```ts
type Region = 'header' | 'body' | 'tabs' | 'status' | 'all';
```

Each region has its own composer; `TuiRenderer` orchestrates.

### `TuiApp` lifecycle (pseudocode)

```ts
class TuiApp {
  private state: TuiAppState;
  private views: Map<TabId, TuiView>;
  private builder: SnapshotBuilder;
  private renderer: TuiRenderer;
  private metrics: DaemonMetricsCollector;
  private snapshotTimer?: NodeJS.Timeout;

  async start(): Promise<void> {
    this.metrics.start();              // non-blocking; sample loop runs in background
    await this.refresh();              // initial paint (subsystems may not have first sample yet — show 'collecting...')
    this.snapshotTimer = setInterval(() => void this.refresh().catch(noop), 1_000);
    process.stdin.on('data', this.handleRawInput.bind(this));
    process.stdout.on('resize', this.handleResize.bind(this));
    for (const sig of ['exit', 'SIGINT', 'SIGTERM'] as const) process.on(sig, this.emergencyCleanup);
    this.renderer.runEventLoop();
  }

  async stop(): Promise<void> {
    clearInterval(this.snapshotTimer);
    await this.metrics.stop();
    process.stdin.off('data', this.handleRawInput);
    process.stdout.off('resize', this.handleResize);
    await this.renderer.cleanup();
  }

  private async refresh(): Promise<void> {
    this.state.refreshStatus = 'building';
    const generation = ++this.state.refreshGeneration;
    const snapshot = await this.builder.build(generation);
    if (!snapshot || generation !== this.state.refreshGeneration) return;
    this.state.lastSnapshot = Object.freeze(snapshot);
    this.state.refreshStatus = 'rendering';
    this.renderer.scheduleRepaint('all');
    this.renderer.pump();
    this.state.refreshStatus = 'idle';
  }

  private handleRawInput(buf: Buffer): void {
    if (!this.state.lastSnapshot) return;
    const key = parseKey(buf);              // converts raw bytes to key + any text
    if (key.type === 'text') this.appendToInputBuffer(key.text);
    else if (key.type === 'enter') this.submitInputBuffer();
    else {
      const view = this.views.get(this.state.activeTab)!;
      const action = view.handleKey?.(key.label, this.inputCtx());
      if (action) this.dispatchAction(action);
    }
    this.renderer.pump();
  }

  private dispatchAction(action: ViewAction): void {
    switch (action.type) {
      case 'handled': break;
      case 'moveCursor':
        this.state.perTab[this.state.activeTab].cursor = action.cursor;
        this.renderer.scheduleRepaint('body');
        break;
      case 'switchTab':
        this.switchTab(action.tab);
        break;
      case 'scheduleRefresh':
        void this.refresh().catch(noop);
        break;
    }
    this.renderer.pump();
  }

  private switchTab(next: TabId): void {
    const prev = this.state.activeTab;
    this.views.get(prev)?.onDeactivate?.(this.state.perTab[prev]);
    this.state.activeTab = next;
    this.views.get(next)?.onActivate?.(this.state.perTab[next]);
    this.renderer.scheduleRepaint('body', 'tabs');
    this.renderer.pump();
  }

  private handleResize(): void {
    this.renderer.scheduleRepaint('all');
    this.renderer.pump();
  }

  private emergencyCleanup(): void {
    void this.stop().finally(() => process.exit(130));
  }
}
```

### `TuiRenderer` (region painter)

```ts
export class TuiRenderer {
  private framebuffer = new FrameBuffer();
  private repaintAreas = new Set<Region>();          // exclusive owner

  constructor(private readonly opts: {
    paint: (snapshot, view, ctx) => void;
    scheduleRepaint: (area: Region) => void;
  }) {}

  /** Mark a region as dirty. Called by TuiApp. */
  scheduleRepaint(area: Region): void { this.repaintAreas.add(area); }

  /** Drain the queue. Called after every state change. */
  pump(): void {
    if (this.repaintAreas.size === 0) return;
    if (this.repaintAreas.has('all')) this.fullRepaint();
    else { for (const r of this.repaintAreas) this.repaintRegion(r); }
    this.repaintAreas.clear();
  }

  private fullRepaint(): void { /* repaint header, body, tabs, status, commit */ }
  private repaintRegion(r: Region): void { /* targeted repaint */ }

  /** Process event loop. Blocks until app calls cleanup(). */
  async runEventLoop(): Promise<void> { /* centralizes stdin handling */ }
  async cleanup(): Promise<void> { /* restore terminal */ }
}
```

### Repaint pump invariants

1. `scheduleRepaint` and `pump` are the only entry points for output.
2. Resize always triggers `'all'` repaint.
3. Tab switch repaints `'body'` and `'tabs'` only (header/status unchanged).
4. Keypress-driven `moveCursor` repaints `'body'` only.
5. Frame-buffer difference (`nextFrame !== previousFrame`) gates writes for flicker prevention.

### Terminal control

| Event | Action |
|---|---|
| TUI enter | `\x1b[?1049h` (alt buffer), `\x1b[?25l` (hide cursor), raw mode enable |
| TUI exit (normal) | reverse of above |
| TUI exit (crash) | `process.on('exit'/'SIGINT'/'SIGTERM')` → emergency cleanup → `process.exit(130)` |
| SIGWINCH | re-read `process.stdout.{columns,rows}`; scheduleRepaint('all') |
| Ctrl+C (key press in chat) | submit current buffer as interrupt-signal then continue |

### Repaint cadence

| Trigger | Cadence | Action |
|---|---|---|
| 1-second tick | always | async refresh → repaint 'all' if data changed |
| Keypress | per keypress | targeted repaint based on action |
| Resize | on SIGWINCH | repaint 'all' |
| Tab switch | on action | repaint 'body' + 'tabs' |
| Chat input typing | per char | repaint prompt line only (no snapshot refresh) |
| Chat submit | per Enter | `view-action: scheduleRefresh` |

---

## 8. Keyboard & Navigation

### Global keymap (handled by TuiApp, before view dispatch)

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Cycle tabs (forward / backward) |
| `1`–`6` | Jump to specific tab |
| `c` / `d` / `a` / `r` / `s` / `p` | Jump to chat/daemon/approvals/runtime/sops/policy |
| `Esc` | Return to `chat` tab |
| `?` | Show help overlay (full-screen TuiView) |
| `q` | Quit (with confirmation prompt) |
| `Ctrl+C` | Emergency quit → `process.exit(130)` after cleanup |
| `Ctrl+L` | Force full repaint |

### Chat-input keys

| Key | Action |
|---|---|
| printable char | Append to input buffer; repaint prompt line |
| `Backspace` | Delete last char; repaint prompt line |
| `Enter` | Submit buffer to `AgentSession.processTurn` |
| `↑` (history) | Pop previous turn from session-store (if available) |
| `Esc` (in chat input) | Clear buffer |
| `Tab` | Insert tab character (don't cycle tabs) — only at start of empty buffer |

---

## 9. Per-tab State Preservation

Per-tab UI state (`PerTabState`) is preserved across tab switches via `TuiAppState.views[TabId]`. When `switchTab(next)` runs:

1. `view.onDeactivate(prev, perTab)` is called (view may flush any transient UI state).
2. `activeTab` is updated.
3. `view.onActivate(next, perTab)` is called.
4. `'body'` + `'tabs'` regions are marked dirty.

**Invariants:**

- Views never store state internally for cross-switch preservation; all preserved state lives in `PerTabState`.
- All `PerTabState` fields are serializable (`string[]`, `number`, `string`) to enable future persistence.

### Test

```ts
// Tab-state preservation integration test
it('preserves runtime scroll across tab switches', () => {
  const app = new TuiApp({ /* fakes */ });
  app.start();
  app.state.views.runtime.scrollOffset = 200;
  app.dispatchAction({ type: 'switchTab', tab: 'daemon' });
  app.dispatchAction({ type: 'switchTab', tab: 'runtime' });
  expect(app.state.views.runtime.scrollOffset).toBe(200);
});
```

---

## 10. CLI Bootstrap Refactor

`src/cli/commands/tui.ts` becomes a thin dispatcher:

```ts
import { TuiApp } from '../../tui/app.js';
import { DaemonManager } from '../../daemon/daemon-manager.js';
import { ApprovalManager } from '../../tui/approval-manager.js';
import { SopRegistry } from '../../sop/sop-registry.js';
import { PolicyEngine } from '../../policy/policy-engine.js';
import { EventLog } from '../../events/event-log.js';

export async function runTui(opts: TuiOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const { resolveContextLimit } = await import('../../config/context-limits.js');
  const config = await loadConfig(cwd);
  const contextInfo = await resolveContextLimit(/* ... */);

  const session = await createAgentSession(/* ... */);
  const eventLog = new EventLog(/* sessionDir */); await eventLog.init();
  const approvals = new ApprovalManager(/* ... */);
  const sops = SopRegistry.list();          // existing singleton access
  const policy = new PolicyEngine(config);
  const daemon = await DaemonManager.ensure(/* ... */);

  const app = new TuiApp({
    session, approvals, sops, policy, eventLog, daemon,
    mode: config.permissions?.sessionMode ?? 'bypass',
    maxTokens: contextInfo.maxTokens,
  });

  await app.start();
}
```

Approximate line count: **30–50 lines** (parsing, dependency wiring, lifecycle ownership only).

---

## 11. Testing Strategy

| Layer | Test type | What is asserted |
|---|---|---|
| `View.render` | unit | Same `(snapshot, perTab, dimensions)` → same `rows` (purity invariant) |
| `View.handleKey` | unit | Returns `ViewAction`; never mutates `snapshot` |
| `SnapshotBuilder.build` (gen) | unit | Generation mismatch → null |
| `SnapshotBuilder` (failure isolation) | unit | One subsystem throws → only that field is null; others still populated |
| `DaemonMetricsCollector` | unit | PID exists then dies → next sample has `pid: null` |
| `TuiApp` lifecycle | integration | start/stop restores terminal mode; alt-buffer exits |
| `TuiRenderer` region painter | integration | Terminal mock records correct escape sequence per region |
| Frame-buffer diff | unit | Identical ctx → zero writes |
| **Tab-state preservation** | integration | scroll preserved across switches (Section 6 test addition) |
| Manual smoke (`test:manual:tui`) | e2e | Real PTY, full visual loop |

The `render()` purity test is the highest-value assertion in the design — it pins the contract that views are deterministic.

---

## 12. Cleanup Scope

In a dedicated final task (after the new architecture is proven via the parity integration test):

1. Remove legacy rendering paths from `src/cli/commands/tui.ts` (the if-only replays data path, the inline chat loops, the inline approval handling).
2. Delete dead code:
   - The `ChatDashboard` widget if it duplicates `dashboard-renderer.ts`.
   - The `state-theater.ts` widget if it's still inline-referencing the legacy TUI.
   - Any sub-30-line files in `src/tui/widgets/` whose sole purpose was to support the legacy chat-only view.
3. Final pass: simplify imports; ensure no view imports low-level ANSI primitives directly (must go through `box.ts` / `ansi.ts` / `cursor.ts` / `render.ts`).
4. Run `pnpm typecheck && pnpm test:vitest && pnpm test:node` and confirm clean.

**Order matters:** introduction → wiring → verification → cleanup. Never delete code before the replacement is proven.

---

## 13. Invariants & Constraints (consolidated)

| Invariant | Enforced by |
|---|---|
| `DashboardSnapshot` is immutable | `Object.freeze` in `SnapshotBuilder`; all fields `readonly` |
| `DashboardSnapshot` subsystem fields are nullable | Type system (`T \| null`) |
| Snapshot consistency is approximate | Documented; accepted at 1s cadence |
| Widgets never fetch state | Lint rule (forbid imports of `ApprovalManager`/etc. from `widgets/`) |
| `render()` is pure | Type system (`RenderContext` has `Readonly<PerTabState>`) |
| `AgentSession` owns `SessionPhase` | TUI imports are read-only |
| `SnapshotBuilder` is the only polling boundary | Lint rule; review checklist |
| Views are singletons | TuiApp constructs each `new XxxView()` exactly once |
| `TuiRenderer` owns repaint queue | Single writer |
| `TuiApp` owns refresh generation | `state.refreshGeneration` is the only source |
| Resize forces full repaint | `handleResize` always schedules `'all'` |
| Tab switch preserves per-tab state | `PerTabState` keyed by `TabId`; `onActivate`/`onDeactivate` |
| Snapshot failure is not fatal | Builder catches; sets field to `null` |
| Terminal cleanup is emergency-cleanup-rigged | `process.on('exit'|'SIGINT'|'SIGTERM')` |

### Constraints (do not violate without amending the design)

1. **No new dependencies.** Use existing `node:readline` raw mode + existing ANSI primitives.
2. **No view imports `ApprovalManager`, `PolicyEngine`, etc. directly.** All subsystem data enters views through `DashboardSnapshot`.
3. **No widget polls subsystems.** Pass-through from snapshot.
4. **No raw ANSI escapes outside `ansi.ts` / `cursor.ts` / `render.ts`.** Views compose higher-level helpers.
5. **`TuiApp` is the only owner of mutable UI state.** Subsystems remain immutable from TUI's perspective.

---

## 14. Out of Scope (explicit)

- Mouse support (terminal mouse tracking not enabled in this iteration).
- Plugin/extension API for new panels.
- Persistence of `PerTabState` across `alix tui` invocations (current iteration: per-session only).
- Splittable / resizable panels.
- Command palette (slash-command history beyond what already exists).
- Cross-tab operation queueing.
- Telemetry export (cost / token counts beyond what's already shown).
- Configurable keymap.
- Themeable color schemes.

These can become future specs once the core architecture is proven via this design.

---

## 15. Success Criteria

The design is complete when:

1. `alix tui` opens in raw mode with the multi-pane layout (header / body / tabs / status).
2. Tab keys cycle through 6 tabs; `[1-6]` jump; `[cdarsp]` jump-to-named.
3. Switching to `daemon` shows the full daemon subsystem; `approvals` shows the queue; `runtime` shows live events; `sops`/`policy` show their respective browsable lists.
4. Mode radio (UNDERSTANDING/PLANNING/EXECUTING/VERIFYING/SUMMARIZING) updates as `AgentSession.phase` changes — verified by integration test.
5. CPU/MEM/DISK bars refresh every 1 second; PID bars show current usage.
6. Daemon disappearance is visible (PID bar to "○ not running") without TUI exit.
7. `Ctrl+C` exits cleanly with terminal restoration.
8. Unit tests for purity (`render()`), failure isolation, generation cancellation, tab-state preservation all pass.
9. `pnpm typecheck && pnpm test:vitest && pnpm test:node && pnpm test:manual:tui` clean.
10. Legacy code paths are removed per Section 12 in a separate final commit.

---

**End of design.** Ready for implementation planning (`superpowers:writing-plans`).
