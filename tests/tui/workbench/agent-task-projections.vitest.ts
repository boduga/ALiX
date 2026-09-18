import { describe, expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/events/types.js';
import { AgentRosterProjection } from '../../../src/tui/workbench/projections/agent-roster-projection.js';
import { TaskProjection } from '../../../src/tui/workbench/projections/task-projection.js';

function event(seq: number, type: string, payload: Record<string, unknown>): AlixEvent {
  return {
    id: `e${seq}`, seq, version: 1, sessionId: 'session', timestamp: new Date(seq * 1000).toISOString(),
    actor: 'system', type, payload,
  };
}

describe('Workbench agent and task projections', () => {
  it('preserves a partial terminal state carried by agent.completed', () => {
    const agents = new AgentRosterProjection();
    const tasks = new TaskProjection();
    const events = [
      event(1, 'agent.spawned', { agentId: 'agent-1', taskId: 'task-1', state: 'starting' }),
      event(2, 'agent.task_assigned', { agentId: 'agent-1', taskId: 'task-1', title: 'Work' }),
      event(3, 'agent.completed', { agentId: 'agent-1', taskId: 'task-1', state: 'partial', status: 'partial' }),
    ];
    agents.update(events);
    tasks.update(events);

    expect(agents.snapshot().agents[0]?.state).toBe('partial');
    expect(tasks.snapshot().tasks[0]?.state).toBe('partial');
  });

  it('projects legacy subagent lifecycle without conflating task and agent records', () => {
    const agents = new AgentRosterProjection();
    const tasks = new TaskProjection();
    const events = [
      event(1, 'subagent.started', { taskId: 'task-1', role: 'reviewer', prompt: 'Review the TUI', ownedPaths: ['src/tui'] }),
      event(2, 'subagent.result', { taskId: 'task-1', role: 'reviewer', status: 'partial' }),
    ];
    agents.update(events);
    tasks.update(events);

    expect(agents.snapshot()).toMatchObject({
      active: 0,
      agents: [{ agentId: 'task-1', role: 'reviewer', state: 'partial', currentTaskId: 'task-1' }],
    });
    expect(tasks.snapshot()).toMatchObject({
      queued: 0, running: 0,
      tasks: [{ taskId: 'task-1', agentId: 'task-1', title: 'Review the TUI', state: 'partial' }],
    });
  });

  it('accepts expanded lifecycle, ownership, progress, and usage events idempotently', () => {
    const agents = new AgentRosterProjection();
    const tasks = new TaskProjection();
    const events = [
      event(1, 'agent.spawned', { agentId: 'agent-1', parentAgentId: 'root', taskId: 'task-1', role: 'worker', model: 'qwen', operation: 'Inspect' }),
      event(2, 'agent.task_assigned', { agentId: 'agent-1', taskId: 'task-1', title: 'Finish Workbench' }),
      event(3, 'agent.ownership_changed', { agentId: 'agent-1', taskId: 'task-1', ownedPaths: ['src/tui/app.ts'] }),
      event(4, 'agent.state_changed', { agentId: 'agent-1', taskId: 'task-1', state: 'tool_running', operation: 'Run tests' }),
      event(5, 'agent.usage', { agentId: 'agent-1', taskId: 'task-1', inputTokens: 10, outputTokens: 20, costUsd: 0.01 }),
      event(6, 'agent.completed', { agentId: 'agent-1', taskId: 'task-1' }),
    ];
    agents.update(events);
    agents.update(events);
    tasks.update(events.slice(0, 5));

    expect(agents.snapshot()).toMatchObject({
      active: 0,
      agents: [{
        agentId: 'agent-1', parentAgentId: 'root', state: 'completed',
        ownedPaths: ['src/tui/app.ts'], currentOperation: 'Run tests',
        usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
      }],
    });
    expect(tasks.snapshot()).toMatchObject({
      running: 1,
      tasks: [{ taskId: 'task-1', agentId: 'agent-1', state: 'running' }],
    });
  });

  it('deduplicates replayed events by stable event identity rather than sequence', () => {
    const agents = new AgentRosterProjection();
    const tasks = new TaskProjection();
    const spawned = event(1, 'agent.spawned', { agentId: 'agent-1', taskId: 'task-1', state: 'starting' });
    const assigned = event(2, 'agent.task_assigned', { agentId: 'agent-1', taskId: 'task-1', title: 'Work' });

    agents.update([spawned, { ...spawned, seq: 99 }]);
    tasks.update([assigned, { ...assigned, seq: 100 }]);

    expect(agents.snapshot().agents).toHaveLength(1);
    expect(tasks.snapshot().tasks).toHaveLength(1);
  });

  it('projects an authoritative approval wait as non-terminal and restores the prior state', () => {
    const agents = new AgentRosterProjection();
    agents.update([
      event(1, 'agent.spawned', { agentId: 'agent-1', taskId: 'task-1', state: 'starting' }),
      event(2, 'agent.state_changed', { agentId: 'agent-1', taskId: 'task-1', state: 'tool_running' }),
      event(3, 'approval.created', { approvalId: 'approval-1', agentId: 'agent-1', taskId: 'task-1' }),
      event(4, 'approval.created', { approvalId: 'approval-1', agentId: 'agent-1', taskId: 'task-1' }),
    ]);

    expect(agents.snapshot()).toMatchObject({
      active: 1,
      agents: [{ agentId: 'agent-1', state: 'waiting_approval' }],
    });

    agents.update([
      event(5, 'approval.resolved', { approvalId: 'approval-1', decision: 'approved' }),
    ]);

    expect(agents.snapshot()).toMatchObject({
      active: 1,
      agents: [{ agentId: 'agent-1', state: 'tool_running' }],
    });
  });
});
