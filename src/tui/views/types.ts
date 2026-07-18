import type { TabId } from '../state.js';
import type { DashboardSnapshot, PerTabState } from '../state.js';

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface ViewRenderContext {
  readonly snap: DashboardSnapshot;
  readonly dimensions: TerminalDimensions;
  readonly perTab: Readonly<PerTabState>;
}

export interface ViewInputContext {
  readonly snap: DashboardSnapshot;
  readonly dimensions: TerminalDimensions;
  readonly perTab: PerTabState;       // mutable from within handleKey only
}

export interface ViewRenderResult {
  readonly rows: string[];
  readonly hint?: string;
}

export type ViewAction =
  | { type: 'handled' }
  | { type: 'moveCursor'; cursor: number }
  | { type: 'scheduleRefresh' }
  | { type: 'switchTab'; tab: TabId };

export interface TuiView {
  readonly id: TabId;
  render(ctx: ViewRenderContext): ViewRenderResult;
  handleKey?(key: string, ctx: ViewInputContext): ViewAction;
  onActivate?(perTab: PerTabState): void;
  onDeactivate?(perTab: PerTabState): void;
}
