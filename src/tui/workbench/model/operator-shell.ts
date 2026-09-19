import type { DashboardSnapshot } from '../../snapshot.js';
import type { PerTabState } from '../../state.js';
import { SessionPhase } from '../../../agent/session.js';

export interface OperatorShellApproval {
  readonly count: number;
  readonly toolName: string;
}

export interface OperatorShellSnapshot {
  readonly workspace: string;
  readonly mode: 'auto' | 'ask' | 'bypass';
  readonly transcriptMode: 'compact' | 'detailed';
  readonly running: boolean;
  readonly tokensUsed: number;
  readonly filesTouched: number;
  readonly eventCount: number;
  readonly queuedMessages: number;
  readonly approval?: OperatorShellApproval;
  readonly agents?: {
    readonly active: number;
    readonly total: number;
    readonly running: number;
    readonly waitingApproval: number;
    readonly stalled: number;
    readonly knownCostUsd?: number;
    readonly costCoverage: number;
  };
}

/**
 * Projects the dashboard snapshot and agent-view state into the small set of
 * operator facts owned by Workbench chrome. Rendering stays independent of
 * mutable TuiApp state and never reaches into runtime services.
 */
export function projectOperatorShell(
  snap: DashboardSnapshot,
  agentState: PerTabState,
  liveMode?: 'auto' | 'ask' | 'bypass',
  queuedMessages = 0,
): OperatorShellSnapshot {
  const pending = agentState.pendingApprovals ?? [];
  const oldest = pending[0];
  const approval = oldest
    ? {
        count: pending.length,
        toolName: oldest.toolName || 'operation',
      }
    : undefined;
  const roster = snap.runtime?.agents;

  return {
    workspace: snap.cwd,
    mode: liveMode ?? snap.session?.mode ?? 'auto',
    transcriptMode: agentState.transcriptMode ?? 'compact',
    running: snap.session !== null && snap.session.phase !== SessionPhase.Idle,
    tokensUsed: snap.runtime?.metrics?.tokensUsed ?? 0,
    filesTouched: snap.session?.filesTouched ?? 0,
    eventCount: snap.runtime?.totalEventCount ?? 0,
    queuedMessages,
    ...(approval ? { approval } : {}),
    ...(roster ? { agents: {
      active: roster.active,
      total: roster.totals.agents,
      running: roster.totals.running,
      waitingApproval: roster.totals.waitingApproval,
      stalled: roster.totals.stalled,
      ...(roster.totals.knownCostUsd !== undefined ? { knownCostUsd: roster.totals.knownCostUsd } : {}),
      costCoverage: roster.totals.costCoverage,
    } } : {}),
  };
}
