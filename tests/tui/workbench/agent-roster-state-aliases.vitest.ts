import { describe, expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';
import { AgentRosterProjection } from '../../../src/interfaces/tui/workbench/projections/agent-roster-projection.js';

function event(seq: number, type: string, payload: Record<string, unknown>): AlixEvent {
  return {
    id: `e-${seq}`,
    seq,
    sessionId: 's1',
    timestamp: new Date(1_000 + seq).toISOString(),
    actor: 'agent',
    type,
    payload,
  } as AlixEvent;
}

describe('AgentRosterProjection canonical lifecycle aliases', () => {
  const cases = [
    ['idle', 'queued'],
    ['planning', 'thinking'],
    ['executing', 'tool_running'],
    ['repairing', 'thinking'],
    ['summarizing', 'thinking'],
    ['blocked', 'waiting_dependency'],
    ['stopped', 'failed'],
  ] as const;

  for (const [source, expected] of cases) {
    it(`projects ${source} as ${expected}`, () => {
      const projection = new AgentRosterProjection();
      projection.update([
        event(1, 'agent.spawned', { agentId: 'a1', state: 'starting' }),
        event(2, 'agent.state_changed', { agentId: 'a1', state: source }),
      ]);
      expect(projection.snapshot(1_002).agents[0]?.state).toBe(expected);
    });
  }

  it('does not let a dependency block remain visually running', () => {
    const projection = new AgentRosterProjection();
    projection.update([
      event(1, 'agent.spawned', { agentId: 'a1', state: 'running' }),
      event(2, 'agent.state_changed', { agentId: 'a1', state: 'blocked', blockReason: 'dependency_failed' }),
    ]);
    const snapshot = projection.snapshot(1_002);
    expect(snapshot.agents[0]?.state).toBe('waiting_dependency');
    expect(snapshot.totals.running).toBe(0);
  });

  it('treats stopped as terminal rather than a stale active state', () => {
    const projection = new AgentRosterProjection();
    projection.update([
      event(1, 'agent.spawned', { agentId: 'a1', state: 'running' }),
      event(2, 'agent.state_changed', { agentId: 'a1', state: 'stopped' }),
    ]);
    const snapshot = projection.snapshot(99_999);
    expect(snapshot.agents[0]?.state).toBe('failed');
    expect(snapshot.active).toBe(0);
    expect(snapshot.agents[0]?.liveness).toBeUndefined();
  });
});
