import type { TabId } from '../state.js';

export type RendererEvent =
  | { type: 'exit' }
  | { type: 'switchTab'; tab: TabId }
  | { type: 'cycleTab'; forward: boolean }
  | { type: 'homeTab' }
  | { type: 'focusInput' }
  | { type: 'blurInput' }
  | { type: 'inputChanged'; value: string }
  | { type: 'submitInput'; value: string }
  | {
      type: 'resolveApproval';
      status: 'approved' | 'denied';
    };

export interface RendererCapabilities {
  readonly name: string;
  readonly version: string;
  readonly handlesInput: boolean;
  readonly supportsMouse: boolean;
  readonly supportsColor: boolean;
  readonly supportsUnicode: boolean;
  readonly supportsTrueColor: boolean;
}

export interface OperatorRenderer {
  capabilities(): RendererCapabilities;
  initialize(terminal: import('../terminal-control.js').TerminalControl): Promise<void>;
  render(viewState: import('../presentation/types.js').OperatorViewState): void;
  resize(columns: number, rows: number): void;
  shutdown(): Promise<void>;

  /** Renderer -> application lifecycle communication. */
  onEvent?: (event: RendererEvent) => void;
}
