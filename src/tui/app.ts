import type { TabId, TuiAppState } from './state.js';
import { createInitialTuiAppState, SessionPhase } from './state.js';
import type { DashboardSnapshot } from './snapshot.js';
import type { ViewAction, ViewRenderContext, ViewInputContext, TuiView, TerminalDimensions } from './views/types.js';
import { getView } from './views/index.js';
import { TuiRenderer } from './render.js';
import type { SnapshotBuilder } from './snapshot-builder.js';
import type { DaemonMetricsCollector } from './daemon-metrics-collector.js';
import type { AgentSession } from '../agent/session.js';
import { Navigation } from './navigation.js';
import { createTerminalControl, type TerminalControl } from './terminal-control.js';
import { TerminalCanvas } from './canvas.js';

export interface TuiAppOptions {
  builder: SnapshotBuilder;
  daemonMetrics: DaemonMetricsCollector;
  /** Agent runtime. Optional — when omitted, submit stays at echo-only. */
  agentSession?: AgentSession;
  views?: Readonly<Record<TabId, TuiView>>;
}

const TAB_ORDER: readonly TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];

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
      agent: getView('agent')!,
      daemon: getView('daemon')!,
      approvals: getView('approvals')!,
      runtime: getView('runtime')!,
      sops: getView('sops')!,
      policy: getView('policy')!,
    };
    this.terminal = createTerminalControl();
    this.renderer = new TuiRenderer();
  }

  private get views(): Readonly<Record<TabId, TuiView>> {
    return this.opts.views ?? this.defaultViews;
  }

  async start(): Promise<void> {
    this.terminal.enterAltBuffer();
    this.terminal.enterRawMode();
    this.terminal.showCursor(true);
    this.terminal.onResize(() => this.paintFullFrame());

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

  /**
   * Block the event loop until `stop()` is called.  Call `start()` first,
   * then `run()` to keep the process alive.  In tests call only `start()`
   * — the render loop is not needed for unit assertions.
   */
  async run(): Promise<void> {
    await this.renderer.runEventLoop();
  }

  async stop(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    await this.opts.daemonMetrics.stop();
    await this.renderer.cleanup();
    await this.cleanupSync();
  }

  /** Test seam: expose internal state for assertions. */
  getStateForTest(): TuiAppState { return this.state; }

  private async refresh(): Promise<void> {
    const generation = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(generation);
    if (!snap || generation !== this.state.refreshGeneration) return;
    this.state.lastSnapshot = snap;
    this.paintFullFrame();
  }

  private handleRaw(buf: Buffer): void {
    const key = parseKey(buf);
    if (!key) return;
    if (this.tryHandleGlobal(key)) return;
    if (!this.state.lastSnapshot) return;
    const tab = this.state.activeTab;

    // ── Chat-tab input capture (lightweight chat path) ────────────
    if (tab === 'chat') {
      const perTab = this.state.views.chat;
      if (key === 'Enter') {
        if (perTab.inputBuffer.trim().length > 0) {
          perTab.submittedPrompts.push(perTab.inputBuffer);
          void this.submitChatInput(perTab.inputBuffer);
          perTab.inputBuffer = '';
        }
        this.paintFullFrame();
        return;
      }
      if (key === 'Backspace') {
        perTab.inputBuffer = perTab.inputBuffer.slice(0, -1);
        this.paintFullFrame();
        return;
      }
      // Printable characters only (ASCII 32+).
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        perTab.inputBuffer += key;
        this.paintFullFrame();
        return;
      }
      // Fall through to view.handleKey for any unhandled control keys.
    }

    // ── Agent-tab input capture (full processTurn path) ────────────
    if (tab === 'agent') {
      const perTab = this.state.views.agent;
      if (key === 'Enter') {
        if (perTab.inputBuffer.trim().length > 0) {
          perTab.submittedPrompts.push(perTab.inputBuffer);
          void this.submitAgentInput(perTab.inputBuffer);
          perTab.inputBuffer = '';
        }
        this.paintFullFrame();
        return;
      }
      if (key === 'Backspace') {
        perTab.inputBuffer = perTab.inputBuffer.slice(0, -1);
        this.paintFullFrame();
        return;
      }
      // Printable characters only (ASCII 32+).
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        perTab.inputBuffer += key;
        this.paintFullFrame();
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

  /**
   * Submit the typed prompt on the chat tab through the lightweight
   * `processChat` path. Falls back to a placeholder when no
   * AgentSession is configured (e.g., in unit tests).
   */
  private async submitChatInput(text: string): Promise<void> {
    await this.dispatchToSession(
      text,
      'chat',
      this.state.views.chat,
      [
        this.opts.agentSession?.processChat?.bind(this.opts.agentSession),
        this.opts.agentSession?.processTurn?.bind(this.opts.agentSession),
      ],
      '[chat]',
      // Chat has a longer budget because the runtime's chatSearchTool
      // (when configured) can take ~2s and the model call follows.
      15_000,
    );
  }

  /**
   * Submit the typed task on the agent tab through the full
   * `processTurn` path (workflow loop, tool-call capable). Falls back
   * to a placeholder when no AgentSession is configured.
   */
  private async submitAgentInput(text: string): Promise<void> {
    // Agent tab goes straight to processTurn — the operator chose the
    // agent tab for agentic workflow, not casual chat. processChat
    // is reserved for the chat tab where lightweight conversation is
    // the expected behaviour. No hidden escalation from chat to
    // agent: the tab IS the execution class choice.
    await this.dispatchToSession(
      text,
      'agent',
      this.state.views.agent,
      [this.opts.agentSession?.processTurn?.bind(this.opts.agentSession)],
      '[agent]',
      60_000,
    );
  }

  /**
   * Shared submit path used by both submitChatInput and submitAgentInput.
   * Tries each candidate in turn — first non-throwing call wins. Wraps the
   * call in a 5s timeout so a hung session (e.g., real
   * `createAgentSession().processChat` blocked on a network provider) can
   * never leave the scrollback empty. Errors are also piped to stderr
   * so silent hangs surface in `node alix tui` logs.
   */
  private async dispatchToSession(
    text: string,
    kind: 'chat' | 'agent',
    perTab: { agentResponses: string[] },
    candidates: Array<((text: string) => Promise<{ summary: string; reason?: string }>) | undefined>,
    fallbackPrefix: string,
    timeoutMs = 5_000,
  ): Promise<void> {
    if (!this.state.lastSnapshot) return;
    let summary: string = `${fallbackPrefix} ${text}`;
    for (const fn of candidates) {
      if (!fn) continue;
      try {
        const result = await this.raceAgentCall(text, fn, timeoutMs);
        // Detect the chat path's "no provider configured" placeholder and
        // continue to the next candidate so the agent tab falls through
        // to its workflow path. Other sentinel responses (empty
        // strings, "[chat error] ...") similarly indicate the chat path
        // couldn't help, so the workflow gets a chance.
        const noHelp = (s: string): boolean => {
          const t = s.trim();
          if (!t) return true;
          if (t.startsWith('[chat:no-provider]')) return true;
          if (t.startsWith('[chat error]')) return true;
          if (t.startsWith('[chat] ')) return false; // real echo
          return false;
        };
        if (noHelp(result.summary)) continue;
        summary = result.summary;
        // Friendly rewrites for known runtime termination reasons so the
        // operator doesn't see the raw internal "Agent reached maximum
        // iteration" string or similar.
        if (result.reason === 'max_iterations') {
          summary = `(${kind} hit the runtime iteration cap. Try a more specific task, or switch to the chat tab for casual queries.)`;
        } else if (result.reason === 'rate-limit' || result.reason === 'rate_limit') {
          summary = `(${kind} was rate-limited by the provider. Wait a moment and retry.)`;
        }
        break;
      } catch (err) {
        // Stderr is independent of the TUI render — even if paintFullFrame
        // fails for some reason, the operator sees the failure here.
        process.stderr.write(`[alix-tui] ${kind} submit error: ${err instanceof Error ? err.message : String(err)}\n`);
        summary = `(agent error: ${err instanceof Error ? err.message : String(err)})`;
        // Try the next candidate rather than giving up.
      }
    }
    perTab.agentResponses.push(summary);
    this.paintFullFrame();
  }

  /**
   * Race an agent call against `timeoutMs`. Returns the call's result on
   * success, throws on either rejection or timeout.
   */
  private raceAgentCall(
    text: string,
    fn: (text: string) => Promise<{ summary: string; reason?: string }>,
    timeoutMs: number,
  ): Promise<{ summary: string; reason?: string }> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`agent call timed out after ${timeoutMs}ms`)), timeoutMs),
    );
    return Promise.race([fn(text), timeout]);
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
      // Terminate immediately. The 'exit' event handler (installed by
      // installEmergencyCleanup in start()) runs cleanupSync synchronously
      // to restore the terminal — no async stop() needed, and avoiding the
      // race between stop() and run() resolving the same _alivePromise.
      process.exit(0);
      return true;
    }
    if (key === 'Ctrl+l' || key === '\f') { this.paintFullFrame(); return true; }
    return false;
  }

  private switchTab(next: TabId): void {
    if (next === this.state.activeTab) return;
    const prev = this.state.activeTab;
    this.views[prev]?.onDeactivate?.(this.state.views[prev]);
    this.state.history.push(prev);
    this.state.activeTab = next;
    this.views[next]?.onActivate?.(this.state.views[next]);
    this.paintFullFrame();
  }

  private dispatch(action: ViewAction): void {
    switch (action.type) {
      case 'handled': break;
      case 'moveCursor':
        this.state.views[this.state.activeTab].cursor = action.cursor;
        this.paintFullFrame();
        break;
      case 'switchTab':
        this.switchTab(action.tab);
        break;
      case 'scheduleRefresh':
        void this.refresh();
        break;
    }
  }

  /** Build a complete frame containing all regions and write it to stdout. */
  private paintFullFrame(): void {
    if (!this.state.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    const c = new TerminalCanvas(dims.columns, dims.rows);
    const snap = this.state.lastSnapshot;
    const session = snap.session;

    const renderCtx: ViewRenderContext = {
      snap: this.state.lastSnapshot,
      dimensions: dims,
      perTab: this.state.views[this.state.activeTab],
      canvas: c,
    };

    // Header — top divider, content row, bottom divider.
    // Row 0: top rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 0, `\x1b[90m─\x1b[0m`);
    // Row 1: left "ALiX TUI - Interactive Session" + right-aligned meta
    c.write(2, 1, `\x1b[32mALiX TUI\x1b[0m\x1b[1m - Interactive Session\x1b[0m`);
    const version = session?.version ?? '—';
    const sessionMode = session?.mode ?? 'auto';
    const rightText = `\x1b[90mAgent OS v${version}  │  Session: ${sessionMode}  │  Mode: ${sessionMode}\x1b[0m`;
    const rightLen = `Agent OS v${version}  │  Session: ${sessionMode}  │  Mode: ${sessionMode}`.length;
    c.write(Math.max(2, dims.columns - rightLen), 1, rightText);
    // Row 2: bottom rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 2, `\x1b[90m─\x1b[0m`);
    // Body (active view writes into the canvas)
    this.views[this.state.activeTab]!.render(renderCtx);
    // Tabs row (with key-hint suffix, right-aligned).
    let tabLine = '';
    for (const id of TAB_ORDER) {
      const active = id === this.state.activeTab;
      tabLine += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
    }
    const tabHintsVisible = '↑/↓ navigate   |   tab next   |   ? help   |   q quit';
    const hintsLen = tabHintsVisible.length;
    // Reserve room so the hints fit on the same line, right-aligned.
    const tabRowBudget = Math.max(0, dims.columns - hintsLen - 1);
    const tabText = tabLine.length <= tabRowBudget
      ? tabLine + ' '.repeat(tabRowBudget - tabLine.length)
      : tabLine.slice(0, tabRowBudget);
    c.write(0, dims.rows - 3, tabText);
    c.write(dims.columns - hintsLen, dims.rows - 3, `\x1b[90m${tabHintsVisible}\x1b[0m`);

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
    c.write(0, dims.rows - 1, statusLine.slice(0, Math.max(0, dims.columns - 2)));

    // Write the complete frame — cursor home + canvas render.
    process.stdout.write('\x1b[H' + c.renderFrame());

    // Place the terminal cursor at the chat input position.
    // Without this the cursor sits at the bottom of the screen but the typed
    // text appears at the top (where ChatView renders the input buffer),
    // creating an invisible-typing experience.
    if (this.state.activeTab === 'chat') {
      const bufLen = this.state.views.chat.inputBuffer.length;
      process.stdout.write(`\x1b[5;${7 + bufLen + 1}H`);
    }
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
  // Ctrl+digit: terminals reliably encode these as ESC + digit (the
  // standard "Alt+digit" sequence doubles as "Ctrl+digit" for tab
  // jumping — see xterm, iTerm2, ghostty, kitty). Parse the escape
  // prefix and surface as 'Ctrl+N' so the navigation layer can match.
  if (s.length === 2 && s[0] === '\x1b' && s[1] >= '0' && s[1] <= '9') {
    return `Ctrl+${s[1]}`;
  }
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
