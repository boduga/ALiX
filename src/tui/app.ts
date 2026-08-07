import type { PanelFocusId, PanelScrollOffsets, PerTabState, TabId, TuiAppState } from './state.js';
import { createInitialTuiAppState, TAB_ORDER } from './state.js';
import type { RuntimeSnapshot } from './snapshot.js';
import type { EventLog } from '../events/event-log.js';
import type { RuntimeCollector } from './runtime-collector.js';
import type { ViewAction, ViewInputContext, TuiView, TerminalDimensions } from './views/types.js';
import { parseSlashInput, rankSkillMatches, canonicalSkillId } from '../skills/slash.js';
import { getView } from './views/index.js';
import { TuiRenderer } from './render.js';
import type { SnapshotBuilder } from './snapshot-builder.js';
import type { DaemonMetricsCollector } from './daemon-metrics-collector.js';
import type { AgentSession } from '../agent/session.js';
import { Navigation } from './navigation.js';
import { createTerminalControl, type TerminalControl } from './terminal-control.js';
import { DEFAULT_PANEL_H } from './dashboard-renderer.js';
import { TuiPlanApprovalGate } from './plan-approval-gate.js';
import type { PlanDecision } from '../run/plan-approval-gate.js';
import type { PlanTask } from '../planning/plan-task.js';
import type { IInput, IOutput } from './io.js';
import { StdioInput, StdioOutput } from './io.js';
import { KeyDispatcher } from './key-dispatcher.js';
import { ChatInvocationPresenter } from './capabilities/invocation-presenter.js';
import { computeBottomAnchor, HEADER_H, FOOTER_H, trimStreamedTextToLanded } from './views/scroll-math.js';
import { createTimelineEmitter, type TimelineEmitter } from './timeline-emitter.js';
import { SlashController } from './slash-controller.js';
import { PaletteController } from './palette-controller.js';
import { createApprovalResolver, type ApprovalResolver } from './approval-resolver.js';
import { FramePainter } from './frame-painter.js';

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
  /** Input source. Defaults to StdioInput (process.stdin). */
  input?: IInput;
  /** Output sink. Defaults to StdioOutput (process.stdout). */
  output?: IOutput;
  /** Optional key dispatcher for pluggable keybindings. When provided,
   *  parseKey() results are routed through the dispatcher before the
   *  built-in key handling. The dispatcher can consume a key (returning
   *  true) or let it fall through to the default path. */
  keyDispatcher?: import('./key-dispatcher.js').KeyDispatcher;
  /** Theme name passed to renderResponse. Defaults to 'dark'. */
  themeName?: string;
  /** Optional capability service — the palette only activates when a
   *  service is available (either here or via the module accessor). */
  capabilityService?: import('./capabilities/capability-service.js').CapabilityService;
  /** EventLog backing the Phase 6 dual-emit. When present (with a per-tab
   *  sessionId), every timeline append ALSO emits a typed log entry so the
   *  log becomes canonical (D7/D9). Optional — absent in unit tests, where
   *  appends stay purely in-memory. */
  eventLog?: EventLog;
  /** Sub-session id stamped on chat-tab emits: `${sessionId}-chat`. Derived
   *  in tui.ts; the chat collector projects this session. */
  chatSessionId?: string;
  /** Sub-session id stamped on agent-tab emits: `${sessionId}-agent`.
   *  Derived in tui.ts; the agent collector projects this session. */
  agentSessionId?: string;
  /** Per-tab runtime collectors (Phase 6). Both share the EventLog +
   *  checkpoint store; each projects one sub-session's timeline. Forward-
   *  compatible surface for Task 4 (views consume RuntimeSnapshot.timeline). */
  runtimeCollectors?: {
    chat: RuntimeCollector;
    agent: RuntimeCollector;
  };
}

/**
 * Narrow writable view of a tab's per-tab state that the shared submit path
 * is allowed to mutate. dispatchToSession only appends to the operator
 * timeline and resets plan/scroll fields — it never needs the full
 * PerTabState, so this type keeps the function honest about its surface.
 */
type TimelineWritableState = Pick<PerTabState, 'planContent' | 'planTasks' | 'scrollOffset' | 'streamingText' | 'streamingActive'>;

