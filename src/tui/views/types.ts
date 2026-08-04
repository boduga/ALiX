import type { TabId } from '../state.js';
import type { DashboardSnapshot, PerTabState } from '../state.js';
import type { RuntimeSnapshot } from '../snapshot.js';

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

/**
 * Per-tab projected runtime snapshots (Phase 6, D6/D9). Injected by TuiApp from
 * the two sub-session collectors wired via `TuiAppOptions.runtimeCollectors` —
 * `chat` projects `${sessionId}-chat`, `agent` projects `${sessionId}-agent`.
 * Each view reads the snapshot for its own tab and filters `timeline` by kind
 * (`chat.*` for ChatView, `agent.*` for AgentView). Null when the collector is
 * not wired (unit tests) or has not sampled yet — views must fall back to an
 * empty timeline. Distinct from `DashboardSnapshot.runtime` (`snap.runtime`),
 * which is the OUTER-scoped runtime used by the Runtime tab's execution trace.
 */
export interface PerTabRuntime {
  readonly chat: RuntimeSnapshot | null;
  readonly agent: RuntimeSnapshot | null;
}

/** One candidate row in the slash-completion strip. */
export interface SlashStripEntry {
  /** Canonical skill name. */
  name: string;
  /** Primary slash label, e.g. "/tdd". */
  label: string;
  description: string;
}

/** Completion strip state passed to chat/agent views while slash mode is active. */
export interface SlashStrip {
  entries: SlashStripEntry[];
  /** Index of the highlighted candidate (Tab-cycled). */
  selected: number;
  /** Inline hint (e.g. "Unknown skill ..."), or null. */
  hint: string | null;
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
  /** Theme name for render pipeline. Defaults to 'dark'. */
  readonly themeName?: string;
  /** Phase 6 (D6/D9): projected chat/agent sub-session runtime snapshots. */
  readonly runtime?: PerTabRuntime;
  /** Slash-command completion strip, present only while slash mode is active. */
  readonly slash?: SlashStrip;
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
  | { type: 'scroll'; offset: number }
  | { type: 'scheduleRefresh' }
  | { type: 'switchTab'; tab: TabId }
  | { type: 'resolveApproval'; approvalId: string; status: 'approved' | 'denied' }
  | { type: 'copyScrollback' };

export interface TuiView {
  readonly id: TabId;
  render(ctx: ViewRenderContext): ViewRenderResult;
  handleKey?(key: string, ctx: ViewInputContext): ViewAction;
  onActivate?(perTab: PerTabState): void;
  onDeactivate?(perTab: PerTabState): void;
}
