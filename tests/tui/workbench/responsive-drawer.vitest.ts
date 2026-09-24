import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { resolveWorkbenchLayout, resolveWorkbenchSurfaceGeometry } from '../../../src/tui/workbench/layout/responsive-layout.js';
import { paintRosterDrawer } from '../../../src/tui/workbench/views/roster-drawer.js';
import { paintOperatorShell } from '../../../src/tui/workbench/views/operator-shell.js';

describe('Workbench responsive drawer', () => {
  it.each([
    [60, 'agents', 60],
    [80, 'tasks', 80],
    [120, 'agents', 83],
    [180, 'closed', 135],
  ] as const)('shares the expected content width at %i columns', (columns, drawer, contentColumns) => {
    expect(resolveWorkbenchSurfaceGeometry(columns, 24, drawer).dimensions.columns).toBe(contentColumns);
  });
  it('uses overlays below 120 columns and a side drawer above it', () => {
    expect(resolveWorkbenchLayout(79, 'agents')).toMatchObject({ breakpoint: 'narrow', drawerMode: 'overlay', drawerWidth: 79 });
    expect(resolveWorkbenchLayout(100, 'tasks')).toMatchObject({ breakpoint: 'medium', drawerMode: 'overlay', drawerWidth: 100 });
    expect(resolveWorkbenchLayout(140, 'agents')).toMatchObject({ breakpoint: 'wide', drawerMode: 'side', drawerWidth: 36, contentColumns: 103 });
  });

  it('keeps an agent drawer persistent on ultrawide terminals', () => {
    expect(resolveWorkbenchLayout(180, 'closed')).toMatchObject({ breakpoint: 'ultrawide', drawer: 'agents', drawerMode: 'side' });
  });

  it('renders agent state, operation, and ownership', () => {
    const canvas = new TerminalCanvas(140, 24);
    const layout = resolveWorkbenchLayout(140, 'agents');
    paintRosterDrawer({
      canvas, terminalColumns: 140, top: 3, bottom: 18, layout,
      agents: { active: 1, totals: { agents: 1, running: 1, waitingApproval: 0, stalled: 0, tokenCoverage: 1, costCoverage: 1 }, agents: [{
        agentId: 'a1', role: 'worker', state: 'tool_running', currentOperation: 'Editing composer',
        coordinationRunId: 'coord-1', assignedAgentId: 'alix#2', taskLabel: 'Finish Workbench',
        activeTool: { toolCallId: 'tc1', toolName: 'patch.apply', startedAt: 1, lastProgressAt: 2501, elapsedMs: 2500 },
        model: 'qwen-test',
        ownedPaths: ['src/tui'], startedAt: 1, lastProgressAt: 2,
        usage: { inputTokens: 400, outputTokens: 100, contextWindowTokens: 1000, costUsd: 0 },
      }] },
      tasks: null,
      selectedAgentId: 'a1',
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('AGENTS  1 active');
    expect(frame).toContain('worker · tool_running');
    expect(frame).toContain('run coord-1 · assigned alix#2');
    expect(frame).toContain('›● worker · tool_running');
    expect(frame).toContain('Editing composer');
    expect(frame).toContain('tool patch.apply · 2.5s');
    expect(frame).toContain('model qwen-test');
    expect(frame).toContain('tokens 500 / 1,000 (50%)');
    expect(frame).toContain('cost $0.0000');
    expect(frame).toContain('owns src/tui');
  });

  it('renders a non-terminal stall diagnostic separately from agent state', () => {
    const canvas = new TerminalCanvas(140, 24);
    const layout = resolveWorkbenchLayout(140, 'agents');
    paintRosterDrawer({
      canvas, terminalColumns: 140, top: 3, bottom: 18, layout,
      agents: { active: 1, totals: { agents: 1, running: 1, waitingApproval: 0, stalled: 1, tokenCoverage: 0, costCoverage: 0 }, agents: [{
        agentId: 'a1', role: 'researcher', state: 'thinking',
        liveness: { state: 'stalled', idleMs: 600_000 },
        ownedPaths: [], startedAt: 1, lastProgressAt: 2,
        usage: {},
      }] },
      tasks: null,
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('researcher · thinking');
    expect(frame).toContain('⚠ possibly stalled');
  });

  it('renders structured task ownership and progress', () => {
    const canvas = new TerminalCanvas(100, 24);
    paintRosterDrawer({
      canvas, terminalColumns: 100, top: 3, bottom: 18, layout: resolveWorkbenchLayout(100, 'tasks'),
      agents: null,
      tasks: {
        queued: 1, running: 1, blocked: 0,
        tasks: [{
          taskId: 'task-1', agentId: 'agent-1', title: 'Finish Workbench', state: 'running',
          coordinationRunId: 'coord-1', assignedAgentId: 'alix#2',
          currentOperation: 'Rendering task cards', ownedPaths: ['src/tui'], createdAt: 1, updatedAt: 2,
        }],
      },
      selectedTaskId: 'task-1',
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('TASKS  1 running · 1 queued · 0 blocked');
    expect(frame).toContain('● Finish Workbench');
    expect(frame).toContain('running · agent agent-1');
    expect(frame).toContain('run coord-1 · assigned alix#2');
    expect(frame).toContain('Rendering task cards');
    expect(frame).toContain('owns src/tui');
  });

  it('truncates Unicode roster content by terminal display width', () => {
    const canvas = new TerminalCanvas(20, 16);
    paintRosterDrawer({
      canvas, terminalColumns: 20, top: 3, bottom: 12, layout: resolveWorkbenchLayout(20, 'tasks'),
      agents: null,
      tasks: {
        queued: 0, running: 1, blocked: 0,
        tasks: [{
          taskId: 'task-1', title: '調査調査調査調査調査', state: 'running',
          ownedPaths: [], createdAt: 1, updatedAt: 2,
        }],
      },
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('● 調査調査調査…');
  });

  it('starts agent rendering at the presentation scroll offset', () => {
    const canvas = new TerminalCanvas(140, 24);
    const layout = resolveWorkbenchLayout(140, 'agents');
    const agent = (agentId: string, role: string) => ({
      agentId, role, state: 'thinking' as const, ownedPaths: [], startedAt: 1, lastProgressAt: 2,
      usage: {},
    });
    paintRosterDrawer({
      canvas, terminalColumns: 140, top: 3, bottom: 18, layout,
      agents: { active: 2, totals: { agents: 2, running: 2, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 }, agents: [agent('a1', 'first'), agent('a2', 'second')] },
      tasks: null, selectedAgentId: 'a2', agentScrollOffset: 1,
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).not.toContain('first · thinking');
    expect(frame).toContain('›● second · thinking');
  });

  it('keeps all four workers visible while expanding only the selected worker', () => {
    const canvas = new TerminalCanvas(72, 20);
    const agents = Array.from({ length: 4 }, (_, index) => ({
      agentId: `worker-${index + 1}`,
      role: `worker-${index + 1}`,
      state: 'thinking' as const,
      currentOperation: `operation-${index + 1}`,
      model: 'test-model',
      ownedPaths: [`tmp/worker-${index + 1}`],
      startedAt: 1,
      lastProgressAt: 2,
      usage: {},
    }));
    paintRosterDrawer({
      canvas,
      terminalColumns: 72,
      top: 3,
      bottom: 18,
      layout: resolveWorkbenchLayout(72, 'agents'),
      agents: { active: 4, totals: { agents: 4, running: 4, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 }, agents },
      tasks: null,
      selectedAgentId: 'worker-2',
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    for (let index = 1; index <= 4; index++) expect(frame).toContain(`worker-${index} · thinking`);
    expect(frame).toContain('operation-2');
    expect(frame).not.toContain('operation-1');
    expect(frame).toContain('↑↓ select · [ ] run · Esc close');
  });

  it('filters by run, exposes aggregate selection, and collapses the roster', () => {
    const agent = (agentId: string, coordinationRunId: string) => ({
      agentId, coordinationRunId, role: agentId, state: 'thinking' as const,
      ownedPaths: [], startedAt: 1, lastProgressAt: 2, usage: {},
    });
    const canvas = new TerminalCanvas(140, 24);
    paintRosterDrawer({
      canvas, terminalColumns: 140, top: 3, bottom: 18,
      layout: resolveWorkbenchLayout(140, 'agents'),
      agents: { active: 2, totals: { agents: 2, running: 2, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 }, agents: [agent('a1', 'r1'), agent('a2', 'r2')] },
      tasks: null, selectedRunId: 'r2', agentRosterExpanded: false,
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('RUN r2 · [ ] switch');
    expect(frame).toContain('›◉ All agents');
    expect(frame).toContain('Enter to expand roster');
    expect(frame).not.toContain('a1 · thinking');
  });

  it('marks the selected task and names ownership conflicts', () => {
    const canvas = new TerminalCanvas(100, 24);
    paintRosterDrawer({
      canvas, terminalColumns: 100, top: 3, bottom: 18,
      layout: resolveWorkbenchLayout(100, 'tasks'), agents: null,
      tasks: { queued: 0, running: 0, blocked: 1, tasks: [{
        taskId: 'task-1', title: 'Write shared files', state: 'blocked', blockReason: 'ownership_conflict',
        ownedPaths: ['src/tui'], createdAt: 1, updatedAt: 2,
      }] },
      selectedTaskId: 'task-1',
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('›! Write shared files');
    expect(frame).toContain('⚠ OWNERSHIP CONFLICT');
    expect(frame).toContain('1 blocked');
  });

  it('renders selected artifact metadata and a bounded result preview', () => {
    const canvas = new TerminalCanvas(140, 24);
    paintRosterDrawer({
      canvas, terminalColumns: 140, top: 3, bottom: 18,
      layout: resolveWorkbenchLayout(140, 'artifacts'), agents: null, tasks: null,
      artifacts: { artifacts: 1, results: 1, failed: 1, items: [
        {
          id: 'report-1', kind: 'artifact', status: 'available', title: 'Run report', artifactType: 'report',
          uri: 'file:///tmp/report.md', mediaType: 'text/markdown', sizeBytes: 2048, digest: 'abcdef1234567890',
          preview: 'First line\nSecond line', coordinationRunId: 'run-1', agentId: 'agent-1', taskId: 'task-1', createdAt: 1, sourceSequence: 1,
        },
        { id: 'result-1', kind: 'result', status: 'failed', title: 'Worker result', preview: 'failed', createdAt: 2, sourceSequence: 2 },
      ] },
      selectedRunId: 'run-1', selectedAgentId: 'agent-1', selectedTaskId: 'task-1', selectedArtifactId: 'report-1',
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('ARTIFACTS  1 files · 1 results');
    expect(frame).toContain('›◆ Run report');
    expect(frame).toContain('report · agent agent-1 · task ta…');
    expect(frame).toContain('file:///tmp/report.md');
    expect(frame).toContain('text/markdown · 2.0 KiB · digest…');
    expect(frame).toContain('First line');
    expect(frame).not.toContain('Worker result');
  });

  it('renders compact roster totals and marks partial known cost', () => {
    const canvas = new TerminalCanvas(180, 24);
    paintOperatorShell({
      canvas, width: 180, height: 24,
      model: {
        workspace: '/workspace', mode: 'auto', transcriptMode: 'compact', running: false,
        tokensUsed: 500, filesTouched: 2, eventCount: 10, queuedMessages: 0,
        agents: { active: 2, total: 3, running: 1, waitingApproval: 1, stalled: 1, knownCostUsd: 0.01, costCoverage: 2 },
      },
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('tokens 500 · files 2 · events 10 · agents 2/3 · wait 1 · stalled 1 · cost $0.0100+');
  });
});
