import type { AlixEvent } from '../../../events/types.js';
import type { ProjectionBuilder } from '../../runtime/projection-builder.js';
import type { AgentRosterSnapshot, AgentSummary, WorkbenchAgentState } from '../model/agent-roster.js';

const terminalStates = new Set<WorkbenchAgentState>(['completed', 'partial', 'failed', 'cancelled']);

function payload(event: AlixEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
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
    'queued', 'starting', 'thinking', 'tool_running', 'waiting', 'waiting_approval', 'verifying',
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
          usage: previous?.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        });
        continue;
      }
      if (!previous) continue;
      let state = previous.state;
      if (event.type === 'approval.requested' && approvalId) {
        this.pendingApprovals.set(approvalId, { agentId: id, previousState: previous.state });
        state = 'waiting_approval';
      } else if (event.type === 'approval.resolved' && pending) {
        state = pending.previousState;
        this.pendingApprovals.delete(approvalId!);
      } else if (event.type === 'subagent.result') state = stateOf(p.status, 'failed');
      else if (event.type === 'agent.completed' || event.type === 'subagent.completed') state = stateOf(p.state ?? p.status, 'completed');
      else if (event.type === 'agent.failed' || event.type === 'subagent.failed') state = 'failed';
      else if (event.type === 'agent.cancelled') state = 'cancelled';
      else if (event.type === 'agent.state_changed') state = stateOf(p.state, previous.state);
      const ownedPaths = event.type === 'agent.ownership_changed' && Array.isArray(p.ownedPaths)
        ? p.ownedPaths.filter((v): v is string => typeof v === 'string')
        : previous.ownedPaths;
      const usage = event.type === 'agent.usage'
        ? {
            inputTokens: typeof p.inputTokens === 'number' ? p.inputTokens : previous.usage.inputTokens,
            outputTokens: typeof p.outputTokens === 'number' ? p.outputTokens : previous.usage.outputTokens,
            costUsd: typeof p.costUsd === 'number' ? p.costUsd : previous.usage.costUsd,
          }
        : previous.usage;
      this.byId.set(id, {
        ...previous,
        state,
        ownedPaths,
        usage,
        lastProgressAt: at,
        ...(typeof p.operation === 'string' ? { currentOperation: p.operation } : {}),
      });
    }
  }

  snapshot(): AgentRosterSnapshot {
    const agents = [...this.byId.values()].sort((a, b) => a.startedAt - b.startedAt || a.agentId.localeCompare(b.agentId));
    return { agents, active: agents.filter((agent) => !terminalStates.has(agent.state)).length };
  }

  reset(): void {
    this.byId.clear();
    this.seen.clear();
    this.pendingApprovals.clear();
  }
}
