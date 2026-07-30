/**
 * Lifecycle phase owned by AgentSession. TUI may observe but never mutate.
 *
 * The enum is now defined in src/agent/session.ts (its semantic home) and
 * re-exported here to fix the triangular dependency where the agent layer
 * imported from the UI layer. This re-export keeps existing imports from
 * tui/state.ts working without changes.
 */
export { SessionPhase } from '../agent/session.js';

export type TabId = 'dashboard' | 'chat' | 'agent' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy';

/**
 * Approval request surfaced inline in the agent scrollback. Synced from
 * the dashboard snapshot on each refresh; resolved entries are pushed into
 * `resolvedApprovals` for the historical log.
 */
export interface PendingApproval {
  id: string;
  toolName: string;
  target: string;
  requestedAt: number;
}

/**
 * A resolved approval — moved here from pending after the operator
 * presses `a`/`d` (or the timeout fires). Rendered in the approvals tab
 * as a chronological log.
 */
export interface ResolvedApproval {
  id: string;
  toolName: string;
  target: string;
  status: 'approved' | 'denied' | 'expired';
  requestedAt: number;
  resolvedAt: number;
}

/**
 * Serializable UI state preserved per tab across switches. No Set, Map,
 * or function values — must round-trip through JSON.stringify.
 */
export interface PerTabState {
  cursor: number;
  scrollOffset: number;
  searchQuery: string;
  expandedSections: string[];
  lastEventArrivedAt: number;
  /**
   * Whether the live-event view is auto-following the tail. Set to
   * false when the user scrolls up; reset to true by onActivate when
   * the tab is re-entered. Only the runtime panel reads this.
   */
  pinnedBottom: boolean;
  /** Partial message typed into the input prompt before submit. */
  inputBuffer: string;
  /** Submitted prompts, oldest first; rendered in the chat scrollback. */
  submittedPrompts: string[];
  /** Agent responses received from AgentSession.processTurn, oldest first. */
  agentResponses: string[];
  /** Plan content from the most recent planning phase, if any. */
  planContent?: string;
  /**
   * Structured plan tasks from the most recent planning phase.
   * Rendered as a checklist before the plan markdown in the agent view.
   * Populated from AgentTurnResult.planTasks when available; callers
   * may fall back to parsePlanTasks(planContent, sessionId).
   */
  planTasks?: readonly PlanTask[];
  /**
   * Live approval requests, oldest first. Mirrored from snapshot.approvals.pending
   * each refresh; resolved entries are removed here and pushed to resolvedApprovals.
   */
  pendingApprovals: PendingApproval[];
  /**
   * Historical log of resolved approvals (approved/denied/expired). The approvals
   * tab reads from this; the agent scrollback shows a small "approved/denied"
   * marker where the request used to be.
   */
  resolvedApprovals: ResolvedApproval[];
  /**
   * Progress ledger text rendered by the agent loop. Displayed in the agent
   * view scrollback after the approval section.
   */
  progressLedger?: string;
  /**
   * Per-sidebar-panel scroll offset. Only the entries for panels that can
   * overflow their fixed-height box (approvals, sops) are meaningful; the
   * others stay at 0. Surfaced via `J`/`K` keys when the active tab is
   * approvals or sops. Clamped to `[0, total - maxDisplayed]` on each
   * paint so the offset can't point past the available content.
   */
  panelScrollOffsets: PanelScrollOffsets;
  /**
   * Which scrollable panel currently owns the `J`/`K` keys. Tied to the
   * active tab — the approvals tab focuses APPROVALS, the sops tab focuses
   * SOPS & POLICY. Null on every other tab so keys pass through silently.
   */
  panelFocus: PanelFocusId | null;
}

/** Panels that accept `J`/`K` scroll keys. Other panels (DAEMON, RUNTIME) have fixed content and can't overflow. */
export type PanelFocusId = 'approvals' | 'sops';

/** Scroll position keyed per scrollable panel. */
export interface PanelScrollOffsets {
  approvals: number;
  sops: number;
}

// Imported from snapshot.ts for use below; re-exported so callers can
// continue importing either from state.ts or directly from snapshot.ts.
import type { DashboardSnapshot, SessionMetadata } from './snapshot.js';
import type { PlanTask } from '../planning/plan-task.js';
export type { DashboardSnapshot, SessionMetadata };

export interface TuiAppState {
  lastSnapshot: DashboardSnapshot | undefined;
  activeTab: TabId;
  views: Record<TabId, PerTabState>;
  refreshGeneration: number;
  refreshStatus: 'idle' | 'building' | 'rendering';
  history: TabId[];
}

export function createInitialPerTabState(): PerTabState {
  return {
    cursor: 0,
    scrollOffset: 0,
    pinnedBottom: true,
    searchQuery: '',
    expandedSections: [],
    lastEventArrivedAt: 0,
    inputBuffer: '',
    submittedPrompts: [],
    agentResponses: [],
    pendingApprovals: [],
    resolvedApprovals: [],
    panelScrollOffsets: { approvals: 0, sops: 0 },
    panelFocus: null,
  };
}

export function createInitialTuiAppState(): TuiAppState {
  return {
    lastSnapshot: undefined,
    activeTab: 'dashboard',
    views: {
      dashboard: createInitialPerTabState(),
      chat: createInitialPerTabState(),
      agent: createInitialPerTabState(),
      daemon: createInitialPerTabState(),
      approvals: createInitialPerTabState(),
      runtime: createInitialPerTabState(),
      sops: createInitialPerTabState(),
      policy: createInitialPerTabState(),
    },
    refreshGeneration: 0,
    refreshStatus: 'idle',
    history: [],
  };
}
