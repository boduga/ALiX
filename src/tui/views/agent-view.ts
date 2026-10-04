import type { PerTabState, TabId } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';
import { renderBottomAnchoredSlice, type KindStyleMap, type ScrollbackLine } from './bottom-anchored-viewport.js';
import { renderSlashOverlay } from './slash-overlay.js';
import { buildAgentScrollbackLines, computeViewport, GUTTER_WIDTH } from './scroll-math.js';
import { buildWorkbenchScrollbackLines, type WorkbenchScrollbackLine } from '../workbench/views/workbench-scrollback.js';
import { paintTranscriptToolbar } from '../workbench/views/transcript-toolbar.js';
import { getWorkbenchPreviewTheme } from '../workbench/model/preview-theme.js';
import { RESET } from '../ansi-constants.js';
import { TerminalCanvas } from '../canvas.js';
import { SessionPhase } from '../../agent/session.js';
import { layoutWorkbenchSurface } from '../workbench/views/composer-view.js';
import { paintRosterDrawer } from '../workbench/views/roster-drawer.js';
import { formatActivityElapsed } from '../../agent/agent-activity.js';
import { buildAgentInspectorModel } from '../workbench/model/agent-inspector.js';
import { paintAgentInspector } from '../workbench/views/agent-inspector.js';
import { approvalVisibleTo } from '../workbench/model/selection.js';

/**
 * AgentView — full-workflow task surface. Submit calls
 * `AgentSession.processTurn` (tool-loop capable) rather than
 * `processChat` (lightweight echo).
 *
 * Layout mirrors ChatView so the two tabs share scrollback and prompt
 * behaviour — the only material differences are:
 *   - prompt marker: `alix-agent>` instead of `alix>`
 *   - status row above the scrollback that surfaces runtime workflow
 *     and event counts at a glance
 *
 * The input panel + slash strip are bottom-anchored (Claude-Code style):
 * the panel sits inside the 5-row footer (topBorderRow, panelRow,
 * bottomBorderRow, status row) framed by a dim-grey horizontal rule
 * above and below the prompt. The slash strip renders directly below
 * the panel. The scrollback fills rows 6 through panelRow-1 (1 row
 * above the panel), pinned by default to the most recent content;
 * the view branches on `pinnedBottom`:
 *
 *   pinned:    effectiveOffset = max(0, allLines.length - scrollbackRows)
 *   unpinned:  effectiveOffset = scrollOffset (absolute window-start index)
 *
 * Pure: render(ctx) never mutates ctx.
 */
export class AgentView implements TuiView {
  readonly id: TabId = 'agent';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const frameCanvas = ctx.canvas!;
    const surface = ctx.workbenchEnabled
      ? layoutWorkbenchSurface(ctx.perTab.inputBuffer, ctx.dimensions, ctx.workbenchUiState?.drawer ?? 'closed', ctx.workbenchUiState?.composer.cursor)
      : null;
    const geometry = surface?.geometry ?? null;
    const responsive = geometry?.layout ?? null;
    const surfaceDimensions = geometry?.dimensions ?? ctx.dimensions;
    const composer = surface?.composer ?? null;
    const c = geometry ? new TerminalCanvas(surfaceDimensions.columns, surfaceDimensions.rows) : frameCanvas;
    const baseViewport = computeViewport(surfaceDimensions, 'agent', composer?.rows.length ?? 1);
    const vp = geometry ? { ...baseViewport,
      panelRow: geometry.panelRow, topBorderRow: geometry.topBorderRow, bottomBorderRow: geometry.bottomBorderRow,
      scrollbackTop: geometry.regions.transcriptBody.y,
      scrollbackBottom: geometry.regions.transcriptBody.y + geometry.regions.transcriptBody.height - 1,
      scrollbackRows: geometry.regions.transcriptBody.height,
      textWidth: Math.max(1, surfaceDimensions.columns - 2),
    } : baseViewport;
    const STATUS_ROW = 4;              // status line + intent badge row
    // Stage-gutter left column: blank under slice #2; stage labels in slice #3.
    // Marker sits at column `gutter`, content text starts at `gutter + 2`. The
    // status row and prompt row are NOT scrollback and stay at column 0.
    const gutter = GUTTER_WIDTH;

    // Status line + intent badge — pinned at row 4, always visible.
    const r = ctx.snap.runtime;
    if (r && r.totalEventCount > 0) {
      const wf = r.workflow;
      const stepBit = wf ? ` | step ${wf.currentStep}/${wf.totalSteps}` : '';
      c.write(0, STATUS_ROW, `\x1b[90mevents: ${r.totalEventCount}${stepBit}${RESET}`);
    }
    const intent = ctx.perTab.currentIntent;
    if (intent && intent !== 'research') {
      const color = intent === 'mutation' ? '\x1b[33m' : '\x1b[32m';
      const label = intent === 'mutation' ? 'E' : 'V';
      c.write(2, STATUS_ROW, `${color}[${label}]${RESET}`);
    }

