import type { PanelFocusId, PanelScrollOffsets, TabId, TuiAppState } from './state.js';
import { createInitialTuiAppState, SessionPhase } from './state.js';
import type { ViewAction, ViewInputContext, TuiView } from './views/types.js';
import { getView } from './views/index.js';
import type { SnapshotBuilder } from './snapshot-builder.js';
import type { DaemonMetricsCollector } from './daemon-metrics-collector.js';
import type { AgentSession } from '../agent/session.js';
import { createTerminalControl, type TerminalControl } from './terminal-control.js';
import type { OperatorRenderer } from './renderer/types.js';
import { CanvasRenderer } from './renderers/canvas-renderer.js';
import type { PreRenderCapable } from './renderers/canvas-renderer.js';
import { BlessedRenderer } from './renderers/blessed-renderer.js';
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
   * Optional renderer implementation. Defaults to `new BlessedRenderer()`.
   * Set `ALIX_TUI_RENDERER=canvas` to fall back to `CanvasRenderer`.
   * Pass a `NoopRenderer` (or any other `OperatorRenderer`) in tests or
   * alternate environments to bypass real terminal writes.
   */
  renderer?: OperatorRenderer;
}

const TAB_ORDER: readonly TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];

export class TuiApp {
  private state: TuiAppState = createInitialTuiAppState();
  private readonly renderer: OperatorRenderer;
  private readonly viewModelBuilder = new ViewModelBuilder();
  private readonly terminal: TerminalControl;
  // Per-tab input buffers / scrollback live in this.state.views. The
  // renderer (blessed) owns the prompt widget itself and mirrors edits
  // back via the 'inputChanged' RendererEvent.
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
    const useCanvas = process.env.ALIX_TUI_RENDERER === 'canvas';
    this.renderer = opts.renderer ?? (useCanvas ? new CanvasRenderer() : new BlessedRenderer());
  }

  private get views(): Readonly<Record<TabId, TuiView>> {
    return this.opts.views ?? this.defaultViews;
  }

  async start(): Promise<void> {
    this.terminal.enterAltBuffer();
    this.terminal.showCursor(true);

    // Emergency cleanup ALWAYS before renderer init
    this.terminal.installEmergencyCleanup(() => this.cleanupSync());

    // Route resize through the renderer so its internal geometry stays
    // in sync with the terminal before the next paint.
    this.terminal.onResize(() => {
      const dims = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
      this.renderer.resize(dims.columns, dims.rows);
      this.paintFullFrame();
    });

    await this.renderer.initialize(this.terminal);

    // Only enter raw mode if the renderer does NOT handle input
    // (e.g. blessed owns its own input loop). Raw stdin is no longer
    // bound here — the renderer owns all key/mouse capture when
    // `handlesInput` is false as well.
    const caps = this.renderer.capabilities();
    if (!caps.handlesInput) {
      this.terminal.enterRawMode();
    }

    this.opts.daemonMetrics.start();

    const initialGen = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(initialGen);
    if (snap && initialGen === this.state.refreshGeneration) {
      this.state.lastSnapshot = snap;
    }
    this.paintFullFrame();

    this.renderer.onEvent = (event) => {
      switch (event.type) {
        case 'exit':
          void this.stop().then(() => process.exit(0));
          break;
        case 'cycleTab':
          this.cycleTab(event.forward);
          break;
        case 'homeTab':
          this.switchTab('chat');
          break;
        case 'switchTab':
          this.switchTab(event.tab);
          break;
        case 'focusInput':
          // BlessedRenderer input already focused — app sets buffer state
          break;
        case 'blurInput':
          this.terminal.showCursor(true);
          break;
        case 'submitInput':
          this.handleRenderSubmit(event.value);
          break;
        case 'inputChanged':
          // Mirror the renderer's textarea state into the app-side buffer
          // so views (history, scrollback) can read it.
          this.state.views[this.state.activeTab].inputBuffer = event.value;
          break;
        case 'resolveApproval':
          // Renderer shortcuts 'a' / 'd' don't know which approval to
          // resolve — pick the oldest pending on the active tab.
          this.resolveApprovalFromView(event.status);
          break;
        default:
          assertNever(event);
      }
    };

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
   * Cycle forward or backward through the tab order.
   * Called from renderer events (e.g., Tab / Shift+Tab via BlessedRenderer).
   */
  private cycleTab(forward: boolean): void {
    const idx = TAB_ORDER.indexOf(this.state.activeTab);
    const nextIdx = (idx + (forward ? 1 : TAB_ORDER.length - 1)) % TAB_ORDER.length;
    this.switchTab(TAB_ORDER[nextIdx]!);
  }

  /**
   * Handle a submitted input value from the renderer's own input widget
   * (e.g., BlessedRenderer's text input box). Delegates to the active tab's
   * submit handler — chat tab goes through submitChatInput, all other
   * input-capable tabs (agent, daemon, etc.) go through submitAgentInput.
   */
  private handleRenderSubmit(value: string): void {
    const tab = this.state.activeTab;
    const perTab = this.state.views[tab];
    if (!perTab) return;
    if (value.trim().length === 0) return;
    perTab.submittedPrompts.push(value);
    if (tab === 'chat') {
      void this.submitChatInput(value);
    } else {
      void this.submitAgentInput(value);
    }
    this.paintFullFrame();
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
    }
  }

  /**
   * Resolve an approval (approve or deny) by delegating to the wired
   * ApprovalManager — which routes through ApprovalStore + EventLog. The
   * resulting message is appended to the current view's agent
   * responses and the snapshot is refreshed so the panel count updates.
   *
   * Callers (the BlessedRenderer textarea shortcuts and the approvals
   * view dispatcher) don't carry a specific approvalId: shortcut keys
   * always act on the oldest pending approval. We walk the active tab
   * first and then every other tab until we find one, capturing the
   * original toolName/target for the inline history card.
   */
  private async resolveApprovalFromView(
    status: 'approved' | 'denied',
  ): Promise<void> {
    // Find the oldest pending approval across all tabs. Active tab first
    // so the inline hint the user is staring at matches what gets
    // resolved; fall back to other tabs in case the hint is showing on
    // the approvals tab but the user pressed the shortcut elsewhere.
    const tabs: TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
    const tabOrder: TabId[] = [
      this.state.activeTab,
      ...tabs.filter((t) => t !== this.state.activeTab),
    ];
    let target: { id: string; toolName: string; target: string; requestedAt: number } | undefined;
    for (const t of tabOrder) {
      const found = this.state.views[t]?.pendingApprovals?.[0];
      if (found) { target = found; break; }
    }
    if (!target) return;
    const approvalId = target.id;
    const originalTool = target.toolName;
    const originalTarget = target.target;
    const requestedAt = target.requestedAt;

    // Reflect the resolution in our local UI state so the inline card
    // disappears immediately. The ApprovalManager call below still
    // persists the decision; if it fails the snapshot refresh restores
    // the entry on the next refresh cycle. We mirror the resolved
    // history entry into every tab's resolvedApprovals log so the
    // operator can see what they did on any tab.
    for (const t of tabs) {
      const list = this.state.views[t]?.pendingApprovals;
      if (!list) continue;
      const idx = list.findIndex((a) => a.id === approvalId);
      if (idx >= 0) {
        list.splice(idx, 1);
      }
      const resolvedList = this.state.views[t]?.resolvedApprovals;
      if (resolvedList) {
        resolvedList.unshift({
          id: approvalId,
          toolName: originalTool,
          target: originalTarget,
          status,
          requestedAt,
          resolvedAt: Date.now(),
        });
        if (resolvedList.length > 200) resolvedList.length = 200;
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

function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}

// `PreRenderCapable` is imported (per the strangler scaffold in the
// PR-A plan) but the call site uses structural narrowing via the `in`
// operator rather than a hard cast, so it appears unused. The type
// symbol is retained explicitly so future refactors can grep for it
// when wiring PR-C adapters.
