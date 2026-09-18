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
