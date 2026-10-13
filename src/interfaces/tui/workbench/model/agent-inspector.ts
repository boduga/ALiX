import type { DashboardSnapshot, ApprovalRecordSnapshot } from '../../snapshot.js';
import type { AgentSummary } from './agent-roster.js';
import type { TaskSummary } from './task-roster.js';
import type { WorkbenchInspectableItem } from './artifact-inspection.js';
import type { AgentActivityState } from '../../../../agents/agent/agent-activity.js';
import { visibleArtifacts, visibleForRun, approvalVisibleTo } from './selection.js';

export interface AgentInspectorModel {
  readonly selection: 'selected' | 'aggregate' | 'missing' | 'unavailable';
  readonly agent?: AgentSummary;
  readonly task?: TaskSummary;
  readonly explicitTaskSelection: boolean;
  readonly agentCount?: number;
  readonly runningCount?: number;
  readonly approvals: readonly ApprovalRecordSnapshot[] | null;
  readonly artifacts: readonly WorkbenchInspectableItem[] | null;
  readonly activity?: { readonly toolName: string; readonly toolCallId: string; readonly startedAt: number; readonly elapsedMs: number; readonly status: string };
  /**
   * Session-scoped LIVE ACTIVITY for the foreground agent when no roster row
   * describes it (the empty-roster/single-agent case). Populated from
   * `snap.session.activity`; never coexists with `activity` (roster wins when
   * a selected agent exists). `elapsedMs` is recomputed from `now` at join
   * time so a clock-only repaint advances it without moving progress marks.
   */
  readonly sessionActivity?: { readonly state: AgentActivityState; readonly operation?: string; readonly toolName?: string; readonly startedAt: number; readonly elapsedMs: number };
  readonly tokens?: number;
  readonly tokensPartial: boolean;
  readonly costUsd?: number;
  readonly costPartial: boolean;
}
const known = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0;

/** Join immutable, already session-scoped snapshots; labels never establish identity. */
export function buildAgentInspectorModel(
  snapshot: DashboardSnapshot,
  scope: { readonly selectedAgentId?: string; readonly selectedRunId?: string; readonly selectedTaskId?: string } = {},
  now = snapshot.generatedAt,
): AgentInspectorModel {
  const runtime = snapshot.runtime;
  const roster = runtime?.agents;
  const agents = visibleForRun(roster?.agents ?? [], scope.selectedRunId);
  const matches = agents.filter((entry) => entry.agentId === scope.selectedAgentId);
  const agent = scope.selectedAgentId && matches.length === 1 ? matches[0] : undefined;
  const selection = !roster ? 'unavailable' : scope.selectedAgentId ? agent ? 'selected' : 'missing' : 'aggregate';
  const tasks = (runtime?.tasks?.tasks ?? []).filter((entry) =>
    agent && entry.agentId === agent.agentId && entry.coordinationRunId === agent.coordinationRunId &&
    entry.taskId === (scope.selectedTaskId ?? agent.currentTaskId));
  const task = tasks.length === 1 ? tasks[0] : undefined;
  const missing = selection === 'missing' || selection === 'unavailable';
  const approvals = !snapshot.approvals || missing ? null : snapshot.approvals.pending.filter((entry) => approvalVisibleTo(entry, agent?.agentId));
  const artifacts = !runtime?.artifacts || missing ? null : visibleArtifacts(runtime.artifacts.items, {
    runId: scope.selectedRunId ?? agent?.coordinationRunId, agentId: agent?.agentId,
    taskId: scope.selectedTaskId,
  });
  const active = agent?.activeTool;
  // Projection owns correlation/clearing; terminal agents cannot retain a live call.
  const terminal = agent && ['completed', 'partial', 'failed', 'cancelled'].includes(agent.state);
  const completedCall = active && runtime?.trace.some((entry) => entry.kind === 'tool' && entry.agentId === agent?.agentId && entry.toolMetadata?.toolCallId === active.toolCallId && entry.status !== 'running');
  const activity = active && !terminal && !completedCall ? {
    toolName: active.toolName, toolCallId: active.toolCallId, startedAt: active.startedAt,
    elapsedMs: Number.isFinite(now) && Number.isFinite(active.startedAt) ? Math.max(0, now - active.startedAt) : active.elapsedMs,
    status: agent?.currentOperation ?? 'running tool',
  } : undefined;
  // Session-scoped fallback (empty roster / single-agent session): the
  // foreground agent emits no `agent.spawned`, so no roster row describes it.
  // Read the live session activity the runtime already exposes rather than
  // leaving LIVE ACTIVITY on a dead "Select an agent for activity" row.
  // Roster activity always wins; terminal/absent session activity stays empty.
  const sessionActivity = !activity && selection === 'aggregate' && snapshot.session?.activity &&
    !['completed', 'failed', 'cancelled'].includes(snapshot.session.activity.state)
    ? {
        state: snapshot.session.activity.state,
        ...(snapshot.session.activity.operation ? { operation: snapshot.session.activity.operation } : {}),
        ...(snapshot.session.activity.toolName ? { toolName: snapshot.session.activity.toolName } : {}),
        startedAt: snapshot.session.activity.startedAt,
        elapsedMs: Number.isFinite(now) && Number.isFinite(snapshot.session.activity.startedAt)
          ? Math.max(0, now - snapshot.session.activity.startedAt)
          : snapshot.session.activity.elapsedMs,
      }
    : undefined;
  const usageAgents = agent ? [agent] : selection === 'aggregate' ? agents : [];
  const tokens = usageAgents.map((entry) => known(entry.usage.totalTokens) ? entry.usage.totalTokens : known(entry.usage.inputTokens) && known(entry.usage.outputTokens) && known(entry.usage.inputTokens + entry.usage.outputTokens) ? entry.usage.inputTokens + entry.usage.outputTokens : undefined).filter(known);
  const costs = usageAgents.map((entry) => entry.usage.costUsd).filter(known);
  // Empty-roster aggregate: the session metrics projection owns the
  // session-scoped token total the footer already prints (`TOKENS`). Surface
  // the same authoritative number here instead of "unavailable". Never
  // fabricate a value when the projection is absent — absence stays unavailable.
  const sessionTokens = selection === 'aggregate' && usageAgents.length === 0 ? snapshot.runtime?.metrics?.tokensUsed : undefined;
  const tokenTotal = tokens.length && known(tokens.reduce((sum, value) => sum + value, 0))
    ? tokens.reduce((sum, value) => sum + value, 0)
    : known(sessionTokens) ? sessionTokens : undefined;
  return {
    selection, agent, task, explicitTaskSelection: scope.selectedTaskId !== undefined, agentCount: roster ? agents.length : undefined,
    runningCount: roster ? agents.filter((entry) => ['starting', 'thinking', 'tool_running', 'verifying'].includes(entry.state)).length : undefined,
    approvals, artifacts, activity, sessionActivity,
    tokens: tokenTotal,
    tokensPartial: tokens.length > 0 && tokens.length < usageAgents.length,
    costUsd: costs.length && known(costs.reduce((sum, value) => sum + value, 0)) ? costs.reduce((sum, value) => sum + value, 0) : undefined,
    costPartial: costs.length > 0 && costs.length < usageAgents.length,
  };
}
