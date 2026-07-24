import type { OperatorRenderer, RendererCapabilities, RendererEvent } from '../renderer/types.js';
import type { OperatorViewState } from '../presentation/types.js';
import type { TerminalControl } from '../terminal-control.js';
import type { SidebarPanelId } from '../state.js';
import blessed from 'neo-blessed';
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
  private leftPane?: blessed.Widgets.BoxElement;
  private rightPane!: Record<SidebarPanelId, blessed.Widgets.BoxElement>;
  private tabBar?: blessed.Widgets.BoxElement;
  private status?: blessed.Widgets.BoxElement;
  private promptBar?: blessed.Widgets.BoxElement;
  private promptTextarea?: blessed.Widgets.TextareaElement;
  private approvalHint?: blessed.Widgets.BoxElement;

  /** Last active tab seen during render — used for focus transition detection. */
  private lastActiveTab: string | null = null;

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
    if (this.initialized) {
      throw new Error('BlessedRenderer is already initialized');
    }
    this.terminal = terminal;
    // Reset focus-transition tracker so a re-initialized widget tree re-focuses
    // its textarea on the first render (defense in depth alongside shutdown()).
    this.lastActiveTab = null;
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
    this.leftPane = blessed.box({
      top: 1,
      left: 0,
      width: '75%',
      height: '100%-3',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { fg: 'blue' } },
      style: { fg: 'white' },
    });
    this.screen.append(this.leftPane);

    // ── Approval hint (child of leftPane = mainBox) ──
    // Anchored to bottom of the left pane via bottom: 0. Visibility is task 4.
    this.approvalHint = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      hidden: true,
      style: { fg: 'yellow', bold: true },
      tags: true,
    });
    this.leftPane.append(this.approvalHint);

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
    this.rightPane = widgets as Record<SidebarPanelId, blessed.Widgets.BoxElement>;

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

    // ── Prompt bar (container above tabBar) ──
    // 1-row tall container whose child is the textarea. The child fills the parent.
    this.promptBar = blessed.box({
      top: '100%-4',
      left: 0,
      width: '100%',
      height: 1,
      style: { fg: 'white' },
      tags: true,
    });
    this.screen.append(this.promptBar);

    // ── Prompt textarea (child of promptBar) ──
    // inputOnFocus so printable keys (including 'q') feed the textarea instead
    // of the screen-level quit handler. mouse disabled to avoid hand-off races.
    this.promptTextarea = blessed.textarea({
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      mouse: false,
      style: { fg: 'white', bg: 'blue' },
    });
    this.promptBar.append(this.promptTextarea);

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
    setupKeyboardHandler(this.screen, this.promptTextarea, this.approvalHint, (event) => {
      this.onEvent?.(event);
    });

    this.initialized = true;
  }

  render(viewState: OperatorViewState): void {
    if (!this.initialized || !this.screen) return;
    if (!this.header || !this.leftPane || !this.tabBar || !this.promptTextarea || !this.promptBar || !this.approvalHint || !this.status) return;

    // ── Header ──
    this.header.setContent(
      ` ALiX TUI │ v${viewState.sessionMetadata?.version ?? '0.0.0'} │ Mode: ${viewState.sessionMetadata?.mode ?? 'auto'}`,
    );

    // ── Main content ──
    renderMain(this.leftPane, viewState);

    // ── Sidebar panels ──
    renderSidebar(this.rightPane, viewState);

    // ── Tab bar ──
    this.tabBar.setContent(
      viewState.tabs.map((t) => (t.active ? `[${t.id}]` : ` ${t.id} `)).join('  '),
    );

    // ── Input ──
    // Defensive sync: only call setValue when the buffer actually differs
    // from the textarea's current value. This avoids fighting the textarea's
    // internal cursor state during snapshot refreshes.
    if (this.promptTextarea.getValue() !== viewState.input.buffer) {
      this.promptTextarea.setValue(viewState.input.buffer);
    }

    // ── Prompt visibility ──
    // Show prompt only for chat/agent tabs; hide for all others.
    const promptActive = viewState.activeTab === 'chat' || viewState.activeTab === 'agent';
    if (promptActive) {
      this.promptBar.show();
    } else {
      this.promptBar.hide();
    }

    // ── Focus management ──
    // Only change focus on tab-change transitions, not every render. This
    // prevents focus thrash during snapshot refreshes.
    if (this.lastActiveTab !== viewState.activeTab) {
      this.lastActiveTab = viewState.activeTab;
      if (promptActive) {
        this.promptTextarea.focus();
      } else {
        this.promptTextarea.blur();
        this.leftPane.focus();
      }
    }

    // ── Approval hint ──
    // Driven by viewState.viewContent.pendingApprovalHint (string | null).
    const approvalHintText = viewState.viewContent.pendingApprovalHint;
    if (approvalHintText !== null) {
      this.approvalHint.setContent(approvalHintText);
      this.approvalHint.show();
    } else {
      this.approvalHint.hide();
    }

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
    // Clear focus-transition tracker so the next initialize() starts from a
    // clean slate and the first render re-focuses the new widget tree.
    this.lastActiveTab = null;
  }

  /** @internal — all widget refs for persistence testing. */
  getWidgetReferences(): {
    screen: blessed.Widgets.Screen | null;
    header: blessed.Widgets.BoxElement | undefined;
    leftPane: blessed.Widgets.BoxElement | undefined;
    rightPane: Record<SidebarPanelId, blessed.Widgets.BoxElement>;
    tabBar: blessed.Widgets.BoxElement | undefined;
    status: blessed.Widgets.BoxElement | undefined;
    promptBar: blessed.Widgets.BoxElement | undefined;
    promptTextarea: blessed.Widgets.TextareaElement | undefined;
    approvalHint: blessed.Widgets.BoxElement | undefined;
  } {
    return {
      screen: this.screen,
      header: this.header,
      leftPane: this.leftPane,
      rightPane: this.rightPane,
      tabBar: this.tabBar,
      status: this.status,
      promptBar: this.promptBar,
      promptTextarea: this.promptTextarea,
      approvalHint: this.approvalHint,
    };
  }
}
