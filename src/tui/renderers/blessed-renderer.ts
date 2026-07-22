import type { OperatorRenderer, RendererCapabilities } from '../renderer/types.js';
import type { OperatorViewState } from '../presentation/types.js';
import type { TerminalControl } from '../terminal-control.js';
import * as blessed from 'neo-blessed';

export class BlessedRenderer implements OperatorRenderer {
  private terminal!: TerminalControl;
  private screen: blessed.Widgets.Screen | null = null;
  private initialized = false;

  // Widget tree — created once in initialize(), updated in render()
  // Widget-persistence invariant is tested for ALL widgets in tests.
  private header?: blessed.Widgets.BoxElement;
  private status?: blessed.Widgets.BoxElement;
  private tabBar?: blessed.Widgets.BoxElement;
  private approvals?: blessed.Widgets.ListElement;
  private input?: blessed.Widgets.TextareaElement;

  capabilities(): RendererCapabilities {
    return {
      name: 'BlessedRenderer',
      version: '1.0.0-spike',
      supportsMouse: true, supportsColor: true, supportsUnicode: true, supportsTrueColor: true,
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

    // Widget tree created once ──────────────────────────────────
    this.header = blessed.box({ top: 0, left: 0, width: '100%', height: 1,
      content: ' ALiX TUI — Interactive Session',
      style: { fg: 'green', bold: true } });
    this.screen.append(this.header);

    this.approvals = blessed.list({ top: 2, left: '75%+1', width: '25%-1', height: '100%-6',
      label: ' APPROVALS ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: 'green' }, label: { fg: 'green' }, selected: { fg: 'white', bg: 'blue' } },
      items: ['○ no pending approvals'], keys: true, vi: true });
    this.screen.append(this.approvals);

    this.input = blessed.textarea({ top: '100%-2', left: 0, width: '75%', height: 1,
      inputOnFocus: true,
      style: { fg: 'white', bg: 'blue' } });
    this.screen.append(this.input);

    this.tabBar = blessed.box({ top: '100%-3', left: 0, width: '100%', height: 1,
      style: { fg: 'cyan' }, tags: true });
    this.screen.append(this.tabBar);

    this.status = blessed.box({ top: '100%-1', left: 0, width: '100%', height: 1,
      style: { fg: 'white' }, tags: true });
    this.screen.append(this.status);

    this.initialized = true;
  }

  render(viewState: OperatorViewState): void {
    if (!this.initialized || !this.screen) return;
    if (!this.header || !this.status || !this.tabBar || !this.approvals || !this.input) return;

    this.header.setContent(` ALiX TUI  │  v${viewState.sessionMetadata?.version ?? '0.0.0'}  │  Mode: ${viewState.sessionMetadata?.mode ?? 'auto'}`);

    const phaseText = viewState.statusBar.phaseRadios.map((p) => (p.active ? `● ${p.label}` : `○ ${p.label}`)).join('   ');
    const fieldText = viewState.statusBar.fields.map((f) => `${f.label}: ${f.value}`).join(' | ');
    this.status.setContent(`${phaseText}  |  ${fieldText}`);

    this.tabBar.setContent(viewState.tabs.map((t) => (t.active ? `[${t.id}]` : ` ${t.id} `)).join(' '));

    const a = viewState.panels.find((p) => p.id === 'approvals');
    if (a) {
      this.approvals.setItems(a.items.length > 0
        ? a.items.map((i) => `${i.status === 'pending' ? '●' : '○'} ${i.title}${i.subtitle ? ` ${i.subtitle}` : ''}`)
        : ['○ no pending approvals']);
    }

    this.input.setValue(viewState.input.buffer);
    this.screen.render();
  }

  resize(_c: number, _r: number): void { /* blessed handles resize via SIGWINCH */ }

  async shutdown(): Promise<void> {
    // Key handlers are registered via blessed screen.key().
    // blessed destroys them when screen.destroy() is called.
    // No explicit unkey() needed for the spike — screen.destroy() cleans up.
    if (this.screen) { this.screen.destroy(); this.screen = null; }
    this.initialized = false;
  }

  /** @internal — all widget refs for persistence testing. */
  getWidgetReferences(): {
    screen: blessed.Widgets.Screen | null;
    header: blessed.Widgets.BoxElement | undefined;
    status: blessed.Widgets.BoxElement | undefined;
    tabBar: blessed.Widgets.BoxElement | undefined;
    approvals: blessed.Widgets.ListElement | undefined;
    input: blessed.Widgets.TextareaElement | undefined;
  } {
    return { screen: this.screen, header: this.header, status: this.status, tabBar: this.tabBar, approvals: this.approvals, input: this.input };
  }
}
