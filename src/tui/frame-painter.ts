import { TerminalCanvas, type CanvasRect } from './canvas.js';
import { computeViewport, HEADER_H, FOOTER_H } from './views/scroll-math.js';
import { SessionPhase, TAB_ORDER, type TabId, type TuiAppState } from './state.js';
import type { ViewRenderContext, SlashStrip, TerminalDimensions, TuiView } from './views/types.js';
import type { RuntimeSnapshot, DashboardSnapshot } from './snapshot.js';
import type { IOutput } from './io.js';
import type { AgentSession } from '../agent/session.js';
import { TuiPlanApprovalGate } from './plan-approval-gate.js';
import type { PaletteController } from './palette-controller.js';

/** Everything FramePainter reads from TuiApp — a narrow seam so it never
 *  reaches into the god class. */
export interface FramePainterDeps {
  state: () => TuiAppState;
  views: () => Record<TabId, TuiView>;
  opts: {
    themeName?: string;
    agentSession?: AgentSession;
  };
  chatRuntime: () => RuntimeSnapshot | null;
  agentRuntime: () => RuntimeSnapshot | null;
  computeSlashStrip: () => SlashStrip | null;
  planApprovalGate: TuiPlanApprovalGate;
  output: IOutput;
  palette: PaletteController;
}

/** Owns the full-frame render — active view, plan-approval card, palette
 *  overlay, header, tabs, status row, and cursor placement. Read-only over
 *  the state/views/runtimes supplied through deps. */
export class FramePainter {
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
    const s = this.deps.state();
    if (!s.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };

    // Render the active view into a canvas sized to the full terminal.
    // The dashboard tab consumes the entire body region (rows 3..rows-4)
    // with its 2x2 or stacked panel layout. Chat and agent get the full
    // width/height for their scrollback — the previous 75/25 split and
    // vertical divider are gone.
    const viewCanvas = new TerminalCanvas(dims.columns, dims.rows);
    const viewCtx: ViewRenderContext = {
      snap: s.lastSnapshot,
      dimensions: { columns: dims.columns, rows: dims.rows },
      perTab: s.views[s.activeTab],
      canvas: viewCanvas,
      themeName: this.deps.opts.themeName,
      // Phase 6 (D6/D9): the chat/agent sub-session runtime snapshots, sampled
      // from the runtime collectors. ChatView/AgentView read their own tab's
      // `runtime.<tab>.timeline` projection.
      runtime: { chat: this.deps.chatRuntime(), agent: this.deps.agentRuntime() },
      slash: this.deps.computeSlashStrip() ?? undefined,
    };
    this.deps.views()[s.activeTab]!.render(viewCtx);

    // Plan approval card — drawn into the same canvas as the active view.
    // Visible from any tab; the gate's keyboard handler makes the keys
    // available globally. Renders last so it overlays the view's
    // scrollback area (the card sits inside the expanded 5-row footer
    // region — the card wins because it paints last).
    const rect: CanvasRect = { canvas: viewCanvas, width: dims.columns, height: dims.rows, headerH: HEADER_H, footerH: FOOTER_H };
    this.paintPlanApprovalCard(rect);
    this.deps.palette.paint(rect);

    const c = new TerminalCanvas(dims.columns, dims.rows);
    const snap = s.lastSnapshot;
    const session = snap.session;

    // Header — top divider, content row, bottom divider (full width).
    // Row 0: top rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 0, `\x1b[90m─\x1b[0m`);
    // Row 1: left "ALiX TUI - Interactive Session" + right-aligned meta
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
    c.write(Math.max(2, dims.columns - rightLen), 1, rightText);
    // Row 2: bottom rule
    for (let i = 0; i < dims.columns; i++) c.write(i, 2, `\x1b[90m─\x1b[0m`);

    // Blit the view canvas into the main canvas at offset (0, 0).
    c.blit(viewCanvas, 0, 0);

    // Tabs row (with key-hint suffix, right-aligned). Now uses the
    // full width — no sidebar column to clip against.
    let tabLine = '';
    for (const id of TAB_ORDER) {
      const active = id === s.activeTab;
      tabLine += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
    }
    const tabHintsVisible = '↑/↓ navigate   |   tab next   |   ? help   |   q quit';
    const hintsLen = tabHintsVisible.length;
    const tabRowBudget = Math.max(0, dims.columns - hintsLen - 1);
    const tabText = tabLine.length <= tabRowBudget
      ? tabLine + ' '.repeat(tabRowBudget - tabLine.length)
      : tabLine.slice(0, tabRowBudget);
    c.write(0, dims.rows - FOOTER_H, tabText);
    c.write(dims.columns - hintsLen, dims.rows - FOOTER_H, `\x1b[90m${tabHintsVisible}\x1b[0m`);

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
    const statusLine = s.activeTab === 'agent'
      ? `${phaseLine} ${sep} ${fields.join(` ${sep} `)}`
      : `${sep} ${fields.join(` ${sep} `)}`;
    c.write(0, dims.rows - 1, statusLine.slice(0, Math.max(0, dims.columns - 2)));

    // Write the complete frame — cursor home + canvas render.
    this.deps.output.write('\x1b[H' + c.renderFrame());

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
      const bufLen = s.views.agent.inputBuffer.length;
      const vp = computeViewport(dims, 'agent');
      this.deps.output.write(`\x1b[${vp.panelRow + 1};${vp.promptCol + bufLen + 1}H`);
    } else {
      // Non-input tabs (dashboard, daemon, approvals, runtime, sops,
      // policy): move cursor to a safe column (row 4, col 1) so it
      // doesn't blink on top of the status line.
      this.deps.output.write(`\x1b[5;1H`);
    }
  }
}
