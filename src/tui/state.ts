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

export type TabId = 'chat' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy';

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
}

/**
 * Full UI-side state owned by TuiApp. Subsystems are read-only from here.
 *
 * Subsystem fields narrow to real types in Task 2 once snapshot.ts is defined.
 */
export interface SessionMetadata {
  readonly mode: 'auto' | 'ask' | 'bypass';
  readonly phase: SessionPhase;
  readonly version: string;
  readonly startedAt: number;
  readonly turns: number;
}

/**
 * Placeholder shape during Task 1. Task 2 narrows the subsystem field types.
 */
export interface DashboardSnapshot {
  readonly generatedAt: number;
  readonly session: SessionMetadata | null;
  readonly daemon: unknown;
  readonly approvals: unknown;
  readonly runtime: unknown;
  readonly sops: unknown;
  readonly policy: unknown;
}

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
  };
}

export function createInitialTuiAppState(): TuiAppState {
  return {
    lastSnapshot: undefined,
    activeTab: 'chat',
    views: {
      chat: createInitialPerTabState(),
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
