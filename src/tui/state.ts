/**
 * Lifecycle phase owned by AgentSession. TUI may observe but never mutate.
 *
 * String-valued enum (not numeric) so `Object.values(SessionPhase).length === 6`
 * (TypeScript's numeric-emits reverse-mapping would otherwise double the count)
 * and so `JSON.stringify(session.phase)` produces a human-readable value.
 */
export enum SessionPhase {
  Understanding = 'Understanding',
  Planning = 'Planning',
  Executing = 'Executing',
  Verifying = 'Verifying',
  Summarizing = 'Summarizing',
  Idle = 'Idle',
}

export type TabId = 'chat' | 'agent' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy';

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
  /** Partial message typed into the input prompt before submit. */
  inputBuffer: string;
  /** Submitted prompts, oldest first; rendered in the chat scrollback. */
  submittedPrompts: string[];
  /** Agent responses received from AgentSession.processTurn, oldest first. */
  agentResponses: string[];
}

// Imported from snapshot.ts for use below; re-exported so callers can
// continue importing either from state.ts or directly from snapshot.ts.
import type { DashboardSnapshot, SessionMetadata } from './snapshot.js';
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
    searchQuery: '',
    expandedSections: [],
    lastEventArrivedAt: 0,
    inputBuffer: '',
    submittedPrompts: [],
    agentResponses: [],
  };
}

export function createInitialTuiAppState(): TuiAppState {
  return {
    lastSnapshot: undefined,
    activeTab: 'chat',
    views: {
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
