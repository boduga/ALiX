/**
 * Lifecycle phase owned by AgentSession. TUI may observe but never mutate.
 *
 * The enum is now defined in src/agent/session.ts (its semantic home) and
 * re-exported here to fix the triangular dependency where the agent layer
 * imported from the UI layer. This re-export keeps existing imports from
 * tui/state.ts working without changes.
 */
export { SessionPhase } from '../agent/session.js';

export type TabId =
  | 'dashboard' | 'chat' | 'agent' | 'daemon' | 'approvals'
  | 'runtime' | 'sops' | 'policy' | 'capabilities' | 'evolution';

/** Tab order for the tab row and Ctrl+digit cycling. Single shared copy —
 *  previously forked between app.ts (navigation) and frame-painter.ts (tab
 *  row), so adding a tab forced two edits. */
export const TAB_ORDER: readonly TabId[] = ['dashboard', 'chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy', 'capabilities', 'evolution'];

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

/** Client-side filter for the Runtime tab's execution trace (view-local presentation state). */
export type RuntimeTraceFilter = 'all' | 'tool' | 'capability' | 'policy' | 'runtime';

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
   * Progress ledger text produced by the agent loop. It remains mirrored in
   * per-tab state for non-render consumers, but is no longer displayed here.
   */
  progressLedger?: string;
  /**
   * Pending tool calls rendered as two-line entries in the agent scrollback.
   * Line 1: tool marker (→) + tool name — dim style.
   * Line 2: 2-space indent + summary — dim style, only if summary present.
   * Synced from snapshot.session.pendingToolCalls each refresh.
   */
  pendingToolCalls?: Array<{ name: string; summary?: string }>;
  /**
   * Retained for snapshot compatibility; the agent tab no longer exposes a
   * ledger toggle, so this field is intentionally inert.
   */
  ledgerExpanded?: boolean;
  /**
   * Classified agent intent for the current iteration. Set from snapshot
   * session metadata on each refresh. Undefined when the session does not
   * expose intent (defaults to research, which renders no badge).
   */
  currentIntent?: 'research' | 'mutation' | 'validation';
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
  /** Selected capability in the Capabilities tab (per-tab view state). */
  capabilitiesSelectedId?: string;
  /** Q-L1 — selected capability in the evolution spine (lazy-init). */
  evolutionSelectedCapabilityId?: string;
  /** Q-L2 — expanded stage within the selected capability's spine. */
  evolutionExpandedStage?: 'lifecycle' | 'learning' | 'forecasts' | 'decisions' | 'measurements' | 'correlations' | null;
  /** Q-L3 — read-only inspector target (reference-by-id). */
  evolutionInspector?: { type: 'forecast' | 'recommendation' | 'decision' | 'measurement' | 'correlation'; id: string } | null;
  /** Q-L2 — flat index mode (f key). */
  evolutionFlatView?: 'forecasts' | 'decisions' | 'measurements' | 'correlations' | null;
  /**
   * Q-L2 — stage cursor within the selected capability's spine (right pane).
   * Which of the six stage rows owns the arrow keys when the right pane has
   * focus and no stage is expanded. Defaults to 'lifecycle'.
   */
  evolutionStageCursor?: 'lifecycle' | 'learning' | 'forecasts' | 'decisions' | 'measurements' | 'correlations' | null;
  /** Q-L2 — artifact cursor within the expanded stage (right pane, deep level). Defaults to 0. */
  evolutionArtifactCursor?: number | null;
  /**
   * Q-L2 — which pane owns the arrow keys (hierarchy depth). 'capability' =
   * left capability list, 'stage' = right spine's six stage rows, 'artifact' =
   * the expanded stage's artifact list. Esc ascends one level, Enter descends.
   */
  evolutionFocus?: 'capability' | 'stage' | 'artifact' | null;
  /** Active execution-trace filter on the Runtime tab. Default 'all'. */
  runtimeTraceFilter: RuntimeTraceFilter;
  /**
   * Live-streamed assistant text for the in-flight agent turn, appended
   * token-by-token via `TuiApp.appendAgentStreamToken`. Rendered as a single
   * growing line pinned at the bottom of the agent scrollback; folded into a
   * normal scrollback entry when the turn completes. Cleared on fold so it
   * never renders twice. Undefined when no agent turn is streaming.
   */
  streamingText?: string;
  /**
   * True while an agent turn is in flight. Gates `appendAgentStreamToken`
   * so post-completion/timeout stragglers can't resurrect the growing line
   * after it has been folded into the scrollback. Absent/false both mean
   * "not streaming" (matches the optional-field style of the other
   * transient PerTabState fields); `createInitialPerTabState` seeds false.
   */
  streamingActive?: boolean;
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
    pendingApprovals: [],
    resolvedApprovals: [],
    panelScrollOffsets: { approvals: 0, sops: 0 },
    panelFocus: null,
    runtimeTraceFilter: 'all',
    evolutionSelectedCapabilityId: undefined,
    evolutionExpandedStage: null,
    evolutionInspector: null,
    evolutionFlatView: null,
    evolutionStageCursor: 'lifecycle',
    evolutionArtifactCursor: 0,
    evolutionFocus: 'capability',
    streamingActive: false,
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
      capabilities: createInitialPerTabState(),
      evolution: createInitialPerTabState(),
    },
    refreshGeneration: 0,
    refreshStatus: 'idle',
    history: [],
  };
}
