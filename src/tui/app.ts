import type { PanelFocusId, PanelScrollOffsets, TabId, TuiAppState } from './state.js';
import { createInitialTuiAppState, SessionPhase } from './state.js';
import type { ViewAction, ViewInputContext, TuiView } from './views/types.js';
import { getView } from './views/index.js';
import type { SnapshotBuilder } from './snapshot-builder.js';
import type { DaemonMetricsCollector } from './daemon-metrics-collector.js';
import type { AgentSession } from '../agent/session.js';
import { Navigation } from './navigation.js';
import { createTerminalControl, type TerminalControl } from './terminal-control.js';
import type { OperatorRenderer } from './renderer/types.js';
import { CanvasRenderer } from './renderers/canvas-renderer.js';
import type { PreRenderCapable } from './renderers/canvas-renderer.js';
import { ViewModelBuilder } from './presentation/builder.js';
import { renderLegacyView } from './legacy/legacy-view-bridge.js';

export interface TuiAppOptions {
  builder: SnapshotBuilder;
  daemonMetrics: DaemonMetricsCollector;
  /** Agent runtime. Optional — when omitted, submit stays at echo-only. */
  agentSession?: AgentSession;
  /**
   * Optional approval manager — when provided, the APPROVALS tab's
   * `a`/`d` keys resolve approvals through the manager rather than
   * triggering a bare refresh.
   */
  approvalManager?: import('./approval-manager.js').ApprovalManager;
  views?: Readonly<Record<TabId, TuiView>>;
  /**
   * Optional renderer implementation. Defaults to `new CanvasRenderer()`.
   * Pass a `NoopRenderer` (or any other `OperatorRenderer`) in tests or
   * alternate environments to bypass real terminal writes.
   */
  renderer?: OperatorRenderer;
}

const TAB_ORDER: readonly TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];

/**
 * Mirror of the legacy `DEFAULT_PANEL_H` constant from
 * `dashboard-renderer.ts`. We intentionally do NOT import that module
 * (the strangler goal of this task), so we hardcode the value here.
 * Kept in sync with `CanvasLayoutEngine.DEFAULT_PANEL_H` (= 14) so the
 * scroll-clamp math in `scrollFocusedPanel` matches the per-panel height
 * the renderer actually paints.
 */
const LEGACY_DEFAULT_PANEL_H = 14;

