import type { DashboardSnapshot, ApprovalRecordSnapshot } from '../../snapshot.js';
import type { AgentSummary } from './agent-roster.js';
import type { TaskSummary } from './task-roster.js';
import type { WorkbenchInspectableItem } from './artifact-inspection.js';
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
  const usageAgents = agent ? [agent] : selection === 'aggregate' ? agents : [];
  const tokens = usageAgents.map((entry) => known(entry.usage.totalTokens) ? entry.usage.totalTokens : known(entry.usage.inputTokens) && known(entry.usage.outputTokens) && known(entry.usage.inputTokens + entry.usage.outputTokens) ? entry.usage.inputTokens + entry.usage.outputTokens : undefined).filter(known);
  const costs = usageAgents.map((entry) => entry.usage.costUsd).filter(known);
  return {
    selection, agent, task, explicitTaskSelection: scope.selectedTaskId !== undefined, agentCount: roster ? agents.length : undefined,
    runningCount: roster ? agents.filter((entry) => ['starting', 'thinking', 'tool_running', 'verifying'].includes(entry.state)).length : undefined,
    approvals, artifacts, activity,
    tokens: tokens.length && known(tokens.reduce((sum, value) => sum + value, 0)) ? tokens.reduce((sum, value) => sum + value, 0) : undefined,
    tokensPartial: tokens.length > 0 && tokens.length < usageAgents.length,
    costUsd: costs.length && known(costs.reduce((sum, value) => sum + value, 0)) ? costs.reduce((sum, value) => sum + value, 0) : undefined,
    costPartial: costs.length > 0 && costs.length < usageAgents.length,
  };
}