export class TuiApp {
  private state: TuiAppState = createInitialTuiAppState();
  private readonly renderer: TuiRenderer;
  private readonly terminal: TerminalControl;
  private readonly navigation = new Navigation();
  private snapshotTimer?: NodeJS.Timeout;
  private detached = false;
  /**
   * Cached sub-session runtime snapshots (Phase 6, D6/D9). Sampled from
   * `opts.runtimeCollectors` on start() and every refresh(); injected into the
   * view render context as `ctx.runtime.{chat,agent}` so ChatView/AgentView
   * project the chat/agent collector timelines. Distinct from the OUTER-scoped
   * `snap.runtime` (Runtime tab trace). The collectors' `snapshot()` returns
   * their in-memory cache synchronously (wrapped in a Promise), so sampling
   * here is cheap and keeps the views within one refresh tick of the log.
   */
  private chatRuntime: RuntimeSnapshot | null = null;
  private agentRuntime: RuntimeSnapshot | null = null;
  private readonly defaultViews: Readonly<Record<TabId, TuiView>>;
  /**
   * Plan approval gate — owned by the TUI. The agent session calls
   * `gate.requestDecision()` from inside `runPlanPhase` and awaits the
   * Promise. The TUI's keyboard handler () resolves it when the operator
   * presses Y/n/e/d. The card rendered in `paintFullFrame` is driven
   * purely off `gate.getPending()` — no parallel state.
   */
  /** Tabs that receive snapshot-synced fields (approvals, ledger, intent). */
  private readonly SYNC_TABS: readonly TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
  private readonly planApprovalGate = new TuiPlanApprovalGate();
  private pasteState: 'idle' | 'reading' = 'idle';
  private pasteChunks: Buffer[] = [];
  private readonly input: IInput;
  private readonly output: IOutput;
  private readonly keyDispatcher: import('./key-dispatcher.js').KeyDispatcher;
  private inputCleanup?: () => void;
  private resizeCleanup?: () => void;
  /** Slash-command completion strip state + logic (agent tab only). */
  private readonly slash = new SlashController({
    activeTab: () => this.state.activeTab,
    getAgentBuffer: () => this.state.views.agent.inputBuffer,
    setAgentBuffer: (s: string) => { this.state.views.agent.inputBuffer = s; },
    // The controller guards its own catalog refresh against a torn-down
    // instance (stop()/cleanupSync) — see SlashController.refreshCatalog().
    isDetached: () => this.detached,
  });
  /** Single-emit timeline writes into the EventLog (Phase 6 D9). */
  private readonly timelineEmitter: TimelineEmitter;
  /** Command-palette modal — key routing while open + overlay paint. */
  private readonly paletteController: PaletteController;
  /** Resolve an approval (approve/deny) via the wired ApprovalManager. */
  private readonly approvalResolver: ApprovalResolver;
  /** Owns the full-frame render — view, card, palette, header, tabs, status, cursor. */
  private readonly framePainter: FramePainter;

  constructor(private readonly opts: TuiAppOptions) {
    this.input = opts.input ?? new StdioInput(process.stdin);
    this.output = opts.output ?? new StdioOutput();
    this.keyDispatcher = opts.keyDispatcher ?? new KeyDispatcher();
    this.defaultViews = {
      dashboard: getView('dashboard')!,
      chat: getView('chat')!,
      agent: getView('agent')!,
      daemon: getView('daemon')!,
      approvals: getView('approvals')!,
      runtime: getView('runtime')!,
      sops: getView('sops')!,
      policy: getView('policy')!,
      capabilities: getView('capabilities')!,
    };
    this.terminal = createTerminalControl();
    this.renderer = new TuiRenderer();

    // Build the extracted controllers. These read `this.opts` and `this.output`,
    // which are only assigned in the constructor body — so they are initialized
    // here rather than as field initializers.
    this.timelineEmitter = createTimelineEmitter({
      eventLog: this.opts.eventLog,
      chatSessionId: this.opts.chatSessionId,
      agentSessionId: this.opts.agentSessionId,
    });
    this.paletteController = new PaletteController({ capabilityService: this.opts.capabilityService });
    this.approvalResolver = createApprovalResolver({
      views: () => this.state.views,
      activeTab: () => this.state.activeTab,
      syncTabs: this.SYNC_TABS,
      approvalManager: this.opts.approvalManager,
      emit: (tab, text) => this.timelineEmitter.appendAgentMessage(tab, text),
      refresh: () => this.refresh(),
    });
    this.framePainter = new FramePainter({
      state: () => this.state,
      views: () => this.views,
      opts: { themeName: this.opts.themeName, agentSession: this.opts.agentSession },
      chatRuntime: () => this.chatRuntime,
      agentRuntime: () => this.agentRuntime,
      computeSlashStrip: () => this.slash.computeStrip(),
      planApprovalGate: this.planApprovalGate,
      output: this.output,
      palette: this.paletteController,
    });

    // Bind the capability service's presenter so every invocation emits its
    // settled chat-surface entry into the chat sub-session's log projection
    // (Phase 6 — the EventLog is the single source of truth timeline; the
    // presenter no longer holds any per-tab state). The service's module
    // accessor is also set at bootstrap — the option is redundant but keeps
    // TuiApp usable standalone.
    if (this.opts.capabilityService) {
      const svc = this.opts.capabilityService;
      const presenter = new ChatInvocationPresenter(this.timelineEmitter.emitCtx(this.opts.chatSessionId));
      svc.setPresenter(presenter);
    }
  }

  /** Test seam: expose the gate for direct assertions in unit tests. */
  getPlanApprovalGateForTest(): TuiPlanApprovalGate {
    return this.planApprovalGate;
  }

  private get views(): Readonly<Record<TabId, TuiView>> {
    return this.opts.views ?? this.defaultViews;
  }

