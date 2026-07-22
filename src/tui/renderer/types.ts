export interface RendererCapabilities {
  readonly name: string;
  readonly version: string;
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
}
