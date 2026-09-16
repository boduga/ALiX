import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { resolveWorkbenchLayout, resolveWorkbenchSurfaceGeometry } from '../../../src/tui/workbench/layout/responsive-layout.js';
import { paintRosterDrawer } from '../../../src/tui/workbench/views/roster-drawer.js';

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
      agents: { active: 1, agents: [{
        agentId: 'a1', role: 'worker', state: 'tool_running', currentOperation: 'Editing composer',
        ownedPaths: ['src/tui'], startedAt: 1, lastProgressAt: 2,
        usage: { inputTokens: 1, outputTokens: 2, costUsd: 0 },
      }] },
      tasks: null,
    });
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('AGENTS  1 active');
    expect(frame).toContain('worker · tool_running');
    expect(frame).toContain('Editing composer');
    expect(frame).toContain('owns src/tui');
  });
});
