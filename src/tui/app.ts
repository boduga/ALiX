import type { TabId, TuiAppState } from './state.js';
import { createInitialTuiAppState } from './state.js';
import type { DashboardSnapshot } from './snapshot.js';
import type { ViewAction, ViewRenderContext, ViewInputContext, TuiView, TerminalDimensions } from './views/types.js';
import { getView } from './views/index.js';
import { TuiRenderer, type Region } from './render.js';
import type { SnapshotBuilder } from './snapshot-builder.js';
import type { DaemonMetricsCollector } from './daemon-metrics-collector.js';
import { Navigation } from './navigation.js';
import { createTerminalControl, type TerminalControl } from './terminal-control.js';
import { TerminalCanvas } from './canvas.js';

export interface TuiAppOptions {
  builder: SnapshotBuilder;
  daemonMetrics: DaemonMetricsCollector;
  views?: Readonly<Record<TabId, TuiView>>;
}

const TAB_ORDER: readonly TabId[] = ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];

export class TuiApp {
  private state: TuiAppState = createInitialTuiAppState();
  private readonly renderer: TuiRenderer;
  private readonly terminal: TerminalControl;
  private readonly navigation = new Navigation();
  private snapshotTimer?: NodeJS.Timeout;
  private detached = false;
  private readonly defaultViews: Readonly<Record<TabId, TuiView>>;

  constructor(private readonly opts: TuiAppOptions) {
    this.defaultViews = {
      chat: getView('chat')!,
      daemon: getView('daemon')!,
      approvals: getView('approvals')!,
      runtime: getView('runtime')!,
      sops: getView('sops')!,
      policy: getView('policy')!,
    };
    this.terminal = createTerminalControl();
    this.renderer = new TuiRenderer({
      paint: (region) => this.paintRegion(region, this.views),
      scheduleRepaint: () => {},
    });
  }

  private get views(): Readonly<Record<TabId, TuiView>> {
    return this.opts.views ?? this.defaultViews;
  }

  async start(): Promise<void> {
    this.terminal.enterAltBuffer();
    this.terminal.enterRawMode();
    this.terminal.showCursor(true);
    this.terminal.onResize(() => this.renderer.scheduleRepaint('all'));

    this.opts.daemonMetrics.start();

    const initialGen = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(initialGen);
    if (snap && initialGen === this.state.refreshGeneration) {
      this.state.lastSnapshot = snap;
    }
    this.renderer.scheduleRepaint('all');

    this.terminal.installEmergencyCleanup(() => this.cleanupSync());
    process.stdin.on('data', (buf) => { if (Buffer.isBuffer(buf)) this.handleRaw(buf); });
    this.snapshotTimer = setInterval(() => void this.refresh(), 1_000);
    this.renderer.pump();
  }

  async stop(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    await this.opts.daemonMetrics.stop();
    await this.cleanupSync();
  }

  /** Test seam: expose internal state for assertions. */
  getStateForTest(): TuiAppState { return this.state; }

  private async refresh(): Promise<void> {
    const generation = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(generation);
    if (!snap || generation !== this.state.refreshGeneration) return;
    this.state.lastSnapshot = snap;
    this.renderer.scheduleRepaint('all');
    this.renderer.pump();
  }

  private handleRaw(buf: Buffer): void {
    const key = parseKey(buf);
    if (!key) return;
    if (this.tryHandleGlobal(key)) return;
    if (!this.state.lastSnapshot) return;
    const tab = this.state.activeTab;

    // ── Chat-tab input capture ─────────────────────────────────────
    if (tab === 'chat') {
      const perTab = this.state.views.chat;
      if (key === '\r' || key === '\n') {
        if (perTab.inputBuffer.trim().length > 0) {
          // Submit the typed query — for now, echo the submission; the
          // AgentSession integration lives in a follow-up.
          void this.submitChatInput(perTab.inputBuffer);
          perTab.inputBuffer = '';
        }
        this.renderer.scheduleRepaint('body');
        this.renderer.pump();
        return;
      }
      if (key === '' || key === '\b') {
        perTab.inputBuffer = perTab.inputBuffer.slice(0, -1);
        this.renderer.scheduleRepaint('body');
        this.renderer.pump();
        return;
      }
      // Printable characters only (ASCII 32+).
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        perTab.inputBuffer += key;
        this.renderer.scheduleRepaint('body');
        this.renderer.pump();
        return;
      }
      // Fall through to view.handleKey for any unhandled control keys.
    }