    // Progress-based liveness: rendered only while an agent turn is actively
    // running (a liveness snapshot exists and the phase is not Idle). Wall
    // clock has no meaning here — a long-horizon run can stream for minutes —
    // so the line surfaces elapsed time + time since the last progress mark,
    // escalating to a warning when the run appears stalled. Never a kill.
    const ses = ctx.snap.session;
    const liveness = ses?.liveness;
    const selectedAgentId = ctx.workbenchEnabled ? undefined : ctx.workbenchUiState?.selectedAgentId;
    const pendingApproval = ctx.perTab.pendingApprovals?.find((approval) => approvalVisibleTo(approval, selectedAgentId));
    if (pendingApproval) {
      const elapsed = formatActivityElapsed(Date.now() - pendingApproval.requestedAt);
      c.write(0, STATUS_ROW - 1, `\x1b[33mWAITING FOR APPROVAL · ${elapsed}${RESET}`);
    } else if (liveness && ses?.phase !== SessionPhase.Idle) {
      const idle = Date.now() - liveness.lastProgressAt;
      let lifeLine = `\x1b[36mRUNNING ${formatActivityElapsed(Date.now() - liveness.startedAt)}\x1b[0m | progress ${formatActivityElapsed(idle)} ago`;
      if (liveness.state !== 'healthy') {
        const kind = liveness.lastProgressKind ?? 'no activity';
        const desc = liveness.lastProgressDescription ?? '';
        const flag = liveness.state === 'stalled' ? 'POSSIBLY STALLED' : 'SLOW';
        lifeLine += ` | \x1b[33m⚠ ${flag}\x1b[0m (${kind}${desc ? `: ${desc}` : ''})`;
      }
      c.write(0, STATUS_ROW - 1, lifeLine);
    }

    // Line-builder lives in scroll-math.ts (single source of truth).
    const allLines: readonly ScrollbackLine[] = ctx.workbenchEnabled
      ? (vp.scrollbackRows > 0 ? ctx.workbenchLines ?? buildWorkbenchScrollbackLines(ctx, vp.textWidth) : [])
      : buildAgentScrollbackLines(ctx, vp.textWidth);

    if (ctx.workbenchEnabled) {
      const toolbar = geometry!.regions.transcriptToolbar;
      for (let row = toolbar.y; row < toolbar.y + toolbar.height; row++) c.write(0, row, ' '.repeat(surfaceDimensions.columns));
      const pane = geometry!.regions.transcript;
      if (pane.width >= 2 && pane.height >= 2) {
        const color = getWorkbenchPreviewTheme().palette.cyan;
        c.write(0, pane.y, `${color}╭${'─'.repeat(pane.width - 2)}╮${RESET}`);
        for (let row = pane.y + 1; row < pane.y + pane.height - 1; row++) {
          c.write(0, row, `${color}│${RESET}`);
          c.write(pane.width - 1, row, `${color}│${RESET}`);
        }
        c.write(0, pane.y + pane.height - 1, `${color}╰${'─'.repeat(pane.width - 2)}╯${RESET}`);
      }
      paintTranscriptToolbar(c, { ...toolbar, x: 0 }, ctx.workbenchUiState, ctx.workbenchNewItems);
    }

    // Branch on pinnedBottom: pinned recomputes bottomAnchor fresh,
    // unpinned uses captured scrollOffset (absolute window-start index).
    const effectiveOffset = (ctx.workbenchEnabled ? ctx.workbenchUiState?.followTail ?? ctx.perTab.pinnedBottom : ctx.perTab.pinnedBottom)
      ? Math.max(0, allLines.length - vp.scrollbackRows)
      : ctx.perTab.scrollOffset;

    const kindStyles: KindStyleMap = {
      plan:     (l, rowY) => this.renderPlanLine(l, rowY, c, gutter),
      approval: (l, rowY) => this.renderApprovalLine(l, rowY, c, gutter),
      approvalCard: (l, rowY) => this.renderApprovalLine(l, rowY, c, gutter),
      toolCall: (l, rowY) => this.renderToolCallLine(l, rowY, c, gutter),
      user:     (l, rowY) => this.renderTurnLine('user', l, rowY, c, gutter),
      agent:    (l, rowY) => this.renderTurnLine('agent', l, rowY, c, gutter),
      streaming: (l, rowY) => this.renderStreamingLine(l, rowY, c, gutter),
      // Unit D — live response-surface activity indicator
      // (`◐ Thinking… 4s` / `⚙ Running shell.run… 3s`). Painted in the agent
      // cyan palette like prose; the spinner + elapsed are pure presentation,
      // recomputed on the ~1s render cadence with no runtime side effects.
      activity:  (l, rowY) => this.renderTurnLine('agent', l, rowY, c, gutter),
      // T6 — C1 observability: LOW-value context lifecycle events
      // (snapshot.created / budget.computed) render as dim grey text.
      context:  (l, rowY) => this.renderContextLine(l, rowY, c, gutter),
    };

