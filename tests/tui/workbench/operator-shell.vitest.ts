import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { DashboardSnapshot } from '../../../src/tui/snapshot.js';
import { createInitialPerTabState, SessionPhase } from '../../../src/tui/state.js';
import { projectOperatorShell } from '../../../src/tui/workbench/model/operator-shell.js';
import { paintOperatorShell } from '../../../src/tui/workbench/views/operator-shell.js';
import { TuiApp, type TuiAppOptions } from '../../../src/tui/app.js';
import { MockInput, MockOutput } from '../../../src/tui/io.js';

function visible(frame: string): string {
  return frame.replace(/\x1b\[[0-9;]*m/gu, '');
}

function snapshot(): DashboardSnapshot {
  return {
    generatedAt: 1,
    session: { mode: 'auto', phase: SessionPhase.Idle, version: 'test', startedAt: 1, turns: 2, filesTouched: 3 },
    daemon: null,
    approvals: null,
    runtime: {
      trace: [], timeline: [], workflow: null, totalEventCount: 1204,
      lastEventAt: null, sessionId: 's', capabilities: null,
      metrics: { tokensUsed: 3918 } as any, context: null,
    },
    sops: null,
    policy: null,
    cwd: '/workspace/projects/ALiX',
  };
}

describe('Agent Workbench operator shell', () => {
  it('projects and paints quiet project-focused chrome', () => {
    const canvas = new TerminalCanvas(120, 30);
    const state = createInitialPerTabState();
    const model = projectOperatorShell(snapshot(), state);

    paintOperatorShell({ canvas, width: 120, height: 30, model });
    const frame = visible(canvas.renderFrame());

    expect(frame).toContain('workbench');
    expect(frame).toContain('ALiX');
    expect(frame).toContain('/workspace/projects/ALiX');
    expect(frame).toContain('agent · auto · compact');
    expect(frame).toContain('tokens 3,918 · files 3 · events 1,204');
    expect(frame).toContain('↑↓ scroll');
  });

  it('prioritizes a pending approval in narrow chrome', () => {
    const canvas = new TerminalCanvas(64, 24);
    const state = createInitialPerTabState();
    state.pendingApprovals = [{
      id: 'ap-1', toolName: 'patch.apply', target: 'src/tui/app.ts', requestedAt: 1,
    }];
    const model = projectOperatorShell(snapshot(), state, 'ask');

    paintOperatorShell({ canvas, width: 64, height: 24, model });
    const frame = visible(canvas.renderFrame());

    expect(frame).toContain('agent · ask · compact');
    expect(frame).toContain('approval');
    expect(frame).toContain('patch.apply');
    expect(frame).not.toContain('tokens 3,918');
  });

  it('surfaces cancellation while an agent turn is active', () => {
    const snap = snapshot();
    const running = {
      ...snap,
      session: { ...snap.session!, phase: SessionPhase.Executing },
    };
    const canvas = new TerminalCanvas(100, 24);

    paintOperatorShell({
      canvas, width: 100, height: 24,
      model: projectOperatorShell(running, createInitialPerTabState()),
    });

    expect(visible(canvas.renderFrame())).toContain('Esc cancel');
  });

  it('replaces legacy chrome only on the feature-gated agent surface', () => {
    const render = (workbenchEnabled: boolean): string => {
      const output = new MockOutput();
      const app = new TuiApp({
        builder: { build: async () => snapshot(), buildSync: () => snapshot() },
        daemonMetrics: { start: () => {}, stop: async () => {} },
        input: new MockInput(),
        output,
        workbenchEnabled,
      } as unknown as TuiAppOptions);
      const state = app.getStateForTest();
      state.lastSnapshot = snapshot();
      state.activeTab = 'agent';
      (app as unknown as { paintFullFrame(): void }).paintFullFrame();
      return visible(output.writes.join(''));
    };

    const workbench = render(true);
    expect(workbench).toContain('workbench');
    expect(workbench).not.toContain('Interactive Session');
    expect(workbench).not.toContain('SOPS:');

    const legacy = render(false);
    expect(legacy).not.toContain('workbench');
    expect(legacy).toContain('Session:');
    expect(legacy).toContain('SOPS:');
  });
});
