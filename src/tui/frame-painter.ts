import { TerminalCanvas, type CanvasRect } from './canvas.js';
import { visibleLen } from './box.js';
import { computeViewport, HEADER_H, FOOTER_H } from './views/scroll-math.js';
import { TAB_ORDER, type TabId, type TuiAppState } from './state.js';
import type { ViewRenderContext, SlashStrip, TerminalDimensions, TuiView } from './views/types.js';
import type { RuntimeSnapshot, DashboardSnapshot } from './snapshot.js';
import type { IOutput } from './io.js';
import type { AgentSession } from '../agent/session.js';
import { TuiPlanApprovalGate } from './plan-approval-gate.js';
import type { PaletteController } from './palette-controller.js';
import { projectOperatorShell } from './workbench/model/operator-shell.js';
import { paintOperatorShell } from './workbench/views/operator-shell.js';
import { layoutWorkbenchSurface } from './workbench/views/composer-view.js';
import type { WorkbenchUiState } from './workbench/model/ui-state.js';
import { paintWorkbenchApprovalDialog } from './workbench/views/approval-dialog.js';
import { buildWorkbenchScrollbackLines } from './workbench/views/workbench-scrollback.js';
import { reconcileWorkbenchScrollAnchor } from './workbench/layout/scroll-anchor.js';
import type { ScrollbackLine } from './views/bottom-anchored-viewport.js';
import { diffFrameRows, renderFramePatches } from './workbench/render/frame-differ.js';
import { buildAgentInspectorModel } from './workbench/model/agent-inspector.js';
import { paintAgentInspector } from './workbench/views/agent-inspector.js';
import { paintWorkbenchDiagnosticOverlay } from './workbench/views/diagnostic-overlay.js';
import { paintCoordinationEntry } from './workbench/views/coordination-entry.js';

/** Everything FramePainter reads from TuiApp — a narrow seam so it never
 *  reaches into the god class. */
export interface FramePainterDeps {
  state: () => TuiAppState;
  views: () => Record<TabId, TuiView>;
  opts: {
    themeName?: string;
    agentSession?: AgentSession;
    workbenchEnabled?: boolean;
  };
  chatRuntime: () => RuntimeSnapshot | null;
  agentRuntime: () => RuntimeSnapshot | null;
  computeSlashStrip: () => SlashStrip | null;
  planApprovalGate: TuiPlanApprovalGate;
  output: IOutput;
  palette: PaletteController;
  workbenchState?: () => WorkbenchUiState;
}

/** Owns the full-frame render — active view, plan-approval card, palette
 *  overlay, header, tabs, status row, and cursor placement. Read-only over
 *  the state/views/runtimes supplied through deps. */
export class FramePainter {
  /** Presentation-only wrapped overlay bound, refreshed on each frame. */
  overlayScrollLimit = 0;
  private coordinationCaret?: { row: number; column: number };
  private previousWorkbenchFrame: string | null = null;
  private scrollAnchor: { lines: readonly ScrollbackLine[]; requestedOffset: number; resolvedOffset: number; scope: string } | null = null;
  private pausedTranscript: { scope: string; seen: Set<string>; appended: Set<string> } | null = null;

  constructor(private readonly deps: FramePainterDeps) {}