    if (ctx.workbenchEnabled) {
      const palette = getWorkbenchPreviewTheme().palette;
      for (const kind of Object.keys(kindStyles)) kindStyles[kind] = (line, rowY) => {
        if (!(line as WorkbenchScrollbackLine).previewFormatted) return;
        const color = kind === 'approval' || kind === 'approvalCard' ? palette.yellow
          : kind === 'context' ? palette.muted : kind === 'user' ? palette.foreground : palette.teal;
        c.write(Math.min(1, surfaceDimensions.columns - 1), rowY, `${color}${line.text}${RESET}`);
      };
    }

    renderBottomAnchoredSlice({
      canvas: c,
      allLines,
      top: vp.scrollbackTop,
      bottomRow: vp.scrollbackBottom,
      offset: effectiveOffset,
      columns: surfaceDimensions.columns,
      kindStyles,
    });

    if (geometry) {
      const rows = c.renderFrame().split('\n');
      const pane = geometry.regions.transcript;
      for (let row = pane.y; row < pane.y + pane.height; row++) {
        frameCanvas.write(pane.x, row, rows[row] ?? '');
      }
      const inspector = geometry.regions.inspector;
      if (inspector && inspector.height > 0) paintAgentInspector(frameCanvas, inspector, buildAgentInspectorModel(ctx.snap, ctx.workbenchUiState));
    }

    // Input panel at panelRow.
    const buf = ctx.perTab.inputBuffer;
    if (composer) {
      const firstRow = geometry!.regions.composerContent.y;
      const prefixWidth = geometry!.composerPrefixWidth;
      const theme = getWorkbenchPreviewTheme();
      const { palette, glyphs } = theme;
      const boxed = geometry!.regions.composer.height >= composer.rows.length + 2;
      for (let index = 0; index < composer.rows.length; index++) {
        const prefix = index === 0
          ? (composer.hiddenRows > 0 ? ' … ' : ' > ').slice(0, prefixWidth)
          : ' '.repeat(prefixWidth);
        const content = !buf && index === 0 ? `${palette.muted}Add your next instruction...${RESET}` : composer.rows[index] ?? '';
        frameCanvas.write(0, firstRow + index, `${palette.cyan}${prefix}${RESET}${content}`);
        if (boxed) {
          frameCanvas.write(0, firstRow + index, `${palette.cyan}${glyphs.vertical}${RESET}`);
          frameCanvas.write(geometry!.regions.composer.width - 1, firstRow + index, `${palette.cyan}${glyphs.vertical}${RESET}`);
        }
      }
    } else {
      c.write(0, vp.panelRow, `\x1b[33m alix-agent>${RESET} `);
      c.write(vp.promptCol, vp.panelRow, buf);
      c.write(vp.promptCol + buf.length, vp.panelRow, `\x1b[7m ${RESET}`);
    }

    // Frame the input panel: full-width dim-grey horizontal rules above
    // and below the prompt (Claude-Code style chrome). Drawn AFTER the
    // prompt so the rules read as part of the panel; on a tall terminal
    // the slash strip overlays the bottom rule's first row — acceptable
    // because the strip is intentionally visually loud.
    if (geometry && geometry.regions.composer.height >= composer!.rows.length + 2) {
      const { palette, glyphs } = getWorkbenchPreviewTheme();
      const inner = Math.max(0, geometry.regions.composer.width - 2);
      frameCanvas.write(0, vp.topBorderRow, `${palette.cyan}${glyphs.topLeft}${glyphs.horizontal.repeat(inner)}${glyphs.topRight}${RESET}`);
      frameCanvas.write(0, vp.bottomBorderRow, `${palette.cyan}${glyphs.bottomLeft}${glyphs.horizontal.repeat(inner)}${glyphs.bottomRight}${RESET}`);
    } else if (!geometry) {
      const border = `\x1b[90m${'─'.repeat(surfaceDimensions.columns)}${RESET}`;
      frameCanvas.write(0, vp.topBorderRow, border);
      frameCanvas.write(0, vp.bottomBorderRow, border);
    }

    // Slash strip directly BELOW the panel.
    if (ctx.slash) {
      renderSlashOverlay({ canvas: frameCanvas, slash: ctx.slash, panelRow: vp.panelRow, columns: geometry?.regions.composer.width ?? surfaceDimensions.columns });
    }

