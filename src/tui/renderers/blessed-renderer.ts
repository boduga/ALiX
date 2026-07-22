import type { OperatorRenderer, RendererCapabilities, RendererEvent } from '../renderer/types.js';
import type { OperatorViewState } from '../presentation/types.js';
import type { TerminalControl } from '../terminal-control.js';
import type { SidebarPanelId } from '../state.js';
import * as blessed from 'neo-blessed';
import { setupKeyboardHandler } from './blessed/keyboard-handler.js';
import { renderMain } from './blessed/main-painter.js';
import { renderSidebar } from './blessed/sidebar-painter.js';
import { renderStatusBar } from './blessed/status-painter.js';

export class BlessedRenderer implements OperatorRenderer {
  private terminal!: TerminalControl;
  private screen: blessed.Widgets.Screen | null = null;
  private initialized = false;

  // Widget tree — created once in initialize(), updated in render()
  // Widget-persistence invariant is tested for ALL widgets in tests.
  private header?: blessed.Widgets.BoxElement;
  private mainBox?: blessed.Widgets.BoxElement;
  private sidebarWidgets!: Record<SidebarPanelId, blessed.Widgets.BoxElement>;
  private tabBar?: blessed.Widgets.BoxElement;
  private input?: blessed.Widgets.TextareaElement;
  private status?: blessed.Widgets.BoxElement;

  /** @internal — event callback wired by TuiApp */
  onEvent?: (event: RendererEvent) => void;

  capabilities(): RendererCapabilities {
    return {
      name: 'BlessedRenderer',
      version: '1.0.0',
      supportsMouse: false,
      supportsColor: true,
      supportsUnicode: true,
      supportsTrueColor: true,
      handlesInput: true,
    };
  }

  async initialize(terminal: TerminalControl): Promise<void> {
    if (this.screen) {
      await this.shutdown();
    }
    this.terminal = terminal;
    this.screen = blessed.screen({
      input: terminal.input,
      output: terminal.output,
      smartCSR: true,
      title: 'ALiX TUI',
      fullUnicode: true,
      sendFocus: true,
    });

    // ── Layout structure ────────────────────────────────────────
    // Row 0:         header (1)
    // Row 1 to H-3:  [main viewport (75% left) | sidebar panels (25% right)]
    // Row H-3:       tabBar (1)
    // Row H-2:       input (1)
    // Row H-1:       status (1)

    // ── Header ──
    this.header = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' ALiX TUI — Interactive Session',
      style: { fg: 'green', bold: true },
    });
    this.screen.append(this.header);

    // ── Main content viewport (single scrollable area, not per-tab) ──
    this.mainBox = blessed.box({
      top: 1,
      left: 0,
      width: '75%',
      height: '100%-3',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { fg: 'blue' } },
      style: { fg: 'white' },
    });
    this.screen.append(this.mainBox);

    // ── Sidebar panels (4 panels, stacked vertically) ──
    const panelIds: SidebarPanelId[] = ['daemon', 'approvals', 'runtime', 'sops_policy'];
    const sidebarLeft = '75%+1';
    const sidebarWidth = '25%-1';
    const widgets: Record<string, blessed.Widgets.BoxElement> = {};

    for (const id of panelIds) {
      const box = blessed.box({
        top: 1,
        left: sidebarLeft,
        width: sidebarWidth,
        height: '25%',
        label: ` ${id.replace('_', ' & ').toUpperCase()} `,
        border: { type: 'line' },
        style: {
          fg: 'white',
          border: { fg: 'green' },
          label: { fg: 'green' },
        },
        tags: true,
      });
      this.screen.append(box);
      widgets[id] = box;
    }
    this.sidebarWidgets = widgets as Record<SidebarPanelId, blessed.Widgets.BoxElement>;

    // ── Tab bar ──
    this.tabBar = blessed.box({
      top: '100%-3',
      left: 0,
      width: '100%',
      height: 1,
      style: { fg: 'cyan' },
      tags: true,
    });
    this.screen.append(this.tabBar);

    // ── Input ──
    this.input = blessed.textarea({
      top: '100%-2',
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      style: { fg: 'white', bg: 'blue' },
    });
    this.screen.append(this.input);

    // ── Status bar ──
    this.status = blessed.box({
      top: '100%-1',
      left: 0,
      width: '100%',
      height: 1,
      style: { fg: 'white' },
      tags: true,
    });
    this.screen.append(this.status);

    // ── Keyboard handler ──
    setupKeyboardHandler(this.screen, this.input, (event) => {
      this.onEvent?.(event);
    });

    this.initialized = true;
  }

  render(viewState: OperatorViewState): void {
    if (!this.initialized || !this.screen) return;
    if (!this.header || !this.mainBox || !this.tabBar || !this.input || !this.status) return;

    // ── Header ──
    this.header.setContent(
      ` ALiX TUI │ v${viewState.sessionMetadata?.version ?? '0.0.0'} │ Mode: ${viewState.sessionMetadata?.mode ?? 'auto'}`,
    );

    // ── Main content ──
    renderMain(this.mainBox, viewState);

    // ── Sidebar panels ──
    renderSidebar(this.sidebarWidgets, viewState);

    // ── Tab bar ──
    this.tabBar.setContent(
      viewState.tabs.map((t) => (t.active ? `[${t.id}]` : ` ${t.id} `)).join('  '),
    );

    // ── Input ──
    this.input.setValue(viewState.input.buffer);

    // ── Status bar ──
    renderStatusBar(this.status, viewState);

    // ── Render ──
    this.screen.render();
  }

  resize(_c: number, _r: number): void {
    /* blessed handles resize via SIGWINCH */
  }

  async shutdown(): Promise<void> {
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
    this.initialized = false;
  }

  /** @internal — all widget refs for persistence testing. */
  getWidgetReferences(): {
    screen: blessed.Widgets.Screen | null;
    header: blessed.Widgets.BoxElement | undefined;
    mainBox: blessed.Widgets.BoxElement | undefined;
    sidebarWidgets: Record<SidebarPanelId, blessed.Widgets.BoxElement>;
    tabBar: blessed.Widgets.BoxElement | undefined;
    input: blessed.Widgets.TextareaElement | undefined;
    status: blessed.Widgets.BoxElement | undefined;
  } {
    return {
      screen: this.screen,
      header: this.header,
      mainBox: this.mainBox,
      sidebarWidgets: this.sidebarWidgets,
      tabBar: this.tabBar,
      input: this.input,
      status: this.status,
    };
  }
}