  async start(): Promise<void> {
    this.terminal.enableTerminalModes();
    this.resizeCleanup = this.terminal.onResize(() => this.paintFullFrame());

    this.opts.daemonMetrics.start();

    // Inject the plan-approval gate into the agent session so `runPlanPhase`
    // can route the operator's decision through the TUI card. The setter
    // is optional on the interface; missing in tests is fine (they use the
    // legacy TTY prompt path).
    this.opts.agentSession?.setPlanApprovalGate?.(this.planApprovalGate);

    const initialGen = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(initialGen);
    if (snap && initialGen === this.state.refreshGeneration) {
      this.state.lastSnapshot = snap;
    }
    await this.sampleRuntimeCollectors();
    this.paintFullFrame();
    // Repaint after the catalog read resolves so a CLI-side install/remove
    // (invalidateSlashCatalog) refreshes the completion strip immediately
    // rather than waiting for the next snapshot tick.
    void this.slash.refreshCatalog().then(() => {
      // Detached guard: the catalog read may resolve after stop() — never
      // repaint (terminal writes) a torn-down instance.
      if (!this.detached && this.state.activeTab === 'agent') this.paintFullFrame();
    });

    this.terminal.installEmergencyCleanup(() => this.cleanupSync());
    this.inputCleanup = this.input.onData((buf) => { if (Buffer.isBuffer(buf)) this.handleRaw(buf); });
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
  getStateForTest(): TuiAppState {
    return this.state;
  }

  /**
   * Test seam: simulate a user-driven tab switch by calling the production
   * `switchTab`. Use this instead of mutating `getStateForTest().activeTab`
   * directly when the test needs the full transition path (history.push,
   * panelFocus binding, hook ordering, scrollOffset reset, paint). For
   * initial-state seeding that does not need the transition path, mutate
   * `getStateForTest().activeTab` directly.
   */
  setActiveTabForTest(tab: TabId): void {
    this.switchTab(tab);
  }

  /**
   * Appends one streamed text token to the agent tab's growing pending line
   * and repaints. Called by the session's `events.onToken` (wired in
   * `src/cli/commands/tui.ts`) for every token the model streams.
   *
   * Gated on `streamingActive` — armed by `dispatchToSession` for the
   * in-flight agent turn — so tokens arriving after the turn folded (a
   * timed-out turn still running in the background) cannot resurrect the
   * line. Also gated on `detached` so a torn-down terminal is never painted.
   */
  appendAgentStreamToken(token: string): void {
    if (this.detached || !this.state.views.agent.streamingActive) return;
    const per = this.state.views.agent;
    per.streamingText = (per.streamingText ?? '') + token;
    // Repaint only when the agent tab is visible — the growing line lives on
    // the agent tab, so tokens must not repaint an unrelated view every token.
    if (this.state.activeTab === 'agent') this.paintFullFrame();
  }

  // Test seams (mirroring getStateForTest) — delegate to the slash controller.
  get slashManifestsForTest(): any[] { return this.slash.manifests; }
  set slashManifestsForTest(v: any[]) { this.slash.manifests = v; }
  get slashHintForTest(): string | null { return this.slash.hint; }
  get slashSelectionForTest(): number { return this.slash.selection; }
  /** Raw manifests accessor — test seam for `internal.slashManifests` casts. */
  private get slashManifests(): any[] { return this.slash.manifests; }
  private set slashManifests(v: any[]) { this.slash.manifests = v; }

  private async refresh(): Promise<void> {
    const generation = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(generation);
    if (!snap || generation !== this.state.refreshGeneration) return;
    this.state.lastSnapshot = snap;
    this.syncPendingApprovals();
    this.syncCurrentIntent();
    await this.sampleRuntimeCollectors();
    this.paintFullFrame();
    // Re-read the slash manifest catalog so a CLI-side install/remove
    // (invalidateSlashCatalog) becomes visible in the TUI's completion
    // strip within ~1s. The cache is generation-based — steady-state
    // reads are pure in-memory until the generation is bumped.
    // Repaint after the catalog read resolves so a CLI-side install/remove
    // (invalidateSlashCatalog) refreshes the completion strip immediately
    // rather than waiting for the next snapshot tick.
    void this.slash.refreshCatalog().then(() => {
      // Detached guard: the catalog read may resolve after stop() — never
      // repaint (terminal writes) a torn-down instance.
      if (!this.detached && this.state.activeTab === 'agent') this.paintFullFrame();
    });
  }

  /**
   * Sample the two sub-session runtime collectors and cache their snapshots for
   * the next paint. Called from start() and refresh() (both already async) so
   * the view render context carries fresh chat/agent timelines without ever
   * awaiting inside the synchronous paintFullFrame. The collectors' snapshot()
   * returns their in-memory cache synchronously (wrapped in a Promise), so this
   * is cheap and keeps the views within one refresh tick of the EventLog.
   */
  private async sampleRuntimeCollectors(): Promise<void> {
    this.chatRuntime = (await this.opts.runtimeCollectors?.chat.snapshot()) ?? null;
    this.agentRuntime = (await this.opts.runtimeCollectors?.agent.snapshot()) ?? null;
    // In-flight streaming overlap: the agent timeline and the live streaming
    // line are sampled together here, so trim the streaming line the instant
    // new prose lands. Without this, `streamingText` accumulates across all
    // iterations of a turn (only cleared in dispatchToSession's finally),
    // re-showing already-landed `agent.message` prose beside its permanent
    // entry. Same 1s cadence as the collector, so never more than one tick
    // stale.
    const agentPer = this.state.views.agent;
    if (this.agentRuntime && agentPer.streamingText) {
      agentPer.streamingText = trimStreamedTextToLanded(this.agentRuntime.timeline, agentPer.streamingText);
    }
  }

  /**
   * Sync currentIntent from snapshot session metadata to every tab's
   * perTab state so the badge renders correctly regardless of the
   * active tab when intent changes.
   */
  private syncCurrentIntent(): void {
    const snap = this.state.lastSnapshot;
    if (!snap?.session?.currentIntent) return;
    for (const t of this.SYNC_TABS) {
      const perTab = this.state.views[t];
      if (perTab) perTab.currentIntent = snap.session.currentIntent;
    }
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
    for (const t of this.SYNC_TABS) {
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
        target: p.target,
        requestedAt: p.requestedAt,
      }));
      // Keep 'stillPending' reference so the linter doesn't complain — it
      // documents the intent of the filter above.
      void stillPending;
    }
    // Sync progress ledger from snapshot to every tab's perTab state
    if (snap.progressLedger) {
      for (const t of this.SYNC_TABS) {
        const perTab = this.state.views[t];
        if (perTab) perTab.progressLedger = snap.progressLedger;
      }
    }
    // Sync pending tool calls from snapshot to every tab's perTab state
    if (snap.pendingToolCalls) {
      for (const t of this.SYNC_TABS) {
        const perTab = this.state.views[t];
        if (perTab) perTab.pendingToolCalls = snap.pendingToolCalls as Array<{ name: string; summary?: string }>;
      }
    }
  }

  private handleRaw(buf: Buffer): void {
    // 1. Bracketed paste detector — runs on raw bytes, before key parsing.
    if (this.handlePaste(buf)) return;

    const key = parseKey(buf);
    if (!key) return;
    // Command palette is a modal — while open, route EVERY key (Escape,
    // q, Tab, arrows, text) to the modal BEFORE the global handler gets a
    // chance to act. Without this ordering Escape could never dismiss the
    // palette (navigation.interpret('Escape') → home → tryHandleGlobal
    // switches to chat and returns true) and 'q' on a non-input tab would
    // hit the global quit path and terminate the process mid-search.
    if (this.paletteController.open) {
      this.paletteController.handleKey(key);
      return;
    }
    // Slash-command completion mode: Tab completes the buffer to the
    // selected skill's primary slash name (preserving any rest);
    // Shift+Tab cycles the selection backward. Tab is intentionally
    // non-cycling here — completion is the more useful primary action.
    // The operator can refine the buffer with more letters and press Tab
    // again to re-complete against the new ranking.
    if (this.slash.active()) {
      if (key === 'Tab') {
        if (this.slash.complete()) this.paintFullFrame();
        return;
      }
      if (key === 'Shift+Tab') { this.slash.cycleSelection(-1); this.paintFullFrame(); return; }
    }
    if (this.tryHandleGlobal(key)) return;
    // 2b. Pluggable key dispatcher — registered keybindings get first
    //     chance to consume the key before the built-in dispatch.
    if (this.keyDispatcher.dispatch(key)) return;
    if (!this.state.lastSnapshot) return;
    const tab = this.state.activeTab;

    // ── Plan approval gate — Y/n/e/d ─────────────────────────────
    // When a plan is awaiting operator approval, the four plan keys
    // resolve the gate regardless of the active tab. This is the only
    // path that bypasses input capture — while a plan is pending the
    // operator cannot type 'y'/'n'/'e'/'d' into the input buffer.
    // Considered: limiting the gate to the agent tab. Rejected: the
    // card is visible from any tab (it's drawn into the canvas below
    // the active view), so the operator should be able to approve
    // without first switching tabs.
    const pendingPlan = this.planApprovalGate.getPending();
    if (pendingPlan) {
      const planDecision = mapKeyToPlanDecision(key);
      if (planDecision) {
        this.planApprovalGate.resolve(pendingPlan.planId, planDecision);
        this.paintFullFrame();
        return;
      }
    }

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
          // T437 (spec #429 slice 8): operator-initiated submission re-pins
          // the scrollback to bottom so the new prompt + response are visible.
          // Distinct from auto-re-pin on system events (rejected in #436).
          perTab.pinnedBottom = true;
          this.resetScrollOffsetToBottom('chat');
          this.timelineEmitter.emitTimelineLog('user', perTab.inputBuffer, this.opts.chatSessionId);
          void this.submitChatInput(perTab.inputBuffer);
          perTab.inputBuffer = '';
        }
        this.paintFullFrame();
        return;
      }
      if (key === 'Backspace') {
        if (perTab.inputBuffer.length > 0) {
          perTab.inputBuffer = perTab.inputBuffer.slice(0, -1);
        } else {
          this.navigateBack();
        }
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
      // Shift+Tab on the agent tab cycles the permission mode
      // (auto → ask → bypass → auto). Other tabs use Shift+Tab for
      // tab cycling via tryHandleGlobal — overriding it only here
      // keeps the navigation gesture intact everywhere else.
      if (key === 'Shift+Tab') {
        this.cyclePermissionMode();
        // Force an immediate snapshot so the header reflects the new
        // mode on the next paint instead of waiting up to 1s.
        void this.refresh();
        return;
      }
      if (key === 'Enter') {
        if (this.slash.active()) {
          void this.submitSlashCommand();
          this.paintFullFrame();
          return;
        }
        if (perTab.inputBuffer.trim().length > 0) {
          // T437 (spec #429 slice 8): operator-initiated submission re-pins
          // the scrollback to bottom so the new prompt + response are visible.
          // Distinct from auto-re-pin on system events (rejected in #436).
          perTab.pinnedBottom = true;
          this.resetScrollOffsetToBottom('agent');
          this.timelineEmitter.emitTimelineLog('user', perTab.inputBuffer, this.opts.agentSessionId);
          void this.submitAgentInput(perTab.inputBuffer);
          perTab.inputBuffer = '';
        }
        this.paintFullFrame();
        return;
      }
      if (key === 'Backspace') {
        if (perTab.inputBuffer.length > 0) {
          perTab.inputBuffer = perTab.inputBuffer.slice(0, -1);
        } else {
          this.navigateBack();
        }
        this.paintFullFrame();
        return;
      }
      // Inline approval resolution — when there are pending approvals and
      // the user presses `a`/`d`, resolve the OLDEST pending one and
      // surface the result inline. This avoids the "I have to switch to
      // the approvals tab just to press one key" friction. Keyed on the
      // agent tab (AC#7: works from any scroll position within it) — the
      // banner it resolves is the shared status-row banner (frame-painter),
      // and the approvals tab's own view.handleKey only moves the cursor.
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
        void this.approvalResolver.resolve(target.id, status);
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

    // ── Alt+C clipboard copy ────────────────────────────────────
    if (key === 'Alt+c') {
      this.dispatch({ type: 'copyScrollback' });
      return;
    }

    const view = this.views[tab]!;
    // End / G / g → re-pin to bottom of scrollback (Claude-Code-style).
    if ((tab === 'agent' || tab === 'chat') && (key === 'End' || key === 'G' || key === 'g')) {
      const per = this.state.views[tab]!;
      per.pinnedBottom = true;
      this.resetScrollOffsetToBottom(tab);
      this.paintFullFrame();
      return;
    }
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
   * Submit a slash command (agent tab only): strip the trigger, resolve the
   * skill, and dispatch the rest as the task with the skill explicitly
   * injected. Unknown commands keep the buffer and set a hint — never an
   * accidental agent call.
   */
  private async submitSlashCommand(): Promise<void> {
    if (this.state.activeTab !== 'agent') return;
    const perTab = this.state.views.agent;
    const buf = perTab.inputBuffer;
    const parsed = parseSlashInput(buf);
    if (!parsed) return;
    // Bare `/` is "no token yet" — activating slash mode surfaces every
    // installed skill, but Enter on bare `/` would auto-invoke the
    // first-ranked skill as a free-text query, which is never what the
    // operator wants. Bail with a hint and preserve the buffer so the
    // operator can type or Tab/arrow to pick.
    if (parsed.command === '/') {
      this.slash.hint = 'type a skill name, or Tab to cycle';
      return;
    }
    const matches = rankSkillMatches(this.slash.manifests, parsed.command);
    if (matches.length === 0) {
      this.slash.hint = `Unknown skill "${parsed.command}" — press Tab for completions.`;
      return; // keep the text in the buffer; no agent call
    }
    const selected = matches[Math.min(this.slash.selection, matches.length - 1)]!;
    const text = parsed.rest.trim() || selected.name;
    this.slash.hint = null;
    perTab.inputBuffer = '';
    // T437 (spec #429 slice 8): slash-command submission re-pins the
    // scrollback to bottom. Distinct from auto-re-pin on system events
    // (rejected in #436). `/clear` re-pins below too — the state mutation
    // is idempotent.
    perTab.pinnedBottom = true;
    this.resetScrollOffsetToBottom(this.state.activeTab as 'agent' | 'chat');
    // `/clear` resets the scrollback — re-pin to bottom. Spec invariant:
    // `scrollOffset` must equal `bottomAnchor` (not literal 0). With the
    // timeline cleared by the same handler, `allLines.length === 0`, so
    // `computeBottomAnchor` returns 0 — behavior is unchanged. The
    // important property is that the scroll-up capture formula in
    // `dispatch`'s `scroll` case has a consistent baseline.
    if (selected.name === 'clear' || selected.trigger === '/clear') {
      perTab.pinnedBottom = true;
      this.resetScrollOffsetToBottom(this.state.activeTab as 'agent' | 'chat');
    }
    this.slash.selection = 0;
    this.timelineEmitter.emitTimelineLog('user', text, this.opts.agentSessionId);
    const skills = [canonicalSkillId(selected)];
    await this.dispatchToSession(
      text, 'agent', perTab,
      [this.opts.agentSession?.processTurn?.bind(this.opts.agentSession)],
      '[agent]', 120_000, skills,
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
    perTab: TimelineWritableState,
    candidates: Array<((text: string, options?: { skills?: string[] }) => Promise<{ summary: string; reason?: string; planContent?: string; planTasks?: readonly PlanTask[] }>) | undefined>,
    fallbackPrefix: string,
    timeoutMs = 5_000,
    skills?: string[],
  ): Promise<void> {
    if (!this.state.lastSnapshot) return;
    let summary: string = `${fallbackPrefix} ${text}`;
    // Clear stale plan content and plan tasks before starting a new turn
    perTab.planContent = undefined;
    perTab.planTasks = undefined;
    // Arm the live-streaming gate for the agent tab: clear any pending line
    // left by a prior turn, then let onToken appends reach the growing line.
    // The finally below disarms it (folds) whether the turn succeeds or
    // errors — a post-timeout straggler token can't resurrect the line.
    const isAgent = kind === 'agent';
    if (isAgent) {
      perTab.streamingActive = true;
      perTab.streamingText = undefined;
    }
    let partialStreamed: string | undefined;
    try {
      for (const fn of candidates) {
        if (!fn) continue;
        try {
          const result = await this.raceAgentCall(text, fn, timeoutMs, skills);
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
          // Capture plan content and structured tasks from the session turn result
          if (result.planContent) {
            perTab.planContent = result.planContent;
          }
          if (result.planTasks && result.planTasks.length > 0) {
            perTab.planTasks = result.planTasks;
          }
          // Friendly rewrites for known runtime termination reasons so the
          // operator doesn't see the raw internal "Agent reached maximum
          // iteration" string or similar.
          if (result.reason === 'max_iterations') {
            summary = `(${kind} hit the runtime iteration cap. Try a more specific task, or switch to the chat tab for casual queries.)`;
          } else if (result.reason === 'rate-limit' || result.reason === 'rate_limit') {
            summary = `(${kind} was rate-limited by the provider. Wait a moment and retry.)`;
          }
          // A successful turn supersedes any partial text captured from an
          // earlier failed candidate — don't pollute the good summary.
          partialStreamed = undefined;
          break;
        } catch (err) {
          // Preserve whatever was already streamed so a timeout/error on a
          // hung turn doesn't silently discard the partial text (fail-soft).
          // Only the agent tab streams (`streamingText` is never set on chat),
          // so a plain read is equivalent to a kind guard.
          partialStreamed = perTab.streamingText;
          // Stderr is independent of the TUI render — even if paintFullFrame
          // fails for some reason, the operator sees the failure here.
          process.stderr.write(`[alix-tui] ${kind} submit error: ${err instanceof Error ? err.message : String(err)}\n`);
          summary = `(agent error: ${err instanceof Error ? err.message : String(err)})`;
          // Try the next candidate rather than giving up.
        }
      }
    } finally {
      // Fold: drop the pending line — the completed entry (summary, or the
      // partial text + summary on error) renders in its place, so the history
      // reads the same whether or not streaming was on.
      if (isAgent) {
        perTab.streamingActive = false;
        perTab.streamingText = undefined;
      }
    }
    // Fail-soft: keep the tokens already streamed visible when the turn
    // errored/timed out, prefixed to the stamped entry (no orphan line).
    if (partialStreamed && partialStreamed.length > 0) {
      summary = `${partialStreamed}\n\n${summary}`;
    }
    // The single log emit stamps the sub-session that matches the submission
    // kind — chat submits route to the chat collector, agent submits to the
    // agent collector (Phase 6). The per-tab in-memory cache is gone.
    this.timelineEmitter.emitTimelineLog('agent', summary, kind === 'chat' ? this.opts.chatSessionId : this.opts.agentSessionId);
    // Auto-follow is now handled by the per-tab `pinnedBottom` flag plus the
    // view's branched render logic; the app layer no longer clamps the offset.
    this.paintFullFrame();
  }

  /**
   * Race an agent call against `timeoutMs`. Returns the call's result on
   * success, throws on either rejection or timeout.
   */
  private raceAgentCall(
    text: string,
    fn: (text: string, options?: { skills?: string[] }) => Promise<{ summary: string; reason?: string; planContent?: string; planTasks?: readonly PlanTask[] }>,
    timeoutMs: number,
    skills?: string[],
  ): Promise<{ summary: string; reason?: string; planContent?: string; planTasks?: readonly PlanTask[] }> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`agent call timed out after ${timeoutMs}ms`)), timeoutMs),
    );
    return Promise.race([skills ? fn(text, { skills }) : fn(text), timeout]);
  }

  private tryHandleGlobal(key: string): boolean {
    // On the agent tab, Shift+Tab is hijacked to cycle the permission
    // mode (auto → ask → bypass → auto). Returning false here lets the
    // agent-tab input handler below claim it. Other tabs still get the
    // standard reverse-tab cycling.
    if (key === 'Shift+Tab' && this.state.activeTab === 'agent') {
      return false;
    }
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
    // Command palette (Ctrl+P, or '/' on an empty chat input).
    if (key === 'Ctrl+p' || (key === '/' && this.state.activeTab === 'chat' && this.state.views.chat.inputBuffer.length === 0)) {
      if (this.opts.capabilityService || this.paletteController.hasCapabilityService()) {
        this.paletteController.open = true;
        this.paletteController.query = '';
        this.paletteController.modal.refresh('');
        return true;
      }
      return false;
    }
    // Ctrl+C always quits. 'q'/'Q' quits only on non-input tabs
    // (dashboard, daemon, approvals, etc.) — on chat/agent tabs it's
    // a regular character for the input buffer and is handled by the
    // tab-specific handler below after tryHandleGlobal returns false.
    const inputTabs: TabId[] = ['chat', 'agent'];
    const isInputTab = inputTabs.includes(this.state.activeTab);
    if (key === '' || (!isInputTab && (key === 'q' || key === 'Q'))) {
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

  /**
   * Pop the navigation stack and return to the previous tab.
   * No-op when history is empty (stays on the current tab).
   */
  private navigateBack(): void {
    const prev = this.state.history.pop();
    if (prev) {
      this.views[this.state.activeTab]?.onDeactivate?.(this.state.views[this.state.activeTab]);
      this.state.activeTab = prev;
      this.views[prev]?.onActivate?.(this.state.views[prev]);
      this.paintFullFrame();
    }
  }

  /**
   * Cycle the agent session's permission mode: auto → ask → bypass → auto.
   * Triggered by Shift+Tab on the agent tab. Persists by mutating the
   * session config; the next snapshot reflects the change in the header.
   */
  private cyclePermissionMode(): void {
    const order: Array<"auto" | "ask" | "bypass"> = ["auto", "ask", "bypass"];
    const current = this.opts.agentSession?.getMode?.() ?? "auto";
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length] ?? "auto";
    this.opts.agentSession?.setMode?.(next);
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
    // Re-pin scrollback to bottom on chat/agent activation — baseline for
    // the scroll-up capture formula in `dispatch`'s `scroll` case. Spec
    // invariant: `scrollOffset` must equal `bottomAnchor` (not literal 0) so
    // the capture formula's `max(0, bottomAnchor - step)` has a consistent
    // baseline when `pinnedBottom` flips to false. This is the production
    // path that the `setActiveTabForTest` seam delegates to.
    if (next === 'agent' || next === 'chat') {
      const nextPer = this.state.views[next];
      nextPer.pinnedBottom = true;
      this.resetScrollOffsetToBottom(next);
    }
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
   * Mirrors the per-panel max-items math from `paintApprovalsPanel` and
   * `paintSopsAndPolicyPanel` so the clamp matches what the painter can
   * actually render — keeping the ↑ N above / ↓ N below counters honest.
   */
  private scrollFocusedPanel(direction: 1 | -1): boolean {
    const perTab = this.state.views[this.state.activeTab];
    const focus = perTab.panelFocus;
    if (focus === null) return false;
    const snap = this.state.lastSnapshot;
    if (!snap) return false;

    // Reproduce the per-panel h used by renderSidebar — must match
    // `app.ts`'s `paintFullFrame` geometry or the clamp could disagree
    // with what the painter draws.
    const dims: TerminalDimensions = {
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    };
    const available = Math.max(1, dims.rows - HEADER_H - FOOTER_H);
    const target = DEFAULT_PANEL_H * 4;
    const perPanelH = target <= available
      ? DEFAULT_PANEL_H
      : Math.max(5, Math.floor(available / 4));

    let totalItems = 0;
    let maxItems = 0;
    if (focus === 'approvals') {
      totalItems =
        (snap.approvals?.pending.length ?? 0) +
        (snap.approvals?.recentlyResolved.length ?? 0);
      // Mirror `paintApprovalsPanel`: cap 4, item=2 rows, footer at h>=14.
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
      // Mirror `paintSopsAndPolicyPanel`: 3 items when h>=10, fewer otherwise.
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

  /**
   * Compute and store the bottom anchor for the given tab's `scrollOffset`.
   * Mirrors what `switchTab` and the Proxy reset path both need: set
   * `scrollOffset` to `max(0, allLines.length - scrollbackRows)` so the
   * baseline is correct when the user first scrolls up.
   *
   * Pure-ish: writes only to `this.state.views[tab].scrollOffset`.
   * Reads the live `ViewRenderContext` via the frame painter.
   */
  private resetScrollOffsetToBottom(tab: 'agent' | 'chat'): void {
    const ctx = this.framePainter.buildViewRenderContext(tab);
    this.state.views[tab].scrollOffset = computeBottomAnchor(ctx, tab);
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
      case 'scroll': {
        const tab = this.state.activeTab;
        const per = this.state.views[tab];
        const isAgentOrChat = tab === 'agent' || tab === 'chat';
        if (isAgentOrChat) {
          const ctx = this.framePainter.buildViewRenderContext(tab);
          const bottomAnchor = computeBottomAnchor(ctx, tab);
          const step = action.offset - per.scrollOffset;

          if (per.pinnedBottom && action.offset > 0) {
            // Scroll-up from pinned: capture bottomAnchor - step.
            // Invariant: per.scrollOffset is the baseline the view's handleKey
            // just incremented from (0 while pinned). onActivate, End, and
            // /clear must leave per.scrollOffset consistent with this baseline.
            per.scrollOffset = Math.max(0, bottomAnchor - step);
            per.pinnedBottom = false;
          } else if (!per.pinnedBottom) {
            // Scroll-up or scroll-down while unpinned: apply step (per spec §State
            // transitions — `scroll-up (unpinned) -= step`, `scroll-down (unpinned)
            // += step`). step is positive for ArrowUp (view returns scrollOffset+3)
            // and negative for ArrowDown (view returns scrollOffset-3); subtracting
            // it unifies both directions: ArrowUp shrinks offset (older content),
            // ArrowDown grows it (newer content). Clamp at bottomAnchor re-engages
            // pinnedBottom.
            const next = Math.max(0, Math.min(per.scrollOffset - step, bottomAnchor));
            per.scrollOffset = next;
            per.pinnedBottom = next === bottomAnchor;
          }
          // else (pinned && action.offset === 0): ArrowDown pressed while
          // already pinned — no-op, stays pinned.
          this.paintFullFrame();
          break;
        }
        // Other tabs (runtime, approvals): unchanged.
        per.scrollOffset = Math.max(0, action.offset);
        this.paintFullFrame();
        break;
      }
      case 'switchTab':
        this.switchTab(action.tab);
        break;
      case 'scheduleRefresh':
        void this.refresh();
        break;
      case 'resolveApproval':
        void this.approvalResolver.resolve(action.approvalId, action.status);
        break;
      case 'copyScrollback': {
        const text = this.collectVisibleTranscript(this.state.activeTab);
        if (!text) { this.paintFullFrame(); break; }
        const MAX_CLIPBOARD = 64 * 1024;
        const truncated = text.length > MAX_CLIPBOARD
          ? text.slice(0, MAX_CLIPBOARD) + '\n[truncated at 64 KB]'
          : text;
        const b64 = Buffer.from(truncated, 'utf8').toString('base64');
        this.output.write(`\x1b]52;;${b64}\x1b\\`);
        this.paintFullFrame();
        break;
      }
    }
  }


  /**
   * Handle a chunk of bracketed paste data. Returns true if the chunk was
   * consumed by the paste state machine (caller should not further process
   * the buffer), false if it's a normal keypress.
   *
   * Bracketed paste mode envelopes pasted text between:
   *   \x1b[200~  (paste start)
   *   \x1b[201~  (paste end)
   * This lets the application distinguish typed input from pasted text.
   */
  private handlePaste(buf: Buffer): boolean {
    const s = buf.toString('utf8');
    const endBuf = Buffer.from('\x1b[201~');
    const startMarker = '\x1b[200~';

    // Detect paste START marker. Some terminals send the start marker
    // concatenated with data (and sometimes even the end marker) in a
    // single buffer — startsWith handles the first case.
    if (s.startsWith(startMarker)) {
      this.pasteState = 'reading';
      this.pasteChunks = [];
      // If there's trailing data after the marker, push it as the first
      // chunk, then immediately scan that chunk for the end marker.
      // Terminals that send start+data+end in one buffer must be handled
      // here — without this scan, the end marker sits undetected in the
      // first chunk and every subsequent keystroke gets eaten as "paste."
      if (s.length > startMarker.length) {
        const rest = buf.subarray(startMarker.length);
        const endIdx = rest.indexOf(endBuf);
        if (endIdx >= 0) {
          if (endIdx > 0) {
            this.pasteChunks.push(rest.subarray(0, endIdx));
          }
          this.flushPaste();
        } else {
          this.pasteChunks.push(rest);
        }
      }
      return true;
    }

    if (this.pasteState !== 'reading') return false;
    // Detect the paste-end marker using byte-level indexOf so multi-byte
    // UTF-8 content immediately before the terminator doesn't cause a
    // string-index/byte-offset mismatch (the spec mandates byte-level
    // detection for this reason).
    const endIdx = buf.indexOf(endBuf);
    if (endIdx >= 0) {
      if (endIdx > 0) {
        this.pasteChunks.push(buf.subarray(0, endIdx));
      }
      this.flushPaste();
      return true;
    }
    this.pasteChunks.push(buf);
    return true;
  }

  /**
   * Flush accumulated paste chunks into the active tab's input buffer.
   * Normalises Windows CRLF line endings to Unix LF.
   */
  private flushPaste(): void {
    const decoder = new TextDecoder('utf8');
    const text = decoder.decode(Buffer.concat(this.pasteChunks)).replace(/\r\n?/g, '\n');
    this.pasteState = 'idle';
    this.pasteChunks = [];
    if (!text) return;
    const perTab = this.state.views[this.state.activeTab];
    perTab.inputBuffer += text;
    this.paintFullFrame();
  }

  /**
   * Collect the visible transcript for a tab — the log-projected timeline
   * (interleaved prompts, responses, and capability completions) — formatted
   * for clipboard copy.
   *
   * Reads the sub-session's `RuntimeSnapshot.timeline` (the EventLog
   * projection, already session-scoped and ordered by firstSequence) — the
   * same source ChatView/AgentView render. Chat entries render as `→`/`←`
   * to match the scrollback; capability completions arrive as `chat.response`
   * entries carrying their status text. Tabs without a sub-session collector
   * (dashboard, daemon, ...) have no projection and copy nothing.
   */
  private collectVisibleTranscript(tab: TabId): string {
    const runtime = tab === 'chat' ? this.chatRuntime : tab === 'agent' ? this.agentRuntime : null;
    const lines: string[] = [];
    for (const e of runtime?.timeline ?? []) {
      if (e.kind === 'chat.message') lines.push(`→ ${e.text ?? ''}`);
      // Operator's typed prompt on the agent tab lands `agent.message` with
      // actor 'user' — copy it as the operator's turn (→), mirroring the view.
      else if (e.kind === 'agent.message' && e.actor === 'user') lines.push(`→ ${e.text ?? ''}`);
      else if (e.kind === 'chat.response' || e.kind.startsWith('agent.')) lines.push(`← ${e.text ?? ''}`);
    }
    return lines.join('\n');
  }

  /** Build a complete frame containing all regions and write it to stdout. */
  private paintFullFrame(): void {
    this.framePainter.paintFullFrame();
  }

  private async cleanupSync(): Promise<void> {
    this.terminal.disableTerminalModes();
    this.inputCleanup?.();
    this.resizeCleanup?.();
  }
}

function parseKey(buf: Buffer): string | null {
  if (buf.length === 0) return null;
  const s = buf.toString('utf8');
  if (s === '\r' || s === '\n') return 'Enter';
  if (s === '\t') return 'Tab';
  if (s === '\x0c') return 'Ctrl+l';
  if (s === '\x10') return 'Ctrl+p';   // Ctrl+P — command palette
  if (s === '\x7f' || s === '\b') return 'Backspace';
  // Ctrl+digit: terminals reliably encode these as ESC + digit (the
  // standard "Alt+digit" sequence doubles as "Ctrl+digit" for tab
  // jumping — see xterm, iTerm2, ghostty, kitty). Parse the escape
  // prefix and surface as 'Ctrl+N' so the navigation layer can match.
  if (s.length === 2 && s[0] === '\x1b' && s[1] >= '0' && s[1] <= '9') {
    return `Ctrl+${s[1]}`;
  }
  // Alt+letter: terminals send ESC + letter. This handles Ctrl+letter
  // combinations too — most terminals encode them identically. The paste
  // bracketing sequences (\x1b[200~ / \x1b[201~) are longer so they
  // don't match length-2.
  if (s.length === 2 && s[0] === '\x1b' && s[1] >= 'a' && s[1] <= 'z') {
    return `Alt+${s[1]}`;
  }
  // Alt+uppercase: same ESC prefix but with an uppercase letter.
  if (s.length === 2 && s[0] === '\x1b' && s[1] >= 'A' && s[1] <= 'Z') {
    return `Alt+${s[1].toLowerCase()}`;
  }
  if (buf[0] === 0x1b && buf.length >= 3 && buf[1] === 0x5b /* [ */) {
    if (buf[2] === 0x41) return 'ArrowUp';
    if (buf[2] === 0x42) return 'ArrowDown';
    if (buf[2] === 0x43) return 'ArrowRight';
    if (buf[2] === 0x44) return 'ArrowLeft';
    if (buf[2] === 0x46) return 'End';
    if (buf[2] === 0x5a) return 'Shift+Tab';
  }
  if (s.length === 1) return s;
  return null;
}

/**
 * Map a single-character keypress to a plan decision when the gate is
 * pending. Returns null for any other key — the caller falls through to
 * the normal input-capture path.
 *
 * Case-insensitive: terminals in raw mode can emit uppercase or lowercase
 * depending on Shift/Caps state. Treating both the same is intentional —
 * the prompt in the card lists "Y/n/e/d" so the operator expects either.
 */
function mapKeyToPlanDecision(key: string): PlanDecision | null {
  switch (key) {
    case 'y':
    case 'Y':
      return 'approve';
    case 'n':
    case 'N':
      return 'reject';
    case 'e':
    case 'E':
      return 'edit';
    case 'd':
    case 'D':
      return 'detail';
    default:
      return null;
  }
}
