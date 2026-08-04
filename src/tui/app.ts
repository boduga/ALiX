import type { PanelFocusId, PanelScrollOffsets, PerTabState, TabId, TuiAppState } from './state.js';
import { createInitialTuiAppState, SessionPhase } from './state.js';
import type { DashboardSnapshot, RuntimeSnapshot } from './snapshot.js';
import type { EventLog } from '../events/event-log.js';
import type { RuntimeCollector } from './runtime-collector.js';
import type { ViewAction, ViewRenderContext, ViewInputContext, TuiView, TerminalDimensions, SlashStrip, SlashStripEntry } from './views/types.js';
import { parseSlashInput, rankSkillMatches, canonicalSkillId, skillSlashNames } from '../skills/slash.js';
import { getSlashCatalog } from '../skills/slash-catalog.js';
import { getTheme } from './blocks/theme.js';
import { getView } from './views/index.js';
import { TuiRenderer } from './render.js';
import type { SnapshotBuilder } from './snapshot-builder.js';
import type { DaemonMetricsCollector } from './daemon-metrics-collector.js';
import type { AgentSession } from '../agent/session.js';
import { Navigation } from './navigation.js';
import { createTerminalControl, type TerminalControl } from './terminal-control.js';
import { TerminalCanvas } from './canvas.js';
import { DEFAULT_PANEL_H } from './dashboard-renderer.js';
import { TuiPlanApprovalGate } from './plan-approval-gate.js';
import type { PlanDecision } from '../run/plan-approval-gate.js';
import type { PlanTask } from '../planning/plan-task.js';
import type { IInput, IOutput } from './io.js';
import { StdioInput, StdioOutput } from './io.js';
import { KeyDispatcher } from './key-dispatcher.js';
import { PaletteModal } from './capabilities/palette.js';
import { getCapabilityService } from './capabilities/capability-service.js';
import { ChatInvocationPresenter } from './capabilities/invocation-presenter.js';
import type { CapabilityEmitContext } from './capabilities/invocation-presenter.js';
import { appendLogEntry } from './log-emit.js';

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

const TAB_ORDER: readonly TabId[] = ['dashboard', 'chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy', 'capabilities'];

/**
 * Narrow writable view of a tab's per-tab state that the shared submit path
 * is allowed to mutate. dispatchToSession only appends to the operator
 * timeline and resets plan/scroll fields — it never needs the full
 * PerTabState, so this type keeps the function honest about its surface.
 */