    if (responsive) {
      paintRosterDrawer({
        canvas: frameCanvas,
        left: geometry?.regions.roster?.x ?? geometry?.regions.overlay?.x,
        terminalColumns: ctx.dimensions.columns,
        top: geometry?.regions.body.y ?? 3,
        bottom: geometry ? geometry.regions.body.y + geometry.regions.body.height - 1 : vp.topBorderRow - 1,
        layout: responsive,
        agents: ctx.snap.runtime?.agents ?? null,
        tasks: ctx.snap.runtime?.tasks ?? null,
        artifacts: ctx.snap.runtime?.artifacts ?? null,
        selectedAgentId: ctx.workbenchUiState?.selectedAgentId,
        selectedTaskId: ctx.workbenchUiState?.selectedTaskId,
        selectedRunId: ctx.workbenchUiState?.selectedRunId,
        selectedArtifactId: ctx.workbenchUiState?.selectedArtifactId,
        agentRosterExpanded: ctx.workbenchUiState?.agentRosterExpanded,
        agentScrollOffset: ctx.workbenchUiState?.drawerScrollOffset,
      });
    }

    return { rows: [] };
  }

  private renderPlanLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    // #432 — gutter label at column 0 (when set), dim `│` separator at
    // column `gutter`, dim text at column `gutter + 2`. The gutter +
    // separator only paint on the first line of a group; continuation lines
    // stay blank so the existing test contracts ("blank separator rows are
    // truly empty", "exactly one marker per response") still hold.
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
    }
    if (l.text) c.write(textCol, rowY, `\x1b[2m${l.text}${RESET}`);
  }

  private renderApprovalLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
      c.write(textCol, rowY, `\x1b[33m${l.text}${RESET}`);
    } else {
      c.write(textCol, rowY, `\x1b[33m${l.text}${RESET}`);
    }
  }

  private renderToolCallLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
    }
    // Tool call text already includes its own `→ ` prefix (produced by
    // scroll-math.ts when rendering the toolCalls block). Render the full
    // text at `gutter + 2` — no marker slicing; the line builder owns the
    // prefix. Pre-#432 this method sliced off the first 2 chars because the
    // old marker was the same `→ `; the new universal `│` separator makes
    // the slicing unnecessary.
    c.write(textCol, rowY, `\x1b[2m${l.text}${RESET}`);
  }

  /** T6 — C1 observability: LOW-value context lifecycle events
   *  (snapshot.created / budget.computed) render as dim grey text with
   *  the stage-gutter separator. Matches the existing toolCall/plan dim
   *  styling convention. */
  private renderContextLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
    }
    // Dim grey — the context line text is pre-formatted by TimelineBuilder.
    c.write(textCol, rowY, `\x1b[2m\x1b[37m${l.text}${RESET}`);
  }

  private renderTurnLine(kind: 'user' | 'agent', l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
      if (kind === 'user') {
        c.write(textCol, rowY, l.text);
      } else {
        c.write(textCol, rowY, `\x1b[36m${l.text}${RESET}`);
      }
    } else {
      if (kind === 'user') {
        c.write(textCol, rowY, l.text);
      } else {
        c.write(textCol, rowY, `\x1b[36m${l.text}${RESET}`);
      }
    }
  }

  /** Live-streaming assistant line: dim trailing cursor on the last row so
   *  the operator can tell "growing live" from "frozen partial". The gutter
   *  + separator carry the current stage attribution. */
  private renderStreamingLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
    }
    if (l.isLast) {
      c.write(textCol, rowY, `${l.text}\x1b[90m▍${RESET}`);
    } else {
      c.write(textCol, rowY, l.text);
    }
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    // Arrow keys scroll the scrollback; 3 lines per step gives a smooth
    // feel without being too slow for longer responses. Other keys are
    // swallowed (the agent tab's input buffer is handled by TuiApp).
    // The pinnedBottom side-effect happens in app.ts (Task 3).
    const SCROLL_STEP = 3;
    switch (key) {
      case 'Ctrl+o':
        return { type: 'toggleTranscriptMode' };
      case 'ArrowUp':
        return { type: 'scroll', offset: ctx.perTab.scrollOffset + SCROLL_STEP };
      case 'ArrowDown': {
        const offset = Math.max(0, ctx.perTab.scrollOffset - SCROLL_STEP);
        return { type: 'scroll', offset };
      }
      default:
        return { type: 'handled' };
    }
  }

  onActivate(_perTab: PerTabState): void {
    // No-op for now; app.ts handles the per-tab reset.
  }

  onDeactivate(_perTab: PerTabState): void {
    // No-op for now.
  }
}
