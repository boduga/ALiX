import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';
import { AgentRosterProjection } from '../../../src/interfaces/tui/workbench/projections/agent-roster-projection.js';
import { TaskProjection } from '../../../src/interfaces/tui/workbench/projections/task-projection.js';
import { ArtifactProjection } from '../../../src/interfaces/tui/workbench/projections/artifact-projection.js';

type PreviewGroup = {
  id: string; eventIds: string[]; category: string; agentId: string;
  text?: string; toolCallId?: string; requestedRange?: number[]; observedLineCount?: number;
};
type PreviewFixture = {
  schemaVersion: number; now: string; timeZone: string; workspace: string;
  sessionId: string; coordinationRunId: string; selectedAgentId: string;
  events: AlixEvent<string, Record<string, unknown>>[]; transcriptGroups: PreviewGroup[];
  expected: { agents: number; running: number; active: number; artifacts: number; knownTokens: number;
    tokenCoverage: number; events: number; activeToolCallId: string; activeElapsedMs: number };
};
const fixture = JSON.parse(readFileSync(new URL('../../fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8')) as PreviewFixture;

function project(chunks: readonly (readonly AlixEvent[])[]) {
  const agents = new AgentRosterProjection();
  const tasks = new TaskProjection();
  const artifacts = new ArtifactProjection();
  for (const chunk of chunks) {
    agents.update(chunk); tasks.update(chunk); artifacts.update(chunk);
  }
  return { agents: agents.snapshot(Date.parse(fixture.now)), tasks: tasks.snapshot(), artifacts: artifacts.snapshot() };
}

describe('event-backed Workbench preview reference', () => {
  it('provides ordered, uniquely identified session facts and a fixed UTC clock', () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.timeZone).toBe('UTC');
    expect(fixture.workspace).toBe('/home/babasola/Projects/ALiX');
    expect(fixture.events).toHaveLength(fixture.expected.events);
    expect(new Set(fixture.events.map(event => event.id)).size).toBe(fixture.events.length);
    fixture.events.forEach((event, index) => {
      expect(event.seq).toBe(index + 1);
      expect(event.version).toBe(1);
      expect(event.sessionId).toBe(fixture.sessionId);
      expect(event.payload.coordinationRunId).toBe(fixture.coordinationRunId);
      expect(Date.parse(event.timestamp)).toBeLessThanOrEqual(Date.parse(fixture.now));
      if (index > 0) expect(Date.parse(event.timestamp)).toBeGreaterThanOrEqual(Date.parse(fixture.events[index - 1]!.timestamp));
    });
  });

  it('replays identically through chunking, repeated deliveries and stable-ID resequencing', () => {
    const baseline = project([fixture.events]);
    const chunks = [fixture.events.slice(0, 9), fixture.events.slice(9, 23), fixture.events.slice(23)];
    expect(project(chunks)).toEqual(baseline);
    expect(project([...chunks, fixture.events])).toEqual(baseline);
    expect(project([fixture.events, fixture.events.map(event => ({ ...event, seq: event.seq + 1000 }))])).toEqual(baseline);
  });

  it('counts executable agents honestly and retains separate assigned tasks', () => {
    const snapshot = project([fixture.events]);
    expect(snapshot.agents).toMatchObject({ active: fixture.expected.active, totals: {
      agents: fixture.expected.agents, running: fixture.expected.running, knownTokens: fixture.expected.knownTokens,
      tokenCoverage: fixture.expected.tokenCoverage, costCoverage: 0,
    } });
    expect(snapshot.agents.agents.map(agent => [agent.agentId, agent.state])).toEqual([
      ['orchestrator', 'thinking'], ['backend-agent', 'thinking'], ['frontend-agent', 'tool_running'],
      ['test-agent', 'waiting_dependency'], ['review-agent', 'completed'],
    ]);
    expect(snapshot.tasks.tasks).toHaveLength(5);
    expect(snapshot.tasks.tasks.find(task => task.agentId === fixture.selectedAgentId)).toMatchObject({
      title: 'Implement responsive sidebar', coordinationRunId: fixture.coordinationRunId,
    });
    const dependency = fixture.events.find(event => event.type === 'agent.task_assigned' && event.payload.agentId === 'test-agent');
    expect(dependency?.payload.dependencyIds).toEqual(['task-frontend-agent']);
    expect(snapshot.tasks).toMatchObject({ waiting: 1, running: 3 });
    expect(snapshot.tasks.tasks.find(task => task.agentId === 'test-agent')).toMatchObject({
      state: 'waiting_dependency', dependencyIds: ['task-frontend-agent'],
    });
  });

  it('substantiates initialization prose before the reviewer completes', () => {
    const initialized = fixture.events.find(event => event.payload.message === '✓ 4 agents initialized (3 running, 1 waiting)')!;
    const prefix = fixture.events.filter(event => event.seq <= initialized.seq);
    const workers = project([prefix]).agents.agents.filter(agent => agent.agentId !== 'orchestrator');
    expect(workers).toHaveLength(4);
    expect(workers.filter(agent => agent.state === 'thinking')).toHaveLength(3);
    expect(workers.filter(agent => agent.state === 'waiting_dependency')).toHaveLength(1);
    const completed = fixture.events.find(event => event.type === 'agent.completed' && event.payload.agentId === 'review-agent')!;
    expect(completed.seq).toBeGreaterThan(initialized.seq);
    expect(project([fixture.events]).agents.agents.find(agent => agent.agentId === 'review-agent')?.state).toBe('completed');
  });

  it('keeps completed cards separate from the active write and unknown usage absent', () => {
    const frontend = project([fixture.events]).agents.agents.find(agent => agent.agentId === fixture.selectedAgentId)!;
    expect(frontend.activeTool).toMatchObject({ toolCallId: fixture.expected.activeToolCallId, toolName: 'patch.apply', elapsedMs: fixture.expected.activeElapsedMs });
    expect(Date.parse(fixture.now) - frontend.activeTool!.startedAt).toBe(fixture.expected.activeElapsedMs);
    expect(frontend.usage).toEqual({ totalTokens: 7352 });
    expect(frontend.usage.contextWindowTokens).toBeUndefined();
    expect(frontend.usage.costUsd).toBeUndefined();
    const completed = fixture.events.filter(event => event.type === 'tool.completed');
    expect(completed.map(event => event.payload.toolCallId)).toEqual(['read-sidebar', 'write-sidebar-completed']);
    expect(completed.every(event => event.payload.toolCallId !== frontend.activeTool!.toolCallId)).toBe(true);
    const staleTerminal: AlixEvent = { ...completed[1]!, id: 'late-completed-card', seq: fixture.events.length + 1 };
    expect(project([fixture.events, [staleTerminal]]).agents.agents.find(agent => agent.agentId === fixture.selectedAgentId)?.activeTool?.toolCallId)
      .toBe(fixture.expected.activeToolCallId);
    expect(fixture.events.filter(event => event.type === 'tool.requested').map(event => event.payload.toolName))
      .toEqual(['alix_file_read', 'alix_patch_apply', 'alix_patch_apply']);
  });

  it('evidences both frontend artifacts with strict run, agent and task correlation', () => {
    const snapshot = project([fixture.events]);
    expect(snapshot.artifacts.artifacts).toBe(fixture.expected.artifacts);
    expect(snapshot.artifacts.items.map(item => item.title)).toEqual(['sidebar-layout.test.ts', 'right-sidebar.ts']);
    for (const item of snapshot.artifacts.items) {
      expect(item).toMatchObject({ kind: 'artifact', status: 'available', agentId: fixture.selectedAgentId,
        taskId: 'task-frontend-agent', coordinationRunId: fixture.coordinationRunId });
      expect(item.preview).toBeTruthy();
    }
    expect(fixture.events.find(event => event.type === 'artifact.created')!.seq)
      .toBeLessThan(fixture.events.find(event => event.type === 'tool.requested')!.seq);
  });

  it('retains all thirteen pictured prose/card groups and distinguishes requested from observed lines', () => {
    expect(fixture.transcriptGroups.map(group => group.category)).toEqual([
      'activity', 'activity', 'activity', 'activity', 'activity', 'activity', 'tool',
      'activity', 'activity', 'tool', 'activity', 'activity', 'activity',
    ]);
    expect(fixture.transcriptGroups.flatMap(group => group.text ? [group.text] : [])).toEqual([
      'Planning phase complete. Dispatching tasks to agents...',
      '✓ 4 agents initialized (3 running, 1 waiting)',
      'Building API endpoints for sidebar data...',
      'Starting implementation of responsive sidebar...',
      'Analyzing existing layout structure and components.',
      'Reading current sidebar component for context.',
      'Identified component structure. Implementing responsive variants for collapsed and expanded states.',
      'Writing updated sidebar component with responsive behavior...',
      'Waiting for frontend-agent to complete. Dependency: src/components/right-sidebar.ts',
      'Continuing with API implementation...', 'Rendering the selected agent details...',
    ]);
    const byId = new Map(fixture.events.map(event => [event.id, event]));
    let lastSequence = 0;
    for (const group of fixture.transcriptGroups) {
      expect(group.eventIds.length).toBeGreaterThan(0);
      for (const id of group.eventIds) {
        const event = byId.get(id)!;
        expect(event).toBeDefined();
        expect(event.payload.agentId).toBe(group.agentId);
        expect(event.seq).toBeGreaterThan(lastSequence);
        lastSequence = event.seq;
        if (group.text) expect(event.payload.message).toBe(group.text);
        if (group.toolCallId) expect(event.payload.toolCallId).toBe(group.toolCallId);
      }
    }
    expect(fixture.transcriptGroups[6]).toMatchObject({ requestedRange: [1, 200], observedLineCount: 142 });
    expect(fixture.transcriptGroups[9]).toMatchObject({ requestedRange: [1, 287], observedLineCount: 287 });
  });
});
