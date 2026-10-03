import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/events/types.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { AgentRosterSnapshot, AgentSummary, WorkbenchAgentState } from '../../../src/tui/workbench/model/agent-roster.js';
import type { TaskSummary } from '../../../src/tui/workbench/model/task-roster.js';
import { getWorkbenchPreviewTheme } from '../../../src/tui/workbench/model/preview-theme.js';
import { AgentRosterProjection } from '../../../src/tui/workbench/projections/agent-roster-projection.js';
import { TaskProjection } from '../../../src/tui/workbench/projections/task-projection.js';
import { paintRosterDrawer } from '../../../src/tui/workbench/views/roster-drawer.js';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8')) as {
  events: AlixEvent[]; now: string; selectedAgentId: string;
};
const agent = (agentId: string, overrides: Partial<AgentSummary> = {}): AgentSummary => ({
  agentId, role: agentId, state: 'thinking', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {}, ...overrides,
});
const task = (taskId: string, overrides: Partial<TaskSummary> = {}): TaskSummary => ({
  taskId, title: taskId, state: 'running', ownedPaths: [], createdAt: 1, updatedAt: 1, ...overrides,
});
function roster(agents: readonly AgentSummary[]): AgentRosterSnapshot {
  return { agents, active: agents.length, totals: { agents: agents.length, running: 0, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 } };
}
function render(overrides: Partial<Parameters<typeof paintRosterDrawer>[0]> = {}) {
  const canvas = overrides.canvas ?? new TerminalCanvas(200, 44);
  paintRosterDrawer({ canvas, terminalColumns: 200, left: 0, top: 3, bottom: 38,
    layout: { breakpoint: 'ultrawide', contentColumns: 118, drawer: 'agents', drawerMode: 'side', drawerWidth: 40 },
    agents: roster([]), tasks: null, ...overrides });
  const raw = canvas.renderFrame();
  const rows = raw.replace(/\x1b\[[0-9;]*m/gu, '').split('\n');
  return { raw, rows, text: rows.join('\n') };
}

describe('preview agents/tasks roster', () => {
  it('renders every canonical identity, assignment and coordination entry inside the cyan outline', () => {
    const agents = new AgentRosterProjection(); const tasks = new TaskProjection();
    agents.update(fixture.events); tasks.update(fixture.events);
    const frame = render({ agents: agents.snapshot(Date.parse(fixture.now)), tasks: tasks.snapshot(), selectedAgentId: fixture.selectedAgentId });
    for (const text of ['AGENTS & TASKS', 'All agents', '5 agents • 3 running', 'Orchestrator RUNNING',
      'backend-agent RUNNING', 'frontend-agent RUNNING', 'test-agent WAITING', 'review-agent COMPLETED',
      'Coordinating execution', 'Build API endpoints', 'Implement responsive sidebar', 'Depends on frontend-agent',
      'Review changes and summarize', 'Coordination Run', 'Run setup (read-only)']) expect(frame.text).toContain(text);
    expect(frame.raw).toContain('\x1b[38;2;6;201;239m');
    expect(frame.raw).toContain('\x1b[48;2;6;49;61m');
    expect(frame.raw).toContain('\x1b[38;2;177;105;238m');
    expect(frame.rows.slice(3, 39).every(row => row.slice(40).trim() === '')).toBe(true);
    const selected = frame.rows.findIndex(row => row.includes('frontend-agent RUNNING'));
    expect(frame.rows[selected - 1]?.startsWith('╭')).toBe(true);
    expect(frame.rows[selected + 2]?.startsWith('╰')).toBe(true);
    const shortcutRows = frame.rows.filter(row => /[1-5] │\s*$/u.test(row));
    expect(shortcutRows).toHaveLength(5);
    const reviewer = frame.rows.findIndex(row => row.includes('review-agent COMPLETED'));
    expect(frame.rows[reviewer - 1]).toContain('──');
  });

  it.each([
    ['queued', 'QUEUED'], ['starting', 'STARTING'], ['thinking', 'RUNNING'], ['tool_running', 'RUNNING'],
    ['waiting', 'WAITING'], ['waiting_approval', 'APPROVAL'], ['waiting_dependency', 'WAITING'],
    ['verifying', 'VERIFYING'], ['completed', 'COMPLETED'], ['partial', 'PARTIAL'], ['failed', 'FAILED'],
    ['cancelling', 'CANCELLING'], ['cancelled', 'CANCELLED'],
  ] as const)('preserves readable %s lifecycle labels without color', (state: WorkbenchAgentState, label) => {
    const frame = render({ agents: roster([agent('worker', { state })]), theme: getWorkbenchPreviewTheme('monochrome', 'ascii') });
    expect(frame.text).toContain(`worker ${label}`);
    expect(frame.text).not.toMatch(/[●○╭╰│─↑↓…›]/u);
  });

  it('joins duplicate roles by identity and keeps scoped totals independent of session totals', () => {
    const agents = [agent('a1', { role: 'worker', coordinationRunId: 'run-1', currentTaskId: 'shared' }),
      agent('a2', { role: 'worker', coordinationRunId: 'run-2', currentTaskId: 'shared' })];
    const frame = render({ agents: roster(agents), selectedRunId: 'run-2', selectedAgentId: 'a2', tasks: {
      running: 2, queued: 0, blocked: 0, tasks: [task('shared', { agentId: 'a1', coordinationRunId: 'run-1', title: 'Wrong task' }),
        task('shared', { agentId: 'a2', coordinationRunId: 'run-2', title: 'Correct task' })],
    } });
    expect(frame.text).toContain('Correct task');
    expect(frame.text).not.toContain('Wrong task');
    expect(frame.text).toContain('1 agents • 1 running');
    expect(frame.text).toContain('RUN run-2');
  });

  it('does not guess assignment or dependency from duplicate roles and prose', () => {
    const frame = render({ agents: roster([agent('a1', { role: 'worker' }), agent('a2', { role: 'worker' })]), tasks: {
      running: 2, queued: 0, blocked: 0, tasks: [task('t1', { agentId: 'a1', title: 'ambiguous-one' }), task('t2', { agentId: 'a1', title: 'ambiguous-two' })],
    } });
    expect(frame.text).toContain('Task unavailable');
    expect(frame.text).not.toContain('ambiguous-one');
    expect(frame.text).not.toContain('ambiguous-two');
    expect(frame.text).not.toContain('Depends on');
  });

  it('rejects a same-task-id join belonging to another worker or run', () => {
    const frame = render({ agents: roster([agent('a1', { coordinationRunId: 'r1', currentTaskId: 'same' })]), tasks: {
      running: 2, queued: 0, blocked: 0, tasks: [task('same', { agentId: 'a2', coordinationRunId: 'r1', title: 'Other worker' }),
        task('same', { agentId: 'a1', coordinationRunId: 'r2', title: 'Other run' })],
    } });
    expect(frame.text).toContain('Task unavailable');
    expect(frame.text).not.toContain('Other worker');
    expect(frame.text).not.toContain('Other run');
  });

  it('renders unresolved dependency IDs honestly', () => {
    const frame = render({ agents: roster([agent('test-agent', { state: 'waiting_dependency', currentTaskId: 'test' })]), tasks: {
      running: 0, queued: 0, blocked: 0, waiting: 1, tasks: [task('test', { agentId: 'test-agent', state: 'waiting_dependency', dependencyIds: ['missing-task'] })],
    } });
    expect(frame.text).toContain('Depends on missing-task');
  });

  it('retains selected diagnostics with known zero usage and never fabricates context utilization', () => {
    const frame = render({ selectedAgentId: 'a1', agents: roster([agent('a1', { model: 'actual-model',
      currentOperation: 'Editing', ownedPaths: ['src/tui'], usage: { totalTokens: 0, contextWindowTokens: 1000, costUsd: 0 },
      activeTool: { toolCallId: 'call', toolName: 'patch.apply', startedAt: 1, lastProgressAt: 1, elapsedMs: 1800 } })]) });
    for (const value of ['model actual-model', 'Editing', 'owns src/tui', 'tokens 0', 'cost $0.0000', 'tool patch.apply · 1.8s']) expect(frame.text).toContain(value);
    expect(frame.text).not.toContain('%');
  });

  it('shows stall and progress separately from lifecycle', () => {
    const frame = render({ agents: roster([agent('a1', { liveness: { state: 'stalled', idleMs: 500000 } }),
      agent('a2', { liveness: { state: 'warning', idleMs: 100000 } })]) });
    expect(frame.text).toContain('a1 RUNNING'); expect(frame.text).toContain('STALLED');
    expect(frame.text).toContain('a2 RUNNING'); expect(frame.text).toContain('SLOW PROGRESS');
  });

  it('numbers identities relative to run scope while honoring agent-index scroll offsets', () => {
    const agents = Array.from({ length: 12 }, (_, index) => agent(`worker-${index + 1}`, { taskLabel: `Task ${index + 1}` }));
    const frame = render({ agents: roster(agents), selectedAgentId: 'worker-9', agentScrollOffset: 8 });
    expect(frame.text).not.toContain('worker-1 RUNNING');
    expect(frame.text).toContain('worker-9 RUNNING'); expect(frame.text).toContain('worker-12 RUNNING');
    const shortcutRows = frame.rows.filter(row => /[0-9] │\s*$/u.test(row));
    expect(shortcutRows).toHaveLength(1); expect(shortcutRows[0]).toMatch(/9 │\s*$/u);
  });

  it.each([[20, 12, 3, 10], [4, 5, 1, 3], [1, 1, 0, 0], [52, 10, 2, 4]] as const)('clips narrow or short %i-column overlays without touching neighboring rows', (columns, rows, top, bottom) => {
    const canvas = new TerminalCanvas(columns, rows);
    for (let y = 0; y < rows; y++) canvas.write(0, y, '.'.repeat(columns));
    const frame = render({ canvas, terminalColumns: columns, top, bottom, left: 0,
      layout: { breakpoint: 'narrow', contentColumns: columns, drawer: 'agents', drawerMode: 'overlay', drawerWidth: columns },
      agents: roster([agent('long-agent-identity', { taskLabel: '調査調査調査調査' })]), selectedAgentId: 'long-agent-identity' });
    frame.rows.slice(0, rows).forEach((row, y) => { if (y < top || y > bottom) expect(row).toBe('.'.repeat(columns)); });
  });

  it('shows unavailable roster separately from an authoritative empty roster and collapsed rows', () => {
    expect(render({ agents: null }).text).toContain('Roster unavailable');
    expect(render({ agents: roster([]) }).text).toContain('0 agents • 0 running');
    expect(render({ agents: roster([]) }).text).toContain('No subagents');
    const frame = render({ agents: roster([agent('a1')]), agentRosterExpanded: false });
    expect(frame.text).toContain('Enter to expand roster'); expect(frame.text).not.toContain('a1 RUNNING');
    expect(frame.text).toContain('Coordination Run');
  });

  it('renders task titles and lifecycle/ownership second rows even without task selection', () => {
    const frame = render({ layout: { breakpoint: 'ultrawide', contentColumns: 118, drawer: 'tasks', drawerMode: 'side', drawerWidth: 40 },
      tasks: { queued: 1, running: 1, blocked: 0, tasks: [task('t1', { title: 'Build API', agentId: 'a1' }),
        task('t2', { title: 'Test API', state: 'waiting_dependency', agentId: 'a2', dependencyIds: ['t1'] })] } });
    expect(frame.text).toContain('Build API'); expect(frame.text).toContain('RUNNING • agent a1');
    expect(frame.text).toContain('Test API'); expect(frame.text).toContain('WAITING DEPENDENCY • agent a2');
  });
  it.each([5, 8, 12, 16])('keeps a selected worker visible in a %i-row body', height => {
    const agents = Array.from({ length: 12 }, (_, index) => agent(`worker-${index + 1}`));
    const frame = render({ top: 3, bottom: 3 + height - 1, agents: roster(agents), selectedAgentId: 'worker-9', agentScrollOffset: 0 });
    expect(frame.text).toContain('worker-9 RUNNING');
    expect(frame.text).toContain('›');
  });

  it('scrolls the task viewport to the selected execution task', () => {
    const tasks = Array.from({ length: 20 }, (_, index) => task(`t${index + 1}`, { title: `Task ${index + 1}` }));
    const frame = render({ top: 3, bottom: 18, selectedTaskId: 't19', agentScrollOffset: 0,
      layout: { breakpoint: 'ultrawide', contentColumns: 118, drawer: 'tasks', drawerMode: 'side', drawerWidth: 40 },
      tasks: { tasks, queued: 0, blocked: 0, running: 20 } });
    expect(frame.text).toContain('›● Task 19');
    expect(frame.text).not.toContain('● Task 1 ');
  });

});
