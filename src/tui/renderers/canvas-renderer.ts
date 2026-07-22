import type { OperatorRenderer, RendererCapabilities } from '../renderer/types.js';
import type { RenderSurface } from '../renderer/surface.js';
import type { OperatorViewState, PanelViewModel } from '../presentation/types.js';
import type { TerminalControl } from '../terminal-control.js';
import { CanvasSurface } from './canvas-surface.js';
import { CanvasLayoutEngine, type CanvasGeometry } from '../layout/canvas-layout.js';

type RenderTerminal = TerminalControl & {
  write?: (output: string) => void;
  setCursor?: (column: number, row: number) => void;
};

export interface PreRenderCapable {
  /** Set a pre-rendered surface for the left column (legacy view content).
   *  The renderer blits this surface into position before adding chrome.
   *  Only used during PR A — removed in PR C. */
  setPreRenderSurface(surface: RenderSurface | null): void;
}

export class CanvasRenderer implements OperatorRenderer {
  private terminal!: RenderTerminal;
  private engine = new CanvasLayoutEngine();
  private geometry: CanvasGeometry | null = null;
  private initialized = false;
  private preRenderSurface: RenderSurface | null = null;

  capabilities(): RendererCapabilities {
    return {
      name: 'CanvasRenderer',
      version: '1.0.0',
      handlesInput: false,
      supportsMouse: false,
      supportsColor: true,
      supportsUnicode: true,
      supportsTrueColor: false,
    };
  }

  async initialize(terminal: TerminalControl): Promise<void> {
    this.terminal = terminal as RenderTerminal;
    this.initialized = true;
  }

  /** Set a pre-rendered surface (legacy view content) that gets blitted
   *  as the left column. Accepts null to clear. */
  setPreRenderSurface(surface: RenderSurface | null): void {
    this.preRenderSurface = surface;
  }

  render(viewState: OperatorViewState): void {
    if (!this.initialized) return;

    const dims = {
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    };
    this.geometry = this.engine.compute(
      dims,
      viewState.panels.filter((panel) => panel.visible).length,
    );
    const geo = this.geometry;
    const c = new CanvasSurface(dims.columns, dims.rows);

    // Left column: blit pre-rendered legacy view.
    if (this.preRenderSurface) {
      c.blit(this.preRenderSurface, 0, 0);
    }

    // Header.
    for (let i = 0; i < dims.columns; i++) c.write(i, 0, '\x1b[90m─\x1b[0m');
    c.write(2, 1, '\x1b[32mALiX TUI\x1b[0m\x1b[1m - Interactive Session\x1b[0m');
    const ver = viewState.sessionMetadata?.version ?? '0.0.0';
    const mode = viewState.sessionMetadata?.mode ?? 'auto';
    const rightText = `\x1b[90mAgent OS v${ver}  │  Session: ${mode}  │  Mode: ${mode}\x1b[0m`;
    const rLen = `Agent OS v${ver}  │  Session: ${mode}  │  Mode: ${mode}`.length;
    c.write(Math.max(2, dims.columns - rLen), 1, rightText);
    for (let i = 0; i < dims.columns; i++) c.write(i, 2, '\x1b[90m─\x1b[0m');

    // Vertical divider.
    for (let y = geo.headerH; y < dims.rows - geo.footerH; y++) {
      c.write(geo.dividerX, y, '\x1b[90m│\x1b[0m');
    }

    // Sidebar panels.
    this.renderSidebar(c, viewState, geo);

    // Tab bar.
    this.renderTabBar(c, viewState, geo);

    // Status bar.
    this.renderStatusBar(c, viewState, geo);

    // Write through TerminalControl.
    this.terminal.write?.(c.serialize());

    // Cursor positioning through TerminalControl.
    this.positionCursor(viewState, geo);
  }

  resize(columns: number, rows: number): void {
    this.geometry = this.engine.compute({ columns, rows }, 4);
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.preRenderSurface = null;
  }

  private renderSidebar(c: RenderSurface, vs: OperatorViewState, geo: CanvasGeometry): void {
    const sc = new CanvasSurface(geo.rightW, c.height);
    let y = geo.headerH;
    for (const panel of vs.panels) {
      if (!panel.visible) continue;
      if (y + geo.perPanelH > c.height - geo.footerH) break;
      this.paintPanel(sc, panel, 0, y, geo.rightW, geo.perPanelH);
      y += geo.perPanelH;
    }
    c.blit(sc, geo.dividerX + 1, 0);
  }

  private paintPanel(
    s: RenderSurface,
    panel: PanelViewModel,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const titleColor = panel.focused ? '\x1b[1;36m' : '\x1b[32m';
    s.drawBox(x, y, w, h);
    s.write(x + 2, y + 1, `${titleColor}${panel.title}\x1b[0m`);
    for (let i = 0; i < Math.min(panel.items.length, h - 3); i++) {
      const item = panel.items[i]!;
      s.write(
        x + 2,
        y + 3 + i,
        (item.subtitle ? `${item.title} ${item.subtitle}` : item.title).slice(0, w - 4),
      );
    }
  }

  private renderTabBar(s: RenderSurface, vs: OperatorViewState, geo: CanvasGeometry): void {
    let line = '';
    for (const t of vs.tabs) {
      line += t.active ? ` \x1b[7m ${t.id} \x1b[0m` : `  ${t.id}  `;
    }
    const hints = '\x1b[90m↑/↓  |  tab  |  ?  |  q quit\x1b[0m';
    const budget = Math.max(0, geo.leftW - hints.length + 9);
    s.write(
      0,
      s.height - 3,
      line.length <= budget ? line + ' '.repeat(budget - line.length) : line.slice(0, budget),
    );
    s.write(geo.leftW - (hints.length - 9), s.height - 3, hints);
  }

  private renderStatusBar(s: RenderSurface, vs: OperatorViewState, geo: CanvasGeometry): void {
    const sb = vs.statusBar;
    let phaseLine = '';
    for (const p of sb.phaseRadios) {
      phaseLine += p.active
        ? `\x1b[32m● ${p.label}\x1b[0m   `
        : `\x1b[90m○ ${p.label}\x1b[0m   `;
    }
    const sep = '\x1b[90m|\x1b[0m';
    const fields = sb.fields.map((f) => `${f.label}: ${f.value}`);
    const line = sb.activeTab === 'chat'
      ? `${sep} ${fields.join(` ${sep} `)}`
      : `${phaseLine} ${sep} ${fields.join(` ${sep} `)}`;
    s.write(0, s.height - 1, line.slice(0, Math.max(0, geo.leftW - 2)));
  }

  private positionCursor(vs: OperatorViewState, _geo: CanvasGeometry): void {
    if (vs.activeTab === 'chat') {
      this.terminal.setCursor?.(5, 7 + vs.input.buffer.length + 1);
    } else if (vs.activeTab === 'agent') {
      this.terminal.setCursor?.(5, 13 + vs.input.buffer.length + 1);
    } else {
      this.terminal.setCursor?.(5, 1);
    }
  }
}