type TimelineWritableState = Pick<PerTabState, 'planContent' | 'planTasks' | 'scrollOffset'>;

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
  private readonly palette = new PaletteModal();
  private paletteOpen = false;
  private paletteQuery = '';
  /** Resolved installed-skill manifests for slash completion (cached). */
  private slashManifests: any[] = [];
  /** Index of the highlighted strip candidate (Tab-cycled). */
  private slashSelection = 0;
  /** Inline hint for unknown commands. */
  private slashHint: string | null = null;

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

    // Bind the capability service's presenter so every invocation emits its
    // settled chat-surface entry into the chat sub-session's log projection
    // (Phase 6 — the EventLog is the single source of truth timeline; the
    // presenter no longer holds any per-tab state). The service's module
    // accessor is also set at bootstrap — the option is redundant but keeps
    // TuiApp usable standalone.
    if (this.opts.capabilityService) {
      const svc = this.opts.capabilityService;
      const presenter = new ChatInvocationPresenter(this.emitCtx(this.opts.chatSessionId));
      svc.setPresenter(presenter);
    }
  }

  /**
   * Build the emit context for a per-tab sessionId. Returns undefined when
   * no EventLog is wired (unit tests) or the sessionId is missing — the emit
   * is then a no-op (there is no in-memory timeline anymore).
   */
  private emitCtx(sessionId?: string): CapabilityEmitContext | undefined {
    if (!this.opts.eventLog || !sessionId) return undefined;
    return { eventLog: this.opts.eventLog, sessionId };
  }

  /**
   * Single-emit a chat-surface entry into the EventLog (Phase 6 D9 cleanup —
   * the EventLog is the single source of truth timeline; the per-tab
   * in-memory cache was removed). Maps the submit kind onto the log
   * vocabulary by DOMAIN (the sessionId is the tab discriminator):
   *   chat sub-session  → user → chat.message,  agent → chat.response
   *   agent sub-session → user → agent.message, agent → agent.response
   * The agent tab's own conversation (typed prompt + final summary) uses the
   * `agent.*` vocabulary so the agent view's `agent.*` filter renders it.
   * No-op when no EventLog or sub-session is wired (unit tests). Fire-and-forget
   * append — a log-write failure must not fail the input path (rejection is
   * caught; Node ≥15 would otherwise crash the TUI on an unhandled rejection).
   */
  private emitTimelineLog(kind: 'user' | 'agent', text: string, sessionId?: string): void {
    if (!this.opts.eventLog || !sessionId) return;
    const agentDomain = sessionId === this.opts.agentSessionId;
    const type = agentDomain
      ? (kind === 'user' ? 'agent.message' : 'agent.response')
      : (kind === 'user' ? 'chat.message' : 'chat.response');
    appendLogEntry(this.opts.eventLog, {
      sessionId,
      actor: kind === 'user' ? 'user' : 'agent',
      type,
      payload: { text },
    });
  }

  /** Session id stamped for emits landing on `tab`: the chat sub-session on
   *  the chat tab, the agent sub-session on the agent tab, and undefined on any
   *  other tab. Tabs without a sub-session (approvals, daemon, runtime, ...)
   *  have no collector to project their log entries, so their emits are
   *  no-ops. */
  private sessionIdForTab(tab: TabId): string | undefined {
    if (tab === 'chat') return this.opts.chatSessionId;
    if (tab === 'agent') return this.opts.agentSessionId;
    return undefined;
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
    void this.refreshSlashCatalog();

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
  getStateForTest(): TuiAppState { return this.state; }

  // Test seams (mirroring getStateForTest)
  get slashManifestsForTest(): any[] { return this.slashManifests; }
  set slashManifestsForTest(v: any[]) { this.slashManifests = v; }
  get slashHintForTest(): string | null { return this.slashHint; }
  get slashSelectionForTest(): number { return this.slashSelection; }

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
    void this.refreshSlashCatalog();
  }

  /**
   * Re-read the slash manifest catalog. The catalog is a generation-based
   * cache: `invalidateSlashCatalog()` (called by `alix skills install/remove`)
   * bumps the generation, so the next read here rebuilds after a CLI-side
   * mutation. Steady-state reads are pure in-memory (no IO when the
   * generation hasn't moved).
   */
  private refreshSlashCatalog(): Promise<void> {
    return getSlashCatalog().then((manifests) => {
      // Bail if the TUI was torn down between the catalog read and the
      // resolution — reassigning state on a detached instance is harmless
      // but pollutes the heap and races with stop()/cleanupSync().
      if (this.detached) return;
      this.slashManifests = manifests;
      if (this.state.activeTab === 'agent') this.paintFullFrame();
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
        // Reuse the targetPath that extractTarget populated.
        target: p.targetPath,
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

  /** True when the AGENT-tab input is a slash command in progress (agent only). */
  private slashActive(): boolean {
    if (this.state.activeTab !== 'agent') return false;
    const buf = this.state.views.agent.inputBuffer;
    return buf.startsWith('/') && buf.length > 1;
  }

  /** The current slash-command buffer, or null when not in slash mode (agent only). */
  private slashBuffer(): string | null {
    if (this.state.activeTab !== 'agent') return null;
    const buf = this.state.views.agent.inputBuffer;
    return buf.startsWith('/') && buf.length > 1 ? buf : null;
  }

  private cycleSlashSelection(delta: number): void {
    const strip = this.computeSlashStrip();
    if (!strip || strip.entries.length === 0) return;
    const n = strip.entries.length;
    this.slashSelection = (this.slashSelection + delta + n) % n;
  }

  /** Build the strip passed to views; also refreshes slashSelection bounds. */
  private computeSlashStrip(): SlashStrip | null {
    const buf = this.slashBuffer();
    if (!buf) { this.slashSelection = 0; this.slashHint = null; return null; }
    const parsed = parseSlashInput(buf);
    if (!parsed) { this.slashHint = null; return null; }
    const matches = rankSkillMatches(this.slashManifests, parsed.command);
    this.slashSelection = Math.min(this.slashSelection, Math.max(0, matches.length - 1));
    // Clear a stale hint whenever the buffer now matches a known skill — the
    // render branch is `if (hint) else if (entries)` so a stale hint would
    // hide the recovering candidate strip until submit/restart.
    if (matches.length > 0) this.slashHint = null;
    return {
      entries: matches.slice(0, 8).map((m): SlashStripEntry => ({
        name: m.name,
        label: skillSlashNames(m)[0] ?? `/${m.name}`,
        description: m.description,
      })),
      selected: this.slashSelection,
      hint: this.slashHint,
    };
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
    if (this.paletteOpen) {
      this.handlePaletteKey(key);
      return;
    }
    // Slash-command completion mode: Tab/Shift+Tab cycle strip selection.
    if (this.slashActive()) {
      if (key === 'Tab') { this.cycleSlashSelection(1); this.paintFullFrame(); return; }
      if (key === 'Shift+Tab') { this.cycleSlashSelection(-1); this.paintFullFrame(); return; }
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
          this.emitTimelineLog('user', perTab.inputBuffer, this.opts.chatSessionId);
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
        if (this.slashActive()) {
          void this.submitSlashCommand();
          this.paintFullFrame();
          return;
        }
        if (perTab.inputBuffer.trim().length > 0) {
          this.emitTimelineLog('user', perTab.inputBuffer, this.opts.agentSessionId);
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

    // ── Alt+C clipboard copy ────────────────────────────────────
    if (key === 'Alt+c') {
      this.dispatch({ type: 'copyScrollback' });
      return;
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
    const matches = rankSkillMatches(this.slashManifests, parsed.command);
    if (matches.length === 0) {
      this.slashHint = `Unknown skill "${parsed.command}" — press Tab for completions.`;
      return; // keep the text in the buffer; no agent call
    }
    const selected = matches[Math.min(this.slashSelection, matches.length - 1)]!;
    const text = parsed.rest.trim() || selected.name;
    this.slashHint = null;
    perTab.inputBuffer = '';
    this.slashSelection = 0;
    this.emitTimelineLog('user', text, this.opts.agentSessionId);
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
        break;
      } catch (err) {
        // Stderr is independent of the TUI render — even if paintFullFrame
        // fails for some reason, the operator sees the failure here.
        process.stderr.write(`[alix-tui] ${kind} submit error: ${err instanceof Error ? err.message : String(err)}\n`);
        summary = `(agent error: ${err instanceof Error ? err.message : String(err)})`;
        // Try the next candidate rather than giving up.
      }
    }
    // The single log emit stamps the sub-session that matches the submission
    // kind — chat submits route to the chat collector, agent submits to the
    // agent collector (Phase 6). The per-tab in-memory cache is gone.
    this.emitTimelineLog('agent', summary, kind === 'chat' ? this.opts.chatSessionId : this.opts.agentSessionId);
    perTab.scrollOffset = 0; // auto-scroll to bottom on new response
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
      if (this.opts.capabilityService || this.hasCapabilityService()) {
        this.paletteOpen = true;
        this.paletteQuery = '';
        this.palette.refresh('');
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
    const HEADER_H = 3;
    const FOOTER_H = 3;
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
    for (const t of this.SYNC_TABS) {
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
      for (const t of this.SYNC_TABS) {
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
   * Append a one-liner to the active view's operator timeline so the
   * resolution message shows in the scrollback.
   */
  private appendAgentMessage(
    tab: TabId,
    text: string,
  ): void {
    this.emitTimelineLog('agent', text, this.sessionIdForTab(tab));
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
  /**
   * Render the in-TUI plan approval card. No-op when no plan is pending.
   *
   * Layout (above the footer, inside the left canvas):
   *
   *   ╭─ PLAN APPROVAL REQUIRED ──────────────╮
   *   │ <plan summary, truncated to width-2>  │
   *   │ Y approve · n reject · e edit · d …  │
   *   ╰───────────────────────────────────────╯
   *
   * Four rows tall. The card overlays the active view's scrollback — the
   * agent view's scrollback ends at rows-18, well above the card's
   * rows-7..rows-4 range, so there's no overlap.
   */
  private paintPlanApprovalCard(
    canvas: TerminalCanvas,
    width: number,
    height: number,
    headerH: number,
    footerH: number,
  ): void {
    const pending = this.planApprovalGate.getPending();
    if (!pending) return;

    const CARD_H = 4;
    const cardY = height - footerH - CARD_H;
    // Leave one row of breathing room below the header band.
    if (cardY <= headerH + 1) return;

    const innerW = Math.max(0, width - 2);
    const summary = pending.planSummary.length > innerW - 2
      ? pending.planSummary.slice(0, innerW - 5) + '…'
      : pending.planSummary;
    const hint = 'Y approve · n reject · e edit · d detail';

    // Border + title row.
    const title = ' PLAN APPROVAL REQUIRED ';
    const titlePad = Math.max(0, innerW - title.length);
    const titleRow = '╭' + title + '─'.repeat(titlePad) + '╮';
    canvas.write(0, cardY, `\x1b[33m${titleRow}\x1b[0m`);

    // Summary row.
    canvas.write(0, cardY + 1, '\x1b[33m│\x1b[0m');
    canvas.write(1, cardY + 1, summary);
    canvas.write(1 + summary.length, cardY + 1, ' '.repeat(Math.max(0, innerW - 1 - summary.length)));
    canvas.write(width - 1, cardY + 1, '\x1b[33m│\x1b[0m');

    // Hint row.
    const hintRow = hint.length > innerW ? hint.slice(0, innerW) : hint;
    canvas.write(0, cardY + 2, '\x1b[33m│\x1b[0m');
    canvas.write(1, cardY + 2, hintRow);
    canvas.write(1 + hintRow.length, cardY + 2, ' '.repeat(Math.max(0, innerW - 1 - hintRow.length)));
    canvas.write(width - 1, cardY + 2, '\x1b[33m│\x1b[0m');

    // Bottom border.
    canvas.write(0, cardY + 3, '\x1b[33m' + '╰' + '─'.repeat(innerW) + '╯' + '\x1b[0m');
  }

  /** True when a CapabilityService is available via the module accessor. */
  private hasCapabilityService(): boolean {
    try { getCapabilityService(); return true; } catch { return false; }
  }

  /**
   * Route a key while the command palette is open. Escape closes; Enter
   * invokes the selected entry; arrows move the cursor; backspace and
   * printable characters edit the query. Every mutation refreshes the
   * entry list against the current query.
   */
  private handlePaletteKey(key: string): void {
    if (key === 'Escape') { this.paletteOpen = false; return; }
    // Ctrl+P toggles the palette closed while it is open — the modal owns
    // every key, so the global open-trigger never runs again until the
    // palette is dismissed.
    if (key === 'Ctrl+p') { this.paletteOpen = false; return; }
    // Ctrl+C always quits — same mechanism as tryHandleGlobal's ETX case.
    // The palette owns every key while open, so without this the raw ETX
    // byte would fall through to the text-append branch and silently pollute
    // the search query instead of terminating the TUI.
    if (key === '\x03') { process.exit(0); return; }
    if (key === 'Enter') {
      if (!this.palette.empty) {
        const entry = this.palette.selected();
        this.paletteOpen = false;
        entry.invoke();
      }
      return;
    }
    if (key === 'ArrowUp') { this.palette.move(-1); return; }
    if (key === 'ArrowDown') { this.palette.move(1); return; }
    if (key === 'Backspace') { this.paletteQuery = this.paletteQuery.slice(0, -1); }
    else if (key && key.length === 1) { this.paletteQuery += key; }
    this.palette.refresh(this.paletteQuery);
  }

  /**
   * Render the command palette as an overlay in the active view's canvas.
   * No-op when the palette is closed. Centered vertically, 12 rows tall,
   * with a query input line, the filtered entry list (windowed to fit),
   * and a highlight on the selected entry.
   */
  private paintPalette(canvas: TerminalCanvas, width: number, height: number, headerH: number, footerH: number): void {
    if (!this.paletteOpen) return;
    const PALETTE_H = 12;
    const y = Math.max(headerH + 1, Math.floor(height / 2) - Math.floor(PALETTE_H / 2));
    const innerW = Math.max(0, width - 4);
    canvas.drawBox(1, y, innerW, PALETTE_H, ' Command Palette (Ctrl+P) ', '\x1b[90m');
    canvas.write(3, y + 1, `\x1b[7m ${this.paletteQuery} \x1b[0m`);
    const list = this.palette.list;
    const rows = Math.max(0, PALETTE_H - 3);
    const start = Math.max(0, Math.min(this.palette.selectedIndex(), list.length - rows));
    for (let i = 0; i < Math.min(list.length, rows); i++) {
      const entry = list[start + i]!;
      const sel = start + i === this.palette.selectedIndex();
      const line = `${sel ? '› ' : '  '}${entry.title}${entry.subtitle ? `  \x1b[90m${entry.subtitle}\x1b[0m` : ''}`;
      canvas.write(3, y + 2 + i, (sel ? '\x1b[36m' : '') + line.slice(0, innerW - 4) + (sel ? '\x1b[0m' : ''));
    }
    if (list.length === 0) canvas.write(3, y + 2, '\x1b[90mNo capabilities found\x1b[0m');
  }

  private paintFullFrame(): void {
    if (!this.state.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    const FOOTER_H = 3;
    const HEADER_H = 3;

    // Render the active view into a canvas sized to the full terminal.
    // The dashboard tab consumes the entire body region (rows 3..rows-4)
    // with its 2x2 or stacked panel layout. Chat and agent get the full
    // width/height for their scrollback — the previous 75/25 split and
    // vertical divider are gone.
    const viewCanvas = new TerminalCanvas(dims.columns, dims.rows);
    const viewCtx: ViewRenderContext = {
      snap: this.state.lastSnapshot,
      dimensions: { columns: dims.columns, rows: dims.rows },
      perTab: this.state.views[this.state.activeTab],
      canvas: viewCanvas,
      themeName: this.opts.themeName,
      // Phase 6 (D6/D9): the chat/agent sub-session runtime snapshots, sampled
      // from the runtime collectors. ChatView/AgentView read their own tab's
      // `runtime.<tab>.timeline` projection.
      runtime: { chat: this.chatRuntime, agent: this.agentRuntime },
      slash: this.computeSlashStrip() ?? undefined,
    };
    this.views[this.state.activeTab]!.render(viewCtx);

    // Plan approval card — drawn into the same canvas as the active view.
    // Visible from any tab; the gate's keyboard handler makes the keys
    // available globally. Renders last so it overlays the view's
    // scrollback area (sits at rows-7..rows-4, which is inside the
    // expanded scrollback now — the card wins because it paints last).
    this.paintPlanApprovalCard(viewCanvas, dims.columns, dims.rows, HEADER_H, FOOTER_H);
    this.paintPalette(viewCanvas, dims.columns, dims.rows, HEADER_H, FOOTER_H);

    const c = new TerminalCanvas(dims.columns, dims.rows);
    const snap = this.state.lastSnapshot;
    const session = snap.session;

    // Header — top divider, content row, bottom divider (full width).
    // Row 0: top rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 0, `\x1b[90m─\x1b[0m`);
    // Row 1: left "ALiX TUI - Interactive Session" + right-aligned meta
    c.write(2, 1, `\x1b[32mALiX TUI\x1b[0m\x1b[1m - Interactive Session\x1b[0m`);
    const liveVersion: string | undefined =
      this.opts.agentSession?.getVersion?.();
    const version = liveVersion || session?.version || 'unknown';
    const liveSessionId: string | undefined =
      this.opts.agentSession?.getSessionId?.();
    const sessionDisplay = liveSessionId || '(no session)';
    const liveMode: 'auto' | 'ask' | 'bypass' | undefined =
      this.opts.agentSession?.getMode?.();
    const sessionMode = liveMode ?? session?.mode ?? 'auto';
    // Mode color: bypass = red (no safety), ask = green (cautious),
    // auto = orange (Claude-side heuristics). The colors signal the
    // operator's risk posture at a glance — bypass means "trust me",
    // ask means "stop and ask", auto means "let the model decide".
    const modeColor =
      sessionMode === 'bypass' ? '\x1b[31m' :
      sessionMode === 'ask' ? '\x1b[32m' :
      '\x1b[33m';
    const rightText = `\x1b[90mALiX v${version}  │  Session: ${sessionDisplay}  │  Mode: ${modeColor}${sessionMode}\x1b[0m`;
    const rightLen = `ALiX v${version}  │  Session: ${sessionDisplay}  │  Mode: ${sessionMode}`.length;
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
    const daemonLabel = snap.daemon === null
      ? `\x1b[90m○ stopped\x1b[0m`
      : snap.daemon.source === "daemon"
        ? `\x1b[32m● running\x1b[0m`
        : `\x1b[33m● this process\x1b[0m`;
    const sopCount = snap.sops?.totalLoaded ?? 0;
    const ruleCount = snap.policy?.rules.length ?? 0;
    const eventsCount = (snap.runtime?.totalEventCount ?? 0).toLocaleString('en-US');
    const fields = [
      'TOKENS: —',   // schema gap: DashboardSnapshot has no tokens field yet
      `FILES: ${snap.session?.filesTouched ?? 0}`,
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
