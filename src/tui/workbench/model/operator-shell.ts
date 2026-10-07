import type { DashboardSnapshot } from '../../snapshot.js';
import type { PerTabState } from '../../state.js';
import { SessionPhase } from '../../../agent/session.js';
import type { AgentLivenessState } from '../../../agent/agent-liveness.js';

export interface OperatorShellApproval {
  readonly count: number;
  readonly toolName: string;
}

/**
 * Top status line facts. Structured timestamps only — painters format the
 * elapsed text at paint time so the line reads from a fresh clock.
 */
export type OperatorShellStatus =
  | { readonly kind: 'approval-wait'; readonly requestedAt: number }
  | {
      readonly kind: 'liveness';
      readonly startedAt: number;
      readonly lastProgressAt: number;
      readonly state: AgentLivenessState;
      readonly lastProgressKind?: string;
      readonly lastProgressDescription?: string;
    };

export interface OperatorShellSnapshot {
  readonly workspace: string;
  readonly mode: 'auto' | 'ask' | 'bypass';
  readonly transcriptMode: 'compact' | 'detailed';
  readonly running: boolean;
  readonly tokensUsed?: number;
  readonly filesTouched?: number;
  readonly eventCount?: number;
  readonly queuedMessages: number;
  readonly escapeAction?: 'close' | 'cancel' | 'none';
  readonly demo?: boolean;
  readonly focus?: 'composer' | 'transcript' | 'drawer' | 'modal';
  readonly drawer?: 'closed' | 'agents' | 'tasks' | 'artifacts';
  readonly inspectorOpen?: boolean;
  readonly approval?: OperatorShellApproval;
  readonly status?: OperatorShellStatus;
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
  presentation: { readonly closeSurface?: boolean; readonly demo?: boolean; readonly focus?: OperatorShellSnapshot['focus']; readonly drawer?: OperatorShellSnapshot['drawer']; readonly inspectorOpen?: boolean } = {},
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
  const running = snap.session !== null && snap.session.phase !== SessionPhase.Idle;
  const liveness = snap.session?.liveness;
  // A pending approval REPLACES generic running liveness in the top status
  // line; liveness surfaces only while running with a snapshot present.
  const status: OperatorShellSnapshot['status'] = oldest
    ? { kind: 'approval-wait', requestedAt: oldest.requestedAt }
    : running && liveness
      ? {
          kind: 'liveness',
          startedAt: liveness.startedAt,
          lastProgressAt: liveness.lastProgressAt,
          state: liveness.state,
          lastProgressKind: liveness.lastProgressKind,
          lastProgressDescription: liveness.lastProgressDescription,
        }
      : undefined;

  return {
    workspace: snap.cwd,
    mode: liveMode ?? snap.session?.mode ?? 'auto',
    transcriptMode: agentState.transcriptMode ?? 'compact',
    running,
    tokensUsed: snap.runtime?.metrics?.tokensUsed,
    filesTouched: snap.session?.filesTouched,
    eventCount: snap.runtime?.totalEventCount,
    queuedMessages,
    escapeAction: presentation.closeSurface ? 'close' : running ? 'cancel' : 'none',
    ...(presentation.demo ? { demo: true } : {}),
    ...(presentation.focus ? { focus: presentation.focus } : {}),
    ...(presentation.drawer ? { drawer: presentation.drawer } : {}),
    ...(presentation.inspectorOpen ? { inspectorOpen: true } : {}),
    ...(approval ? { approval } : {}),
    ...(status ? { status } : {}),
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
