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

/** A capability invocation surfaced in the chat timeline. */
export interface CapabilityInvocationEntry {
  invocationId: string;
  capabilityId: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  error?: string;
  at: number;
}

/** Who produced a timeline event. Add `'system'` when the first system event exists (YAGNI). */
export type TimelineSource = 'operator' | 'agent' | 'capability';

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

/** A conversation-turn / capability event in the operator timeline. */
export type TimelineEvent =
  | (TimelineEventBase & { kind: 'user'; text: string })
  | (TimelineEventBase & { kind: 'agent'; text: string })
  | (TimelineEventBase & { kind: 'capability';
      invocationId: string; capabilityId: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      output?: unknown; error?: string });

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
  /** Capability invocations surfaced in the chat timeline, oldest first. */
  capabilityInvocations: CapabilityInvocationEntry[];
  /** Unified operator timeline — user prompts, agent responses, capability
   *  invocations, ordered by (timestamp, sequence). Single source of truth
   *  for conversation; the chat/agent/copy views are projections of this. */
  timelineEvents: TimelineEvent[];
  /** Selected capability in the Capabilities tab (per-tab view state). */
  capabilitiesSelectedId?: string;
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
    capabilityInvocations: [],
    timelineEvents: [],
    panelScrollOffsets: { approvals: 0, sops: 0 },
    panelFocus: null,
  };
}

/** Writer-facing timeline input: a TimelineEvent minus the stamped base fields. */
export type TimelineEventInput =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'capability'; invocationId: string; capabilityId: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      output?: unknown; error?: string };

let timelineSequence = 0;
export function nextTimelineSequence(): number { return ++timelineSequence; }

/**
 * The ONLY writer path into the timeline. Stamps id/timestamp/sequence/source,
 * pushes, and returns the actual stored object (never a clone) so the caller
 * can hold it for in-place mutation (the capability presenter does this).
 */
export function appendTimelineEvent(state: PerTabState, event: TimelineEventInput): TimelineEvent {
  const sequence = nextTimelineSequence();
  const source: TimelineSource = event.kind === 'user' ? 'operator'
    : event.kind === 'agent' ? 'agent' : 'capability';
  const created = {
    ...event,
    id: `tl-${sequence}`,
    timestamp: Date.now(),
    sequence,
    source,
  } as TimelineEvent;
  state.timelineEvents.push(created);
  return created;
}

/** Ordered view of the timeline: by timestamp, then sequence (deterministic same-ms). Does not mutate input. */
export function getOrderedTimeline(events: readonly TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
}

/** Status suffix for a capability event — "core.session.list [completed ✓]". Shared by ChatView + copy. */
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

/** One-line rendering of a timeline event — shared by copy-scrollback so copy matches the chat view. */
export function formatTimelineEvent(event: TimelineEvent): string {
  switch (event.kind) {
    case 'user': return `→ ${event.text}`;
    case 'agent': return `← ${event.text}`;
    case 'capability': return `⚡ ${capabilityStatusText(event)}`;
  }
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
