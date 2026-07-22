import type { OperatorRenderer, RendererCapabilities } from './types.js';
import type { OperatorViewState } from '../presentation/types.js';
import type { TerminalControl } from '../terminal-control.js';

export class NoopRenderer implements OperatorRenderer {
  capabilities(): RendererCapabilities {
    return { name: 'noop', version: '1.0.0', supportsMouse: false, supportsColor: false, supportsUnicode: false, supportsTrueColor: false };
  }
  async initialize(_terminal: TerminalControl): Promise<void> {}
  render(_viewState: OperatorViewState): void {}
  resize(_columns: number, _rows: number): void {}
  async shutdown(): Promise<void> {}
}