  /**
   * Build a `ViewRenderContext` for the given tab with the same dimensions
   * and runtime the renderer would consume. Used by the scroll-math path to
   * compute `bottomAnchor` at key-press time without invoking a render.
   */
  buildViewRenderContext(tab: TabId): ViewRenderContext {
    return {
      snap: this.deps.state().lastSnapshot as DashboardSnapshot,
      dimensions: { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 },
      perTab: this.deps.state().views[tab]!,
      themeName: this.deps.opts.themeName,
      workbenchEnabled: this.deps.opts.workbenchEnabled,
      workbenchUiState: this.deps.workbenchState?.(),
      runtime: { chat: this.deps.chatRuntime(), agent: this.deps.agentRuntime() },
    };
  }

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
  paintPlanApprovalCard(rect: CanvasRect): void {
    const { canvas, width, height, headerH, footerH } = rect;
    const pending = this.deps.planApprovalGate.getPending();
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

  /** Build a complete frame containing all regions and write it to stdout. */
  paintFullFrame(): void {
    this.coordinationCaret = undefined;
    const s = this.deps.state();
    if (!s.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };

    // Render the active view into a canvas sized to the full terminal.
    // The dashboard tab consumes the entire body region (rows 3..rows-4)
    // with its 2x2 or stacked panel layout. Chat and agent get the full
    // width/height for their scrollback — the previous 75/25 split and
    // vertical divider are gone.
    const viewCanvas = new TerminalCanvas(dims.columns, dims.rows);
    let viewCtx: ViewRenderContext = {
      snap: s.lastSnapshot,
      dimensions: { columns: dims.columns, rows: dims.rows },
      perTab: s.views[s.activeTab],
      canvas: viewCanvas,
      themeName: this.deps.opts.themeName,
      workbenchEnabled: this.deps.opts.workbenchEnabled,
      workbenchUiState: this.deps.workbenchState?.(),
      // Phase 6 (D6/D9): the chat/agent sub-session runtime snapshots, sampled
      // from the runtime collectors. ChatView/AgentView read their own tab's
      // `runtime.<tab>.timeline` projection.
      runtime: { chat: this.deps.chatRuntime(), agent: this.deps.agentRuntime() },
      slash: this.deps.computeSlashStrip() ?? undefined,
    };
    if (this.deps.opts.workbenchEnabled && s.activeTab === 'agent') {
      const surface = layoutWorkbenchSurface(viewCtx.perTab.inputBuffer, dims, viewCtx.workbenchUiState?.drawer ?? 'closed', viewCtx.workbenchUiState?.composer.cursor);
      const state = viewCtx.workbenchUiState;
      const scope = JSON.stringify([state?.transcriptScope, state?.transcriptScope === 'selected' ? state.selectedAgentId : undefined, state?.transcriptFilter, viewCtx.perTab.transcriptMode]);
      const followTail = state?.followTail ?? viewCtx.perTab.pinnedBottom;
      viewCtx = { ...viewCtx, perTab: { ...viewCtx.perTab, pinnedBottom: followTail } };
      if (followTail) { this.scrollAnchor = null; this.pausedTranscript = null; }
      else if (surface.geometry.regions.transcriptBody.height > 0) {
        const lines = buildWorkbenchScrollbackLines(viewCtx, Math.max(1, surface.geometry.dimensions.columns - 2));
        const requestedOffset = viewCtx.perTab.scrollOffset;
        const previous = this.scrollAnchor;
        const resolvedOffset = previous
          ? requestedOffset === previous.requestedOffset
            ? reconcileWorkbenchScrollAnchor(previous.lines, previous.resolvedOffset, lines)
            : Math.max(0, Math.min(lines.length - 1, previous.resolvedOffset + requestedOffset - previous.requestedOffset))
          : requestedOffset;
        this.scrollAnchor = { lines, requestedOffset, resolvedOffset, scope };
        const ids = new Set(lines.flatMap(line => line.itemId && !/^(separator:|scope:|activity:|streaming:)/.test(line.itemId) ? [line.itemId] : []));
        if (!this.pausedTranscript || this.pausedTranscript.scope !== scope) this.pausedTranscript = { scope, seen: ids, appended: new Set() };
        else for (const id of ids) if (!this.pausedTranscript.seen.has(id)) {
          this.pausedTranscript.seen.add(id);
          this.pausedTranscript.appended.add(id);
        }
        viewCtx = { ...viewCtx, workbenchLines: lines, workbenchNewItems: this.pausedTranscript.appended.size, perTab: { ...viewCtx.perTab, scrollOffset: resolvedOffset } };
      }
    } else { this.scrollAnchor = null; this.pausedTranscript = null; }
    this.deps.views()[s.activeTab]!.render(viewCtx);

    // Plan approval card — drawn into the same canvas as the active view.
    // Visible from any tab; the gate's keyboard handler makes the keys
    // available globally. Renders last so it overlays the view's
    // scrollback area (the card sits inside the expanded 5-row footer
    // region — the card wins because it paints last).
    const rect: CanvasRect = { canvas: viewCanvas, width: dims.columns, height: dims.rows, headerH: HEADER_H, footerH: FOOTER_H };
    if (this.deps.opts.workbenchEnabled && s.activeTab === 'agent') {
      const workbench = this.deps.workbenchState?.();
      const overlayBody = layoutWorkbenchSurface(s.views.agent.inputBuffer, dims, workbench?.drawer ?? 'closed', workbench?.composer.cursor).geometry.regions.body;
      const overlayRect: CanvasRect = { ...rect, headerH: overlayBody.y, footerH: 0, height: Math.max(0, overlayBody.y + overlayBody.height - 1) };
      this.overlayScrollLimit = 0;
      if (workbench?.overlayStack.at(-1) === 'inspector') {
        const { geometry } = layoutWorkbenchSurface(s.views.agent.inputBuffer, dims, workbench.drawer, workbench.composer.cursor);
        const body = geometry.regions.body;
        for (let row = body.y; row < body.y + body.height; row++) viewCanvas.write(0, row, ' '.repeat(body.width));
        paintAgentInspector(viewCanvas, body, buildAgentInspectorModel(s.lastSnapshot, workbench));
      } else if (workbench?.overlayStack.at(-1) === 'coordination') {
        this.coordinationCaret = paintCoordinationEntry(overlayRect, workbench.coordination,
          this.deps.opts.agentSession?.getMode?.() ?? 'mode unavailable');
      } else this.overlayScrollLimit = paintWorkbenchDiagnosticOverlay(
        overlayRect,
        workbench?.overlayStack[workbench.overlayStack.length - 1],
        s.lastSnapshot.runtime?.diffs,
        {
          scrollOffset: workbench?.overlayScrollOffset,
          agents: s.lastSnapshot.runtime?.agents,
          tasks: s.lastSnapshot.runtime?.tasks,
          artifacts: s.lastSnapshot.runtime?.artifacts,
          selectedRunId: workbench?.selectedRunId,
          selectedAgentId: workbench?.selectedAgentId,
          selectedTaskId: workbench?.selectedTaskId,
        },
      );
    }
    if (this.deps.opts.workbenchEnabled && s.activeTab === 'agent' && this.deps.workbenchState?.().overlayStack.length) {
      const pending = s.views.agent.pendingApprovals.length ? s.views.agent.pendingApprovals : s.lastSnapshot.approvals?.pending ?? [];
      const body = layoutWorkbenchSurface(s.views.agent.inputBuffer, dims, this.deps.workbenchState?.().drawer ?? 'closed').geometry.regions.body;
      const approvalRect = { ...rect, headerH: body.y, footerH: 0, height: Math.max(0, body.y + body.height - 1) };
      paintWorkbenchApprovalDialog(approvalRect, pending[0], pending.length, s.lastSnapshot.generatedAt);
    }
    if (this.deps.opts.workbenchEnabled && s.activeTab !== 'agent') {
      paintWorkbenchApprovalDialog(
        rect,
        s.lastSnapshot.approvals?.pending[0],
        s.lastSnapshot.approvals?.totalPending ?? 0,
        s.lastSnapshot.generatedAt,
      );
    }
    this.paintPlanApprovalCard(rect);
    this.deps.palette.paint(rect);

    const c = new TerminalCanvas(dims.columns, dims.rows);
    const snap = s.lastSnapshot;
    const session = snap.session;

    // Header — top divider, content row, bottom divider (full width).
    // Row 0: top rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 0, `\x1b[90m─\x1b[0m`);
    // Row 1: left "ALiX TUI - Interactive Session" + centered tabs + right-aligned meta
    c.write(2, 1, `\x1b[32mALiX TUI\x1b[0m\x1b[1m - Interactive Session\x1b[0m`);
    const liveVersion: string | undefined =
      this.deps.opts.agentSession?.getVersion?.();
    const version = liveVersion || session?.version || 'unknown';
    const liveSessionId: string | undefined =
      this.deps.opts.agentSession?.getSessionId?.();
    const sessionDisplay = liveSessionId || '(no session)';
    const liveMode: 'auto' | 'ask' | 'bypass' | undefined =
      this.deps.opts.agentSession?.getMode?.();
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

    // Centered tab row (rendered onto row 1, between left and right metadata).
    // Visible width excludes ANSI escape sequences.
    let tabText = '';
    for (const id of TAB_ORDER) {
      const active = id === s.activeTab;
      tabText += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
    }
    const tabWidth = visibleLen(tabText);
    // Reserve a 1-col gap before right metadata to avoid visual collision.
    const rightEdgeLimit = dims.columns - rightLen - 1;
    let tabCol: number;
    if (2 + tabWidth <= rightEdgeLimit) {
      tabCol = Math.max(2, Math.floor((dims.columns - tabWidth) / 2));
    } else {
      // Collision: truncate tabs with … to keep right metadata intact.
      // Rebuild from TAB_ORDER tracking visible width, stop before budget.
      // -1 reserves the trailing ellipsis char.
      const allowedWidth = Math.max(0, rightEdgeLimit - 2 - 1);
      let truncated = '';
      let acc = 0;
      for (const id of TAB_ORDER) {
        const active = id === s.activeTab;
        // Inactive `  ${id}  ` = id.length + 4 visible chars.
        // Active ` \x1b[7m ${id} \x1b[0m` = id.length + 3 visible chars.
        const segWidth = id.length + (active ? 3 : 4);
        if (acc + segWidth > allowedWidth) break;
        truncated += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
        acc += segWidth;
      }
      tabText = acc > 0 ? `${truncated}…` : '';
      tabCol = 2;
    }
    c.write(tabCol, 1, tabText);

    c.write(Math.max(2, dims.columns - rightLen), 1, rightText);
    // Row 2: bottom rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 2, `\x1b[90m─\x1b[0m`);

    // Blit the view canvas into the main canvas at offset (0, 0).
    c.blit(viewCanvas, 0, 0);

    // Tabs row + key-hint suffix. Tabs moved to header (row 1, centered);
    // hints overlay the top border (row 0), right-aligned, in dim grey
    // over the existing ─ rule.
    const tabHintsVisible = '↑/↓ navigate   |   tab next   |   ? help   |   q quit';
    const hintsLen = tabHintsVisible.length;
    c.write(Math.max(0, dims.columns - hintsLen), 0, `\x1b[90m${tabHintsVisible}\x1b[0m`);

    // Status row — pipeline fields (right-aligned) + pending-approval banner
    // (left) when the agent tab has one or more pending approvals. The
    // phase radio strip (spec #429, ticket #433) was retired; stage
    // information now lives in the agent scrollback gutter (slice #432).
    // The pending banner (slice #7, ticket #436) takes the vacated left
    // side and names the tool/target the approve/deny keys act on, so
    // the operator is never asked to act blind.
    const sep = `\x1b[90m|\x1b[0m`;
    const daemonLabel = snap.daemon === null
      ? `\x1b[90m○ stopped\x1b[0m`
      : snap.daemon.source === "daemon"
        ? `\x1b[32m● running\x1b[0m`
        : `\x1b[33m● this process\x1b[0m`;
    const sopCount = snap.sops?.totalLoaded ?? 0;
    const ruleCount = snap.policy?.rules.length ?? 0;
    const eventsCount = (snap.runtime?.totalEventCount ?? 0).toLocaleString('en-US');
    // Tokens flow task-loop's `model.usage` events → outer RuntimeCollector →
    // MetricsProjection → snap.runtime.metrics.tokensUsed (same path EVENTS
    // rides). Used-only: there is no live per-session max source — the store's
    // 62000 is a hardcoded default, and config tokenBudget is a per-tool
    // ToolConfig, not a session context limit.
    const tokensUsed = (snap.runtime?.metrics?.tokensUsed ?? 0).toLocaleString('en-US');
    const fields = [
      `TOKENS: ${tokensUsed}`,
      `FILES: ${snap.session?.filesTouched ?? 0}`,
      `DAEMON: ${daemonLabel}`,
      `SOPS: ${sopCount}`,
      `RULES: ${ruleCount}`,
      `EVENTS: ${eventsCount}`,
    ];
    const fieldsText = fields.join(` ${sep} `);
    const fieldsLen = visibleLen(fieldsText);
    // #436 — pending-approval banner. AC#2: renders whenever one or more
    // approvals are pending, on ANY active tab — the status row is shared
    // chrome, and a pending approval is a global operator signal. Reads the
    // agent tab's snapshot-derived pending list (the oldest entry is the same
    // one the agent tab's `a`/`d` keys resolve). With multiple queued, the
    // banner shows the oldest explicitly. Disappears when the list is empty.
    // On a terminal too narrow for both, the banner is kept and the pipeline
    // counters yield.
    const pending = s.views.agent.pendingApprovals ?? [];
    if (pending.length > 0) {
      const oldest = pending[0]!;
      const oldestLabel = oldest.toolName && oldest.target
        ? `${oldest.toolName} ${oldest.target}`
        : oldest.toolName || oldest.target || oldest.id;
      const oldestPrefix = pending.length > 1 ? 'oldest — ' : '';
      // The `a`/`d` hint is only shown on the agent tab — the keys only
      // resolve there (app.ts handleRaw `if (tab === 'agent')`). On other
      // tabs the banner is informational only, so advertising keys that
      // won't respond would be misleading.
      const keyHint = s.activeTab === 'agent' ? `a/d: ${oldestPrefix}${oldestLabel}` : `${oldestPrefix}${oldestLabel}`;
      const banner = `⏸ ${pending.length} pending — ${keyHint}`;
      const bannerText = `\x1b[33m${banner}\x1b[0m`;
      const bannerLen = visibleLen(bannerText);
      c.write(2, dims.rows - 1, bannerText);
      // Place pipeline fields to the right of the banner, but yield if
      // there isn't room. The banner is actionable; the counters are
      // ambient.
      const fieldsStart = 2 + bannerLen + 2; // 2-col gutter + banner + 2-col gap
      const fieldsEnd = dims.columns - 2;
      if (fieldsEnd - fieldsStart >= fieldsLen) {
        c.write(fieldsStart, dims.rows - 1, fieldsText);
      }
    } else {
      // No approvals pending — right-align the pipeline fields as before.
      // Left side stays empty (ticket #433); row is quiet by default.
      c.write(Math.max(2, dims.columns - fieldsLen), dims.rows - 1, fieldsText);
    }

    // The Agent Workbench owns its frame chrome as well as its transcript.
    // Paint last so the feature-gated shell replaces the legacy dashboard
    // banner and status counters without changing shared viewport geometry.
    // Other tabs and non-Workbench sessions keep the established chrome.
    if (this.deps.opts.workbenchEnabled && s.activeTab === 'agent') {
      const chromeState = this.deps.workbenchState?.();
      paintOperatorShell({
        canvas: c,
        width: dims.columns,
        height: dims.rows,
        model: projectOperatorShell(
          snap,
          s.views.agent,
          liveMode,
          chromeState?.queuedMessages.length ?? 0,
          { closeSurface: Boolean(chromeState && (chromeState.drawer !== 'closed' || chromeState.overlayStack.length > 0)), focus: chromeState?.focus, drawer: chromeState?.drawer, inspectorOpen: chromeState?.overlayStack.at(-1) === 'inspector' },
        ),
      });
    }

    if (this.deps.opts.workbenchEnabled && s.activeTab === 'agent' && dims.rows < 8) {
      // Tiny windows reserve their editable region after global chrome composition.
      const { geometry } = layoutWorkbenchSurface(s.views.agent.inputBuffer, dims, this.deps.workbenchState?.().drawer ?? 'closed', this.deps.workbenchState?.().composer.cursor);
      const rows = viewCanvas.renderFrame().split('\n');
      const composer = geometry.regions.composer;
      for (let row = composer.y; row < composer.y + composer.height; row++) c.write(0, row, rows[row] ?? '');
    }

    const renderedFrame = c.renderFrame();
    if (this.deps.opts.workbenchEnabled && s.activeTab === 'agent') {
      const patches = diffFrameRows(this.previousWorkbenchFrame, renderedFrame);
      if (patches.length > 0) this.deps.output.write(renderFramePatches(patches));
      this.previousWorkbenchFrame = renderedFrame;
    } else {
      this.previousWorkbenchFrame = null;
      this.deps.output.write('\x1b[H' + renderedFrame);
    }

    // Place the terminal cursor at the active tab's input prompt position.
    // Without this the cursor sits at the bottom of the screen (blinking
    // on top of the status line) while typed text accumulates in the
    // buffer, creating both an invisible-typing experience and a visual
    // "flash" on every keypress as the full frame redraw overwrites the
    // cursor area.
    if (s.activeTab === 'chat') {
      // Bottom-anchored panel: prompt row = dims.rows - FOOTER_H(3) - 1.
      // ANSI cursor addresses are 1-based, so panelRow+1. promptCol (7) is
      // the post-`alix>` cursor position (mirrors `PROMPT_COL=7` in
      // ChatView.render); the `+bufLen+1` term tracks the typed buffer
      // length so the cursor rides at the end of any typed text.
      const bufLen = s.views.chat.inputBuffer.length;
      const vp = computeViewport(dims, 'chat');
      this.deps.output.write(`\x1b[${vp.panelRow + 1};${vp.promptCol + bufLen + 1}H`);
    } else if (s.activeTab === 'agent') {
      // Bottom-anchored panel: prompt row = dims.rows - FOOTER_H(3) - 1.
      // ANSI cursor addresses are 1-based, so panelRow+1. promptCol (13)
      // mirrors `PROMPT_COL` in AgentView.render.
      if (this.deps.opts.workbenchEnabled) {
        const pending = s.views.agent.pendingApprovals.length || s.lastSnapshot?.approvals?.pending.length
          || this.deps.planApprovalGate.getPending();
        if (this.coordinationCaret && !pending) {
          this.deps.output.write(`\x1b[${this.coordinationCaret.row + 1};${this.coordinationCaret.column + 1}H`);
          return;
        }
        const { composer, geometry } = layoutWorkbenchSurface(
          s.views.agent.inputBuffer, dims,
          this.deps.workbenchState?.().drawer ?? 'closed',
          this.deps.workbenchState?.().composer.cursor,
        );
        const firstRow = geometry.regions.composerContent.y;
        const column = Math.min(geometry.regions.composer.width - 1, geometry.composerPrefixWidth + composer.cursorColumn);
        this.deps.output.write(`\x1b[${firstRow + composer.cursorRow + 1};${column + 1}H`);
      } else {
        const bufLen = s.views.agent.inputBuffer.length;
        const vp = computeViewport(dims, 'agent');
        this.deps.output.write(`\x1b[${vp.panelRow + 1};${vp.promptCol + bufLen + 1}H`);
      }
    } else {
      // Non-input tabs (dashboard, daemon, approvals, runtime, sops,
      // policy): move cursor to a safe column (row 4, col 1) so it
      // doesn't blink on top of the status line.
      this.deps.output.write(`\x1b[5;1H`);
    }
  }
}
