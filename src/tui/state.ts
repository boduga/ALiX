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
  | 'runtime' | 'sops' | 'policy' | 'capabilities';

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

/** Who produced a timeline event. Add `'system'` when the first system event exists (YAGNI). */
export type TimelineSource = 'operator' | 'agent' | 'capability';

/** Client-side filter for the Runtime tab's execution trace (view-local presentation state). */
export type RuntimeTraceFilter = 'all' | 'tool' | 'capability' | 'policy' | 'runtime';

export interface TimelineEventBase {
  /** Runtime-local deterministic id: `tl-${sequence}`. Unique within one TUI
   *  runtime instance; NOT globally unique across sessions. If persistence
   *  arrives, introduce `timelineId = sessionId + sequence` without changing
   *  this model. */
  id: string;
  /** Date.now() at append. */
  timestamp: number;
  /** Monotonic per-runtime counter — the ordering tiebreak. */
  sequence: number;
  /** Who produced the event — orthogonal to `kind`. Stamped by
   *  appendTimelineEvent; writers never set it. */
  source: TimelineSource;
}

/** Fields shared by the capability TimelineEvent variant and its writer input. */
export interface CapabilityEventFields {
  invocationId: string;
  capabilityId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  error?: string;
}

/** A conversation-turn / capability event in the operator timeline. */
export type TimelineEvent =
  | (TimelineEventBase & { kind: 'user'; text: string })
  | (TimelineEventBase & { kind: 'agent'; text: string })
  | (TimelineEventBase & { kind: 'capability' } & CapabilityEventFields);

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
   * Progress ledger text rendered by the agent loop. Displayed in the agent
   * view scrollback after the approval section.
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
   * Whether the progress ledger is expanded (shows all lines) or collapsed
   * (shows only the last 3 lines). Toggled by pressing `e` in the agent view.
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
  /** Active execution-trace filter on the Runtime tab. Default 'all'. */
  runtimeTraceFilter: RuntimeTraceFilter;
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
import type { EventLog } from '../events/event-log.js';
import { appendLogEntry } from './log-emit.js';
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
  };
}

/**
 * @deprecated Phase-3 writer-facing timeline input. Retained ONLY because the
 * deprecated `appendTimelineEvent` compatibility wrapper's signature needs it —
 * the EventLog is now the single source of truth timeline. REMOVED in Phase 7.
 */
export type TimelineEventInput =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'capability' } & CapabilityEventFields;

let timelineSequence = 0;
export function nextTimelineSequence(): number { return ++timelineSequence; }

/**
 * Emit context for the timeline's log emit (D7/D9, Phase 6). When present,
 * the deprecated `appendTimelineEvent` wrapper (and the TUI's direct emits)
 * write a typed log entry into the EventLog — the log is the single source of
 * truth timeline; the old in-memory `timelineEvents[]` cache is gone. `sessionId`
 * is the stamped origin (D1/D3) — the routing dimension the collector projects on.
 */
export interface TimelineEmitContext {
  readonly eventLog: EventLog;
  readonly sessionId: string;
}

/**
 * @deprecated Phase-3 writer path into the in-memory timeline, kept as a
 * FUNCTIONAL compatibility wrapper for one phase. The EventLog is now the
 * single source of truth timeline (D9 cleanup in Phase 6): the per-tab
 * `timelineEvents[]` cache was removed, so this no longer pushes anywhere —
 * it only emits a typed log entry via the optional `emit` context (kind
 * mapping is the Phase-3 vocabulary: `user → chat.message`, `agent →
 * chat.response`; `capability` is deliberately NOT mapped — at append time
 * its status is `running` with no display text, and the capability presenter
 * emits the single authoritative chat-surface entry at settlement). It does
 * NOT throw, so non-TUI consumers (web UI, CLI, replay tools, automation
 * workers) can keep compiling against it. Returns nothing — there is no
 * in-memory timeline anymore, so a fabricated TimelineEvent would be a dead
 * entry. REMOVED in Phase 7.
 */
export function appendTimelineEvent(
  _state: PerTabState,                              // retained ONLY for the Phase-3 compat signature; unused
  event: TimelineEventInput,
  emit?: TimelineEmitContext,                       // optional — preserves Phase 3 callers
): void {
  console.warn('appendTimelineEvent is deprecated (Phase 6): use EventLog.append() with a typed entry. Removed in Phase 7.');
  if (!emit) return;
  const kindToType: Partial<Record<TimelineEvent['kind'], 'chat.message' | 'chat.response'>> = {
    user: 'chat.message',
    agent: 'chat.response',
  };
  const type = kindToType[event.kind];
  if (!type) return; // capability NOT mapped (D7/D9) — the presenter emits the settled entry
  const text = (event as { text?: string }).text;
  const detail = (event as { detail?: string }).detail;
  appendLogEntry(emit.eventLog, {
    sessionId: emit.sessionId,
    actor: event.kind === 'user' ? 'user' : 'agent',
    type,
    payload: {
      ...(text !== undefined ? { text } : {}),
      ...(detail !== undefined ? { detail } : {}),
    },
  });
}

/** Status suffix for a capability event — "core.session.list [completed ✓]". Shared by the presenter's log emit. */
export function capabilityStatusText(event: Extract<TimelineEvent, { kind: 'capability' }>): string {
  let text = event.capabilityId;
  if (event.status === 'running') text += ' [running]';
  else if (event.status === 'completed') {
    text += ' [completed ✓]';
    // Review fix: append output ONLY when present — avoids "[completed ✓] """
    // for empty output and "undefined" for absent output.
    if (event.output !== undefined && event.output !== '') text += ` ${JSON.stringify(event.output)}`;
  } else if (event.status === 'failed') text += ` [failed ✗] ${event.error ?? ''}`;
  else text += ' [cancelled]';
  return text.trim();
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
    },
    refreshGeneration: 0,
    refreshStatus: 'idle',
    history: [],
  };
}
