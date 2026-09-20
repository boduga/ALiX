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
      queued: 0, running: 0, blocked: 0,
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
      tasks: [{ taskId: 'task-1', agentId: 'agent-1', state: 'running', currentOperation: 'Run tests', ownedPaths: ['src/tui/app.ts'] }],
    });
    expect(agents.snapshot().totals).toEqual({
      agents: 1, running: 0, waitingApproval: 0, stalled: 0,
      knownTokens: 30, tokenCoverage: 1, knownCostUsd: 0.01, costCoverage: 1,
    });
  });

  it('projects task progress and ownership updates from structured events', () => {
    const tasks = new TaskProjection();
    tasks.update([
      event(1, 'agent.task_assigned', { agentId: 'agent-1', taskId: 'task-1', title: 'Build drawer' }),
      event(2, 'agent.progress', { agentId: 'agent-1', taskId: 'task-1', operation: 'Rendering task cards' }),
      event(3, 'agent.ownership_changed', { agentId: 'agent-1', taskId: 'task-1', ownedPaths: ['src/tui', 'tests/tui'] }),
    ]);

    expect(tasks.snapshot()).toMatchObject({
      queued: 0,
      running: 1,
      tasks: [{
        taskId: 'task-1', state: 'running', currentOperation: 'Rendering task cards',
        ownedPaths: ['src/tui', 'tests/tui'],
      }],
    });
  });

  it('preserves authoritative dependency and ownership block reasons', () => {
    const tasks = new TaskProjection();
    tasks.update([
      event(1, 'agent.task_assigned', { agentId: 'agent-1', taskId: 'task-1', title: 'Write files' }),
      event(2, 'agent.state_changed', { agentId: 'agent-1', taskId: 'task-1', state: 'blocked', blockReason: 'ownership_conflict' }),
    ]);
    expect(tasks.snapshot()).toMatchObject({ blocked: 1, tasks: [{ state: 'blocked', blockReason: 'ownership_conflict' }] });

    tasks.update([
      event(3, 'agent.state_changed', { agentId: 'agent-1', taskId: 'task-1', state: 'running', blockReason: 'ownership_conflict' }),
    ]);
    expect(tasks.snapshot()).toMatchObject({ blocked: 0, running: 1, tasks: [{ state: 'running' }] });
    expect(tasks.snapshot().tasks[0]?.blockReason).toBeUndefined();
  });

  it('preserves coordination metadata without conflating agent and worker identity', () => {
    const agents = new AgentRosterProjection();
    const tasks = new TaskProjection();
    const events = [
      event(1, 'agent.spawned', {
        agentId: 'worker-1', taskId: 'worker-1', role: 'worker', state: 'starting',
        coordinationRunId: 'coord-1', assignedAgentId: 'alix#2', taskLabel: 'Repair planner',
      }),
      event(2, 'agent.task_assigned', {
        agentId: 'worker-1', taskId: 'worker-1', title: 'Repair planner',
        coordinationRunId: 'coord-1', assignedAgentId: 'alix#2', taskLabel: 'Repair planner',
      }),
    ];
    agents.update(events);
    tasks.update(events);
    expect(agents.snapshot().agents[0]).toMatchObject({
      agentId: 'worker-1', coordinationRunId: 'coord-1', assignedAgentId: 'alix#2', taskLabel: 'Repair planner',
    });
    expect(tasks.snapshot().tasks[0]).toMatchObject({
      taskId: 'worker-1', agentId: 'worker-1', coordinationRunId: 'coord-1', assignedAgentId: 'alix#2', title: 'Repair planner',
    });
  });

  it('keeps unknown usage unavailable and preserves explicit zero values', () => {
    const agents = new AgentRosterProjection();
    agents.update([event(1, 'agent.spawned', { agentId: 'agent-1', state: 'thinking' })]);
    expect(agents.snapshot().agents[0]?.usage).toEqual({});
    expect(agents.snapshot().totals).toMatchObject({ tokenCoverage: 0, costCoverage: 0 });
    expect(agents.snapshot().totals.knownTokens).toBeUndefined();
    expect(agents.snapshot().totals.knownCostUsd).toBeUndefined();

    agents.update([event(2, 'agent.usage', {
      agentId: 'agent-1', provider: 'openai', resolvedModel: 'gpt-test',
      inputTokens: 0, outputTokens: 5, totalTokens: 5, contextWindowTokens: 100, costUsd: 0,
    })]);
    expect(agents.snapshot().agents[0]).toMatchObject({
      model: 'gpt-test',
      usage: { provider: 'openai', inputTokens: 0, outputTokens: 5, totalTokens: 5, contextWindowTokens: 100, costUsd: 0 },
    });
    expect(agents.snapshot().totals).toMatchObject({ knownTokens: 5, tokenCoverage: 1, knownCostUsd: 0, costCoverage: 1 });
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

  it('correlates live tool activity by agent and tool call identity', () => {
    const agents = new AgentRosterProjection();
    agents.update([
      event(1, 'agent.spawned', { agentId: 'agent-1', taskId: 'task-1', state: 'thinking' }),
      event(2, 'tool.started', { agentId: 'agent-1', toolCallId: 'tool-1', toolName: 'grep.search' }),
      event(4, 'tool.output', { agentId: 'agent-1', toolCallId: 'tool-1', outputPreview: 'match' }),
      event(5, 'tool.completed', { agentId: 'agent-1', toolCallId: 'other-tool', toolName: 'file.read', durationMs: 1 }),
    ]);

    expect(agents.snapshot().agents[0]).toMatchObject({
      state: 'tool_running',
      activeTool: { toolCallId: 'tool-1', toolName: 'grep.search', elapsedMs: 2000 },
    });

    agents.update([event(6, 'tool.completed', { agentId: 'agent-1', toolCallId: 'tool-1', toolName: 'grep.search', durationMs: 4000 })]);
    expect(agents.snapshot().agents[0]).toMatchObject({ state: 'thinking' });
    expect(agents.snapshot().agents[0]?.activeTool).toBeUndefined();
  });

  it('derives liveness without mutating lifecycle or flagging blocked and terminal agents', () => {
    const agents = new AgentRosterProjection();
    agents.update([
      event(1, 'agent.spawned', { agentId: 'thinking', state: 'thinking' }),
      event(2, 'agent.spawned', { agentId: 'approval', state: 'thinking' }),
      event(3, 'approval.created', { approvalId: 'approval-1', agentId: 'approval' }),
      event(4, 'agent.spawned', { agentId: 'dependency', state: 'waiting_dependency' }),
      event(5, 'agent.spawned', { agentId: 'done', state: 'thinking' }),
      event(6, 'agent.completed', { agentId: 'done' }),
      event(7, 'agent.spawned', { agentId: 'tool-agent', state: 'thinking' }),
      event(8, 'tool.started', { agentId: 'tool-agent', toolCallId: 'tool-1', toolName: 'shell.run' }),
    ]);

    const snapshot = agents.snapshot(700_000, { warningAfterMs: 100_000, stalledAfterMs: 200_000 });
    expect(snapshot.agents.find((agent) => agent.agentId === 'thinking')).toMatchObject({
      state: 'thinking', liveness: { state: 'stalled', idleMs: 699_000 },
    });
    expect(snapshot.agents.find((agent) => agent.agentId === 'approval')?.liveness).toBeUndefined();
    expect(snapshot.agents.find((agent) => agent.agentId === 'dependency')?.liveness).toBeUndefined();
    expect(snapshot.agents.find((agent) => agent.agentId === 'done')?.liveness).toBeUndefined();
    expect(snapshot.agents.find((agent) => agent.agentId === 'tool-agent')?.liveness).toBeUndefined();
  });

  it('clears a derived stall when authoritative progress arrives', () => {
    const agents = new AgentRosterProjection();
    agents.update([event(1, 'agent.spawned', { agentId: 'agent-1', state: 'thinking' })]);
    expect(agents.snapshot(250_000, { warningAfterMs: 100_000, stalledAfterMs: 200_000 }).agents[0]?.liveness?.state).toBe('stalled');

    agents.update([event(240, 'agent.state_changed', { agentId: 'agent-1', state: 'thinking', operation: 'Still working' })]);
    expect(agents.snapshot(250_000, { warningAfterMs: 100_000, stalledAfterMs: 200_000 }).agents[0]?.liveness?.state).toBe('healthy');
  });
});
