import type { AlixEvent } from '../../../events/types.js';
import { DEFAULT_LIVENESS_THRESHOLDS, type AgentLivenessThresholds } from '../../../agent/agent-liveness.js';
import type { ProjectionBuilder } from '../../runtime/projection-builder.js';
import type { AgentRosterSnapshot, AgentSummary, WorkbenchAgentState } from '../model/agent-roster.js';

const terminalStates = new Set<WorkbenchAgentState>(['completed', 'partial', 'failed', 'cancelled']);
const runningStates = new Set<WorkbenchAgentState>(['starting', 'thinking', 'tool_running', 'verifying', 'cancelling']);
const stallExemptStates = new Set<WorkbenchAgentState>(['tool_running', 'waiting', 'waiting_approval', 'waiting_dependency']);
const progressEvents = new Set([
  'agent.spawned', 'subagent.started', 'agent.state_changed', 'agent.task_assigned', 'agent.plan',
  'agent.response.delta', 'agent.usage', 'approval.requested', 'approval.created', 'approval.resolved',
  'tool.requested', 'tool.started', 'tool.output', 'tool.completed', 'tool.failed', 'tool.cancelled',
]);

function payload(event: AlixEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function agentId(event: AlixEvent): string | undefined {
  const p = payload(event);
  const value = p.agentId ?? p.subagentId ?? p.taskId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stateOf(value: unknown, fallback: WorkbenchAgentState): WorkbenchAgentState {
  const normalized = String(value ?? '').toLowerCase().replaceAll('-', '_');
  const aliases: Record<string, WorkbenchAgentState> = {
    pending: 'queued', running: 'thinking', executing: 'tool_running', done: 'completed',
    success: 'completed', error: 'failed', rejected: 'failed',
  };
  const candidate = aliases[normalized] ?? normalized;
  return [
    'queued', 'starting', 'thinking', 'tool_running', 'waiting', 'waiting_approval', 'waiting_dependency', 'verifying',
    'completed', 'partial', 'failed', 'cancelling', 'cancelled',
  ].includes(candidate) ? candidate as WorkbenchAgentState : fallback;
}

export class AgentRosterProjection implements ProjectionBuilder<AgentRosterSnapshot> {
  private readonly byId = new Map<string, AgentSummary>();
  private readonly seen = new Set<string>();
  private readonly pendingApprovals = new Map<string, { agentId: string; previousState: WorkbenchAgentState }>();

  update(events: readonly AlixEvent[]): void {
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      const p = payload(event);
      const approvalId = typeof p.approvalId === 'string' && p.approvalId.length > 0 ? p.approvalId : undefined;
      const pending = approvalId ? this.pendingApprovals.get(approvalId) : undefined;
      const id = agentId(event) ?? pending?.agentId;
      if (!id) continue;
      const at = Date.parse(event.timestamp) || 0;
      const previous = this.byId.get(id);
      if (event.type === 'subagent.started' || event.type === 'agent.spawned') {
        this.byId.set(id, {
          agentId: id,
          ...(typeof p.parentAgentId === 'string' ? { parentAgentId: p.parentAgentId } : {}),
          ...(typeof p.coordinationRunId === 'string' ? { coordinationRunId: p.coordinationRunId } : {}),
          ...(typeof p.assignedAgentId === 'string' ? { assignedAgentId: p.assignedAgentId } : {}),
          ...(typeof p.taskLabel === 'string' ? { taskLabel: p.taskLabel } : {}),
          role: typeof p.role === 'string' ? p.role : previous?.role ?? 'agent',
          ...(typeof p.model === 'string' ? { model: p.model } : previous?.model ? { model: previous.model } : {}),
          state: stateOf(p.state, 'starting'),
          currentTaskId: typeof p.taskId === 'string' ? p.taskId : previous?.currentTaskId ?? id,
          currentOperation: typeof p.operation === 'string'
            ? p.operation
            : typeof p.prompt === 'string' ? p.prompt : previous?.currentOperation,
          ownedPaths: Array.isArray(p.ownedPaths) ? p.ownedPaths.filter((v): v is string => typeof v === 'string') : previous?.ownedPaths ?? [],
          startedAt: previous?.startedAt ?? at,
          lastProgressAt: at,
          usage: previous?.usage ?? {},
        });
        continue;
      }
      if (!previous) continue;
      let state = previous.state;
      let activeTool = previous.activeTool;
      const toolCallId = typeof p.toolCallId === 'string' && p.toolCallId.length > 0 ? p.toolCallId : undefined;
      const toolName = typeof p.toolName === 'string' && p.toolName.length > 0 ? p.toolName : undefined;
      if ((event.type === 'approval.requested' || event.type === 'approval.created') && approvalId) {
        if (!pending) {
          this.pendingApprovals.set(approvalId, { agentId: id, previousState: previous.state });
        }
        state = 'waiting_approval';
      } else if (event.type === 'approval.resolved' && pending) {
        state = pending.previousState;
        this.pendingApprovals.delete(approvalId!);
      } else if (event.type === 'tool.started' && toolCallId && toolName) {
        state = 'tool_running';
        activeTool = { toolCallId, toolName, startedAt: at, lastProgressAt: at, elapsedMs: 0 };
      } else if (event.type === 'tool.output' && activeTool && toolCallId === activeTool.toolCallId) {
        activeTool = { ...activeTool, lastProgressAt: at, elapsedMs: Math.max(0, at - activeTool.startedAt) };
      } else if (['tool.completed', 'tool.failed', 'tool.cancelled'].includes(event.type) && toolCallId === activeTool?.toolCallId) {
        activeTool = undefined;
        if (!terminalStates.has(state) && state !== 'waiting_approval') state = 'thinking';
      } else if (event.type === 'subagent.result') state = stateOf(p.status, 'failed');
      else if (event.type === 'agent.completed' || event.type === 'subagent.completed') state = stateOf(p.state ?? p.status, 'completed');
      else if (event.type === 'agent.failed' || event.type === 'subagent.failed') state = 'failed';
      else if (event.type === 'agent.cancelled') state = 'cancelled';
      else if (event.type === 'agent.state_changed') state = stateOf(p.state, previous.state);
      if (terminalStates.has(state)) activeTool = undefined;
      const ownedPaths = event.type === 'agent.ownership_changed' && Array.isArray(p.ownedPaths)
        ? p.ownedPaths.filter((v): v is string => typeof v === 'string')
        : previous.ownedPaths;
      const usage = event.type === 'agent.usage'
        ? {
            ...previous.usage,
            ...(finiteNonNegative(p.inputTokens) !== undefined ? { inputTokens: finiteNonNegative(p.inputTokens) } : {}),
            ...(finiteNonNegative(p.outputTokens) !== undefined ? { outputTokens: finiteNonNegative(p.outputTokens) } : {}),
            ...(finiteNonNegative(p.cacheTokens) !== undefined ? { cacheTokens: finiteNonNegative(p.cacheTokens) } : {}),
            ...(finiteNonNegative(p.totalTokens) !== undefined ? { totalTokens: finiteNonNegative(p.totalTokens) } : {}),
            ...(finiteNonNegative(p.contextWindowTokens) !== undefined ? { contextWindowTokens: finiteNonNegative(p.contextWindowTokens) } : {}),
            ...(finiteNonNegative(p.costUsd) !== undefined ? { costUsd: finiteNonNegative(p.costUsd) } : {}),
            ...(typeof p.provider === 'string' && p.provider.length > 0 ? { provider: p.provider } : {}),
            ...(typeof p.costSource === 'string' && p.costSource.length > 0 ? { costSource: p.costSource } : {}),
          }
        : previous.usage;
      const { activeTool: priorActiveTool, ...previousWithoutActiveTool } = previous;
      void priorActiveTool;
      this.byId.set(id, {
        ...previousWithoutActiveTool,
        state,
        ...(activeTool ? { activeTool } : {}),
        ownedPaths,
        usage,
        ...((event.type === 'agent.usage' && typeof (p.resolvedModel ?? p.model) === 'string')
          ? { model: String(p.resolvedModel ?? p.model) }
          : {}),
        lastProgressAt: progressEvents.has(event.type) ? at : previous.lastProgressAt,
        ...(typeof p.operation === 'string' ? { currentOperation: p.operation } : {}),
      });
    }
  }

  snapshot(now = Date.now(), thresholds: AgentLivenessThresholds = DEFAULT_LIVENESS_THRESHOLDS): AgentRosterSnapshot {
    const agents = [...this.byId.values()]
      .map((agent): AgentSummary => {
        if (terminalStates.has(agent.state) || stallExemptStates.has(agent.state)) return agent;
        const idleMs = Math.max(0, now - agent.lastProgressAt);
        const state = idleMs >= thresholds.stalledAfterMs
          ? 'stalled'
          : idleMs >= thresholds.warningAfterMs ? 'warning' : 'healthy';
        return { ...agent, liveness: { state, idleMs } };
      })
      .sort((a, b) => a.startedAt - b.startedAt || a.agentId.localeCompare(b.agentId));
    const tokenValues = agents.flatMap((agent) => {
      const value = agent.usage.totalTokens ?? (
        agent.usage.inputTokens !== undefined && agent.usage.outputTokens !== undefined
          ? agent.usage.inputTokens + agent.usage.outputTokens
          : undefined
      );
      return value === undefined ? [] : [value];
    });
    const costValues = agents.flatMap((agent) => agent.usage.costUsd === undefined ? [] : [agent.usage.costUsd]);
    const active = agents.filter((agent) => !terminalStates.has(agent.state)).length;
    return {
      agents,
      active,
      totals: {
        agents: agents.length,
        running: agents.filter((agent) => runningStates.has(agent.state)).length,
        waitingApproval: agents.filter((agent) => agent.state === 'waiting_approval').length,
        stalled: agents.filter((agent) => agent.liveness?.state === 'stalled').length,
        ...(tokenValues.length > 0 ? { knownTokens: tokenValues.reduce((sum, value) => sum + value, 0) } : {}),
        tokenCoverage: tokenValues.length,
        ...(costValues.length > 0 ? { knownCostUsd: costValues.reduce((sum, value) => sum + value, 0) } : {}),
        costCoverage: costValues.length,
      },
    };
  }

  reset(): void {
    this.byId.clear();
    this.seen.clear();
    this.pendingApprovals.clear();
  }
}
