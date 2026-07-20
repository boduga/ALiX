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
  /**
   * Optional canvas for coordinate-based terminal rendering.
   * When present, views should write into the canvas rather than
   * returning string[] rows.  The caller (TuiApp) is responsible
   * for rendering the final frame to stdout.
   */
  readonly canvas?: import('../canvas.js').TerminalCanvas;
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
  | { type: 'moveCursor'; cursor: number; pinnedBottom?: boolean }
  | { type: 'scheduleRefresh' }
  | { type: 'switchTab'; tab: TabId }
  | { type: 'resolveApproval'; approvalId: string; status: 'approved' | 'denied' };

export interface TuiView {
  readonly id: TabId;
  render(ctx: ViewRenderContext): ViewRenderResult;
  handleKey?(key: string, ctx: ViewInputContext): ViewAction;
  onActivate?(perTab: PerTabState): void;
  onDeactivate?(perTab: PerTabState): void;
}