export class TuiApp {
  private state: TuiAppState = createInitialTuiAppState();
  private readonly renderer: OperatorRenderer;
  private readonly viewModelBuilder = new ViewModelBuilder();
  private readonly terminal: TerminalControl;
  private readonly navigation = new Navigation();
  private snapshotTimer?: NodeJS.Timeout;
  private detached = false;
  private readonly defaultViews: Readonly<Record<TabId, TuiView>>;
  private _aliveResolve!: () => void;
  private readonly _alivePromise = new Promise<void>((resolve) => {
    this._aliveResolve = resolve;
  });

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
    this.renderer = opts.renderer ?? new CanvasRenderer();
  }

  private get views(): Readonly<Record<TabId, TuiView>> {
    return this.opts.views ?? this.defaultViews;
  }

  async start(): Promise<void> {
    this.terminal.enterAltBuffer();
    this.terminal.enterRawMode();
    this.terminal.showCursor(true);

    // Route resize through the renderer so its internal geometry stays
    // in sync with the terminal before the next paint.
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

  /**
   * Block the event loop until `stop()` is called.  Call `start()` first,
   * then `run()` to keep the process alive.  In tests call only `start()`
   * — the render loop is not needed for unit assertions.
   */
  async run(): Promise<void> {
    return this._alivePromise;
  }

  async stop(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    await this.opts.daemonMetrics.stop();
    await this.renderer.shutdown();
    // Release the run() promise so any awaiting caller unblocks.
    this._aliveResolve();
    await this.cleanupSync();
  }

  /** Test seam: expose internal state for assertions. */
  getStateForTest(): TuiAppState { return this.state; }

  private async refresh(): Promise<void> {
    const generation = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(generation);
    if (!snap || generation !== this.state.refreshGeneration) return;
    this.state.lastSnapshot = snap;
    this.syncPendingApprovals();
    this.paintFullFrame();
  }

  /**
   * Mirror `snap.approvals.pending` into each tab's `pendingApprovals` list
   * so the agent tab can render inline cards and the approvals tab can
   * detect newly-resolved entries to push into `resolvedApprovals`.
   */
  private syncPendingApprovals(): void {
    const snap = this.state.lastSnapshot;
    if (!snap) return;
    const pending = snap.approvals?.pending ?? [];
    const pendingIds = new Set(pending.map((p) => p.id));
    const tabs: TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
    for (const t of tabs) {
      const perTab = this.state.views[t];
      if (!perTab) continue;
      // Detect approvals that have disappeared from the pending list since
      // the last snapshot. These are "resolved" (approved/denied/expired)
      // by the approval store; move them to the historical log with their
      // current tool/target so the approvals tab can show the full history.
      const stillPending = perTab.pendingApprovals.filter((a) => pendingIds.has(a.id));
      const missing = perTab.pendingApprovals.filter((a) => !pendingIds.has(a.id));
      if (missing.length > 0) {
        // We don't know the resolved status from the snapshot alone — the
        // approval store would, but for the log view we mark them as
        // resolved (the precise status would require an extra round-trip).
        // The operator can run `/approvals --all` for full details.
        for (const a of missing) {
          perTab.resolvedApprovals.unshift({
            id: a.id,
            toolName: a.toolName,
            target: a.target,
            status: 'approved', // optimistic; precise status from store on demand
            requestedAt: a.requestedAt,
            resolvedAt: Date.now(),
          });
          // Cap the log at 200 entries to avoid unbounded growth.
          if (perTab.resolvedApprovals.length > 200) {
            perTab.resolvedApprovals.length = 200;
          }
        }
      }
      // Update pendingApprovals to match the snapshot exactly.
      perTab.pendingApprovals = pending.map((p) => ({
        id: p.id,
        toolName: p.toolName,
        // Reuse the targetPath that extractTarget populated.
        target: p.targetPath,
        requestedAt: p.requestedAt,
      }));
      // Keep 'stillPending' reference so the linter doesn't complain — it
      // documents the intent of the filter above.
      void stillPending;
    }
  }

  private handleRaw(buf: Buffer): void {
    const key = parseKey(buf);
    if (!key) return;
    if (this.tryHandleGlobal(key)) return;
    if (!this.state.lastSnapshot) return;
    const tab = this.state.activeTab;

    // ── Sidebar panel scrolling (J / K on approvals / sops tabs) ────
    // Caught here *before* the chat/agent input capture so that on the
    // dedicated-panel tabs, these keys scroll the overflow instead of
    // landing in a printable input buffer. Other tabs return false and
    // the keys fall through (treated as text).
    if (key === 'j' || key === 'k') {
      if (this.scrollFocusedPanel(key === 'j' ? 1 : -1)) {
        this.paintFullFrame();
        return;
      }
    }

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
      // Inline approval resolution — when there are pending approvals and
      // the user presses `a`/`d`, resolve the OLDEST pending one and
      // surface the result inline. This avoids the "I have to switch to
      // the approvals tab just to press one key" friction. The interceptor
      // is keyed on the agent tab ONLY — the approvals tab has its own
      // view.handleKey that processes `a`/`d` via the dedicated handler.
      if ((key === 'a' || key === 'd') && perTab.pendingApprovals.length > 0) {
        const target = perTab.pendingApprovals[0]!;
        // Mark the approval as resolved in our local UI state immediately
        // so the inline card disappears. The ApprovalManager call still
        // persists the decision; if it fails we restore the entry.
        perTab.pendingApprovals.shift();
        const status = key === 'a' ? 'approved' : 'denied';
        perTab.resolvedApprovals.unshift({
          id: target.id,
          toolName: target.toolName,
          target: target.target,
          status,
          requestedAt: target.requestedAt,
          resolvedAt: Date.now(),
        });
        if (perTab.resolvedApprovals.length > 200) perTab.resolvedApprovals.length = 200;
        void this.resolveApprovalFromView(target.id, status);
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
      120_000,
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
    perTab: { agentResponses: string[]; scrollOffset: number; planContent?: string },
    candidates: Array<((text: string) => Promise<{ summary: string; reason?: string; planContent?: string }>) | undefined>,
    fallbackPrefix: string,
    timeoutMs = 5_000,
  ): Promise<void> {
    if (!this.state.lastSnapshot) return;
    let summary: string = `${fallbackPrefix} ${text}`;
    // Clear stale plan content before starting a new turn
    perTab.planContent = undefined;
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
        // Capture plan content from the session turn result
        if (result.planContent) {
          perTab.planContent = result.planContent;
        }
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
    perTab.scrollOffset = 0; // auto-scroll to bottom on new response
    this.paintFullFrame();
  }

  /**
   * Race an agent call against `timeoutMs`. Returns the call's result on
   * success, throws on either rejection or timeout.
   */
  private raceAgentCall(
    text: string,
    fn: (text: string) => Promise<{ summary: string; reason?: string; planContent?: string }>,
    timeoutMs: number,
  ): Promise<{ summary: string; reason?: string; planContent?: string }> {
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
    if (key === '\x03' || key === 'q' || key === 'Q') {
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
    // Bind the sidebar's scroll focus to the active tab — approvals and sops
    // own their respective overflow-capable panel; other tabs leave it null
    // so `J`/`K` keys pass through to the chat/agent input buffer.
    this.state.views[next].panelFocus =
      next === 'approvals' || next === 'sops' ? next : null;
    this.views[next]?.onActivate?.(this.state.views[next]);
    this.paintFullFrame();
  }

  /**
   * Adjust the sidebar panel scroll offset for the active tab's focused
   * panel by `direction` (+1 = `J`/down, -1 = `K`/up). Returns true if
   * the offset actually changed and the caller should repaint; false
   * signals "no scroll available for this tab" so keys fall through to
   * the input handler.
   *
   * Mirrors the per-panel max-items math the renderer uses so the clamp
   * matches what the painter can actually render — keeping the ↑ N above /
   * ↓ N below counters honest. The default panel height is hardcoded
   * (`LEGACY_DEFAULT_PANEL_H`) to avoid pulling `DEFAULT_PANEL_H` back
   * into this file; it must stay equal to `CanvasLayoutEngine`'s value.
   */
  private scrollFocusedPanel(direction: 1 | -1): boolean {
    const perTab = this.state.views[this.state.activeTab];
    const focus = perTab.panelFocus;
    if (focus === null) return false;
    const snap = this.state.lastSnapshot;
    if (!snap) return false;

    // Reproduce the per-panel h used by the renderer — must match
    // the renderer's geometry or the clamp could disagree with what
    // the painter draws.
    const dims = {
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    };
    const HEADER_H = 3;
    const FOOTER_H = 3;
    const available = Math.max(1, dims.rows - HEADER_H - FOOTER_H);
    const target = LEGACY_DEFAULT_PANEL_H * 4;
    const perPanelH = target <= available
      ? LEGACY_DEFAULT_PANEL_H
      : Math.max(5, Math.floor(available / 4));

    let totalItems = 0;
    let maxItems = 0;
    if (focus === 'approvals') {
      totalItems =
        (snap.approvals?.pending.length ?? 0) +
        (snap.approvals?.recentlyResolved.length ?? 0);
      // Mirror the approvals panel renderer: cap 4, item=2 rows, footer at h>=14.
      const APPROVAL_LIST_MAX = 4;
      const itemRows = 2;
      const footerRows = perPanelH >= 14 ? 1 : 0;
      const availableRows = Math.max(0, perPanelH - 3 - footerRows);
      maxItems = Math.max(
        0,
        Math.min(APPROVAL_LIST_MAX, Math.floor(availableRows / itemRows)),
      );
    } else {
      totalItems = snap.sops?.items.length ?? 0;
      // Mirror the sops/policy panel renderer: 3 items when h>=10, fewer otherwise.
      maxItems = perPanelH >= 10
        ? Math.min(3, totalItems)
        : Math.max(0, Math.min(totalItems, perPanelH - 8));
    }

    const maxOffset = Math.max(0, totalItems - maxItems);
    const current = perTab.panelScrollOffsets[focus];
    const next = Math.max(0, Math.min(current + direction, maxOffset));
    if (next === current) return false;
    perTab.panelScrollOffsets[focus] = next;
    return true;
  }

  private dispatch(action: ViewAction): void {
    switch (action.type) {
      case 'handled': break;
      case 'moveCursor':
        this.state.views[this.state.activeTab].cursor = action.cursor;
        if (action.pinnedBottom !== undefined) {
          this.state.views[this.state.activeTab].pinnedBottom = action.pinnedBottom;
        }
        this.paintFullFrame();
        break;
      case 'scroll':
        this.state.views[this.state.activeTab].scrollOffset = Math.max(0, action.offset);
        this.paintFullFrame();
        break;
      case 'switchTab':
        this.switchTab(action.tab);
        break;
      case 'scheduleRefresh':
        void this.refresh();
        break;
      case 'resolveApproval':
        void this.resolveApprovalFromView(action.approvalId, action.status);
        break;
    }
  }

  /**
   * Resolve an approval (approve or deny) by delegating to the wired
   * ApprovalManager — which routes through ApprovalStore + EventLog. The
   * resulting message is appended to the current view's agent
   * responses and the snapshot is refreshed so the panel count updates.
   */
  private async resolveApprovalFromView(
    approvalId: string,
    status: 'approved' | 'denied',
  ): Promise<void> {
    if (!approvalId) return;
    // Look up the pending approval across all tabs so we can capture the
    // original toolName/target for the historical log entry.
    let originalTool = 'unknown';
    let originalTarget = '';
    let requestedAt = Date.now();
    const tabs: TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
    for (const t of tabs) {
      const found = this.state.views[t]?.pendingApprovals?.find((a) => a.id === approvalId);
      if (found) {
        originalTool = found.toolName;
        originalTarget = found.target;
        requestedAt = found.requestedAt;
        break;
      }
    }
    const mgr = this.opts.approvalManager;
    if (!mgr) {
      // No manager wired — surface a friendly message and refresh.
      this.appendAgentMessage(
        this.state.activeTab,
        `[approval] no ApprovalManager wired for ${status} ${approvalId}`,
      );
      await this.refresh();
      return;
    }
    try {
      const result = await mgr.tryHandleCommand(
        status === 'approved' ? `/approve ${approvalId}` : `/deny ${approvalId}`,
      );
      const summary = result.handled ? result.message : `${status} ${approvalId} (no handler)`;
      this.appendAgentMessage(
        this.state.activeTab,
        `[approval:${status}] ${summary}`,
      );
      // Push a resolved entry into every tab's resolvedApprovals log so the
      // operator can see what they did — even if the agent loop is currently
      // paused waiting on this resolution.
      for (const t of tabs) {
        const tab = this.state.views[t];
        if (!tab) continue;
        tab.resolvedApprovals.unshift({
          id: approvalId,
          toolName: originalTool,
          target: originalTarget,
          status,
          requestedAt,
          resolvedAt: Date.now(),
        });
        if (tab.resolvedApprovals.length > 200) tab.resolvedApprovals.length = 200;
      }
    } catch (err) {
      this.appendAgentMessage(
        this.state.activeTab,
        `[approval:${status}] error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.refresh();
    }
  }

  /**
   * Append a one-liner to the active view's `agentResponses` so the
   * resolution message shows in the scrollback.
   */
  private appendAgentMessage(
    tab: TabId,
    text: string,
  ): void {
    const state = this.state.views[tab];
    if (!state) return;
    state.agentResponses.push(text);
  }

  /**
   * Build a complete frame containing all regions and write it to stdout
   * via the configured `OperatorRenderer`. The renderer is responsible
   * for translating the OperatorViewState + the optional legacy surface
   * into terminal output (or a no-op when a non-Canonical renderer is
   * wired in tests).
   */
  private paintFullFrame(): void {
    if (!this.state.lastSnapshot) return;
    const snap = this.state.lastSnapshot;
    const activeTab = this.state.activeTab;
    const perTab = this.state.views[activeTab];

    const vm = this.viewModelBuilder.build(snap, perTab, activeTab);

    // Set legacy view surface via capability interface (no cast).
    // The `'in'` operator narrows the renderer's type to include the
    // optional `setPreRenderSurface` hook, so we don't need a hard cast
    // to `PreRenderCapable` to call it.
    if ('setPreRenderSurface' in this.renderer) {
      const dims = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
      const leftW = Math.max(40, Math.floor(dims.columns * 0.75));
      const legacySurface = renderLegacyView({
        snap,
        perTab,
        views: this.views,
        activeTab,
        surfaceWidth: leftW,
        surfaceHeight: dims.rows,
      });
      (this.renderer as { setPreRenderSurface(s: import('./renderer/surface.js').RenderSurface | null): void })
        .setPreRenderSurface(legacySurface);
    }

    this.renderer.render(vm);
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
  if (buf[0] === 0x1b && buf.length >= 3 && buf[1] === 0x5b /* [ */) {
    if (buf[2] === 0x41) return 'ArrowUp';
    if (buf[2] === 0x42) return 'ArrowDown';
    if (buf[2] === 0x43) return 'ArrowRight';
    if (buf[2] === 0x44) return 'ArrowLeft';
    if (buf[2] === 0x5a) return 'Shift+Tab';
  }
  if (s.length === 1) return s;
  return null;
}

// `PreRenderCapable` is imported (per the strangler scaffold in the
// PR-A plan) but the call site uses structural narrowing via the `in`
// operator rather than a hard cast, so it appears unused. The type
// symbol is retained explicitly so future refactors can grep for it
// when wiring PR-C adapters.