    const view = this.views[tab]!;
    const viewCtx: ViewInputContext = {
      snap: this.state.lastSnapshot,
      dimensions: { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 },
      perTab: this.state.views[tab],
    };
    const action = view.handleKey?.(key, viewCtx);
    if (action) this.dispatch(action);
  }

  /** Stub: wire into AgentSession.processTurn in a follow-up. */
  private async submitChatInput(text: string): Promise<void> {
    // Force a snapshot refresh so the session phase transitions.
    if (!this.state.lastSnapshot) return;
    await this.refresh();
  }

  private tryHandleGlobal(key: string): boolean {
    const nav = this.navigation.interpret(key);
    if (nav) {
      switch (nav.type) {
        case 'home': this.switchTab('chat'); return true;
        case 'jump': this.switchTab(nav.tab); return true;
        case 'cycle': {
          const idx = TAB_ORDER.indexOf(this.state.activeTab);
          const nextIdx = (idx + (nav.forward ? 1 : TAB_ORDER.length - 1)) % TAB_ORDER.length;
          this.switchTab(TAB_ORDER[nextIdx]!);
          return true;
        }
      }
    }
    if (key === '' || key === 'q' || key === 'Q') {
      void this.stop().finally(() => process.exit(0));
      return true;
    }
    if (key === 'Ctrl+l' || key === '\f') { this.renderer.scheduleRepaint('all'); this.renderer.pump(); return true; }
    return false;
  }

  private switchTab(next: TabId): void {
    if (next === this.state.activeTab) return;
    const prev = this.state.activeTab;
    this.views[prev]?.onDeactivate?.(this.state.views[prev]);
    this.state.history.push(prev);
    this.state.activeTab = next;
    this.views[next]?.onActivate?.(this.state.views[next]);
    this.renderer.scheduleRepaint('body');
    this.renderer.scheduleRepaint('tabs');
    this.renderer.pump();
  }

  private dispatch(action: ViewAction): void {
    switch (action.type) {
      case 'handled': break;
      case 'moveCursor':
        this.state.views[this.state.activeTab].cursor = action.cursor;
        this.renderer.scheduleRepaint('body');
        this.renderer.pump();
        break;
      case 'switchTab':
        this.switchTab(action.tab);
        break;
      case 'scheduleRefresh':
        void this.refresh();
        break;
    }
  }

  private paintRegion(region: Region, views: Readonly<Record<TabId, TuiView>>): void {
    if (!this.state.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    const c = new TerminalCanvas(dims.columns, dims.rows);
    const session = this.state.lastSnapshot.session;
    const order: readonly TabId[] = ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];

    const renderCtx: ViewRenderContext = {
      snap: this.state.lastSnapshot,
      dimensions: dims,
      perTab: this.state.views[this.state.activeTab],
      canvas: c,
    };

    switch (region) {
      case 'header':
        c.write(2, 0, `\x1b[1malix tui\x1b[0m  v${session?.version ?? '—'}`);
        break;

      case 'body':
        views[this.state.activeTab]!.render(renderCtx);
        break;

      case 'tabs': {
        let tabLine = '';
        for (const id of order) {
          const active = id === this.state.activeTab;
          tabLine += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
        }
        c.write(0, dims.rows - 3, tabLine);
        break;
      }

      case 'status': {
        const mode = session?.mode ?? 'auto';
        const phase = session?.phase ?? 'Idle';
        c.write(0, dims.rows - 2, `mode: ${mode}  phase: \x1b[1m${phase}\x1b[0m`);
        c.write(0, dims.rows - 1, `tokens: —  files: —`);
        break;
      }

      case 'all':
      default: {
        c.write(2, 0, `\x1b[1malix tui\x1b[0m  v${session?.version ?? '—'}`);
        views[this.state.activeTab]!.render(renderCtx);
        let tabLine = '';
        for (const id of order) {
          const active = id === this.state.activeTab;
          tabLine += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
        }
        c.write(0, dims.rows - 3, tabLine);
        const mode = session?.mode ?? 'auto';
        const phase = session?.phase ?? 'Idle';
        c.write(0, dims.rows - 2, `mode: ${mode}  phase: \x1b[1m${phase}\x1b[0m`);
        c.write(0, dims.rows - 1, `tokens: —  files: —`);
        break;
      }
    }

    // Write the frame to the terminal — home cursor first so each tick
    // overwrites the previous frame in-place (no waterfall).
    process.stdout.write('\x1b[H' + c.renderFrame());
  }

  private async cleanupSync(): Promise<void> {
    this.terminal.showCursor(true);
    this.terminal.exitRawMode();
    this.terminal.exitAltBuffer();
  }
}

function parseKey(buf: Buffer): string | null {
  if (buf.length === 0) return null;
  const s = buf.toString('utf8');
  if (s === '\r' || s === '\n') return 'Enter';
  if (s === '\t') return 'Tab';
  if (s === '\x0c') return 'Ctrl+l';
  if (s === '\x7f' || s === '\b') return 'Backspace';
  if (s === '\x1b' && buf.length >= 3 && buf[1] === 0x5b /* [ */) {
    if (buf[2] === 0x41) return 'ArrowUp';
    if (buf[2] === 0x42) return 'ArrowDown';
    if (buf[2] === 0x43) return 'ArrowRight';
    if (buf[2] === 0x44) return 'ArrowLeft';
    if (buf[2] === 0x5a) return 'Shift+Tab';
  }
  if (s.length === 1) return s;
  return null;
}
