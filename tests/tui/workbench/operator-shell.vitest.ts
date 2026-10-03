import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { DashboardSnapshot } from '../../../src/tui/snapshot.js';
import { createInitialPerTabState, SessionPhase } from '../../../src/tui/state.js';
import { projectOperatorShell } from '../../../src/tui/workbench/model/operator-shell.js';
import { getWorkbenchPreviewTheme } from '../../../src/tui/workbench/model/preview-theme.js';
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
  it('projects and paints preview chrome', () => {
    const canvas = new TerminalCanvas(200, 44);
    const state = createInitialPerTabState();
    const model = projectOperatorShell(snapshot(), state);

    paintOperatorShell({ canvas, width: 200, height: 44, model });
    const frame = visible(canvas.renderFrame());

    expect(frame).toContain('▄█▄ █    ▀  █ █');
    expect(frame).toContain('█▄█ █    █   ▀ ');
    expect(frame).toContain('/workspace/projects/ALiX');
    expect(frame).toContain('auto');
    expect(frame).toContain('TOKENS 3,918 | FILES 3 | EVENTS 1,204');
    expect(frame).toContain('Tab views');
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

    expect(frame).toContain('ask');
    expect(frame).toContain('1 approval • patch.apply • a approve • d deny');
    expect(frame).not.toContain('src/tui/app.ts');
    expect(frame).not.toContain('TOKENS 3,918');
  });

  it('fits a wide-character workspace without colliding with state chrome', () => {
    const snap = { ...snapshot(), cwd: '/very/long/workspace/調査調査/another/long/path/ALiX' };
    const canvas = new TerminalCanvas(52, 20);

    paintOperatorShell({ canvas, width: 52, height: 20, model: projectOperatorShell(snap, createInitialPerTabState()) });

    const header = visible(canvas.renderFrame()).split('\n').slice(0, 2).join('\n');
    expect(header).toContain('ALiX');
    expect(header).toContain('auto');
    expect(header).toContain('…');
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

  it('keeps queued follow-ups visible beside cancellation', () => {
    const snap = snapshot();
    const running = { ...snap, session: { ...snap.session!, phase: SessionPhase.Executing } };
    const canvas = new TerminalCanvas(100, 24);

    paintOperatorShell({
      canvas,
      width: 100,
      height: 24,
      model: projectOperatorShell(running, createInitialPerTabState(), undefined, 2),
    });

    expect(visible(canvas.renderFrame())).toContain('Esc cancel • 2 queued');
  });

  it('matches canonical header and footer groups without invented roster counts', () => {
    const canvas = new TerminalCanvas(200, 44);
    const model = { ...projectOperatorShell(snapshot(), createInitialPerTabState()), running: true,
      agents: { active: 3, total: 4, running: 3, waitingApproval: 0, stalled: 0, costCoverage: 0 } };
    paintOperatorShell({ canvas, width: 200, height: 44, model });
    const rows = visible(canvas.renderFrame()).split('\n');
    expect(rows[0]).toContain('▄█▄ █    ▀  █ █');
    expect(rows[0]).toContain('PREVIEW');
    expect(rows[0]).toContain('auto | 4 agents • 3 running');
    expect(rows[1]).toContain('workspace: /workspace/projects/ALiX');
    expect(rows[2]).toContain('█ █ ███  █  █ █');
    expect(rows[2]).not.toContain('─');
    expect(rows[43]).toContain('Tab views • Ctrl+O details • Ctrl+R artifacts • Esc cancel');
    expect(rows[43]).toContain('TOKENS 3,918 | FILES 3 | EVENTS 1,204 | AGENTS 4');
    expect(rows[43]).not.toContain('COST');
  });

  it('marks demonstration fixtures honestly and preserves explicit zero and partial cost', () => {
    const canvas = new TerminalCanvas(200, 44);
    const model = { ...projectOperatorShell(snapshot(), createInitialPerTabState()), demo: true, tokensUsed: 0, filesTouched: 0, eventCount: 0,
      agents: { active: 0, total: 4, running: 0, waitingApproval: 0, stalled: 0, knownCostUsd: 0, costCoverage: 1 } };
    paintOperatorShell({ canvas, width: 200, height: 44, model });
    const frame = visible(canvas.renderFrame());
    expect(frame).toContain('CONCEPT PREVIEW');
    expect(frame).toContain('TOKENS 0 | FILES 0 | EVENTS 0 | AGENTS 4 | COST $0.0000+');
    expect(frame).toContain('4 agents • 0 running');
  });

  it('keeps cancellation whole in a 20-column terminal', () => {
    const canvas = new TerminalCanvas(20, 10);
    const model = { ...projectOperatorShell(snapshot(), createInitialPerTabState()), running: true };
    paintOperatorShell({ canvas, width: 20, height: 10, model });
    const footer = visible(canvas.renderFrame()).split('\n')[9]!;
    expect(footer.trim()).toBe('Esc cancel');
    expect(visible(canvas.renderFrame())).toContain('auto');
  });

  it('shows close only for an open presentation surface', () => {
    const canvas = new TerminalCanvas(200, 44);
    paintOperatorShell({ canvas, width: 200, height: 44,
      model: { ...projectOperatorShell(snapshot(), createInitialPerTabState()), escapeAction: 'close' } });
    expect(visible(canvas.renderFrame())).toContain('Esc close');
    expect(visible(canvas.renderFrame())).not.toContain('Esc cancel');
  });

  it('prioritizes complete decision keys in narrow approval chrome', () => {
    const canvas = new TerminalCanvas(20, 10);
    paintOperatorShell({ canvas, width: 20, height: 10,
      model: { ...projectOperatorShell(snapshot(), createInitialPerTabState()), approval: { count: 1, toolName: 'alix_patch_apply' } } });
    expect(visible(canvas.renderFrame()).split('\n')[9]!.trim()).toBe('a approve • d deny');
  });

  it('keeps stalled and waiting approvals visible ahead of optional roster totals', () => {
    const canvas = new TerminalCanvas(52, 20);
    paintOperatorShell({ canvas, width: 52, height: 20,
      model: { ...projectOperatorShell(snapshot(), createInitialPerTabState()),
        agents: { active: 2, total: 9, running: 1, waitingApproval: 2, stalled: 1, costCoverage: 0 } } });
    const frame = visible(canvas.renderFrame());
    expect(frame).toContain('2 approvals | 1 stalled');
  });

  it('supports explicit monochrome ASCII capability and unknown counters', () => {
    const canvas = new TerminalCanvas(200, 44);
    paintOperatorShell({ canvas, width: 200, height: 44, theme: getWorkbenchPreviewTheme('monochrome', 'ascii'),
      model: { ...projectOperatorShell(snapshot(), createInitialPerTabState()), tokensUsed: undefined, filesTouched: undefined, eventCount: undefined } });
    const frame = visible(canvas.renderFrame());
    expect(frame).toContain('Tab views . Ctrl+O details . Ctrl+R artifacts');
    expect(frame).toContain('TOKENS unavailable | FILES unavailable | EVENTS unavailable | AGENTS unavailable');
    expect(frame.split('\n')[2]!.trim()).toBe('');
    expect(frame).toContain('ALiX WORKBENCH');
    expect(frame).not.toContain('█');
  });

  it('paints a three-row bold cyan banner without extending header geometry', () => {
    const canvas = new TerminalCanvas(200, 44);
    canvas.write(0, 3, 'body marker');
    paintOperatorShell({ canvas, width: 200, height: 44, model: projectOperatorShell(snapshot(), createInitialPerTabState()) });
    const raw = canvas.renderFrame();
    const rows = visible(raw).split('\n');
    for (const row of rows.slice(0, 3)) expect(row).toContain('█');
    expect(raw).toContain('\x1b[38;2;6;201;239m\x1b[1m');
    expect(rows[3]).toContain('body marker');
    expect(rows[2]).not.toContain('─');
  });

  it('keeps short and narrow headers compact without a divider', () => {
    for (const [width, height] of [[200, 8], [119, 24], [64, 24]]) {
      const canvas = new TerminalCanvas(width!, height!);
      paintOperatorShell({ canvas, width: width!, height: height!, model: projectOperatorShell(snapshot(), createInitialPerTabState()) });
      const rows = visible(canvas.renderFrame()).split('\n');
      expect(rows[0]).toContain('ALiX WORKBENCH');
      expect(rows[2]!.trim()).toBe('');
      expect(rows[0]).not.toContain('█');
    }
  });

  it('truncates Unicode workspace beside the large banner without overwriting it', () => {
    const canvas = new TerminalCanvas(120, 24);
    paintOperatorShell({ canvas, width: 120, height: 24,
      model: { ...projectOperatorShell(snapshot(), createInitialPerTabState()), workspace: '/very/long/workspace/調査調査/another/long/path/ALiX' } });
    const rows = visible(canvas.renderFrame()).split('\n');
    expect(rows[1]).toContain('█▄█ █    █   ▀ ');
    expect(rows[1]).toContain('workspace: …');
    expect(rows[1]).toContain('/ALiX');
    expect(rows[0]).toContain('auto');
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
    expect(workbench).toContain('PREVIEW');
    expect(workbench).not.toContain('Interactive Session');
    expect(workbench).not.toContain('SOPS:');

    const legacy = render(false);
    expect(legacy).not.toContain('ALiX WORKBENCH');
    expect(legacy).toContain('Session:');
    expect(legacy).toContain('SOPS:');
  });
});
