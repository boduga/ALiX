import { describe, it, expect } from 'vitest';
import { DashboardView } from '../../../src/tui/views/dashboard-view.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';

function ctx(overrides: Partial<{ snap: any; perTab: any; dims: any }> = {}): ViewRenderContext {
  const dims = overrides.dims ?? { columns: 120, rows: 30 };
  const snap = overrides.snap ?? {
    generatedAt: 1,
    session: { mode: 'auto', phase: 'Idle', version: '1', startedAt: 0, turns: 0 },
    daemon: null,
    approvals: null,
    runtime: null,
    sops: null,
    policy: null,
  };
  return {
    snap,
    dimensions: dims,
    perTab: overrides.perTab ?? {
      cursor: 0,
      scrollOffset: 0,
      searchQuery: '',
      expandedSections: [],
      lastEventArrivedAt: 0,
      inputBuffer: '',
      pinnedBottom: true,
      submittedPrompts: [],
      agentResponses: [],
      pendingApprovals: [],
      resolvedApprovals: [],
      timelineEvents: [],
      panelScrollOffsets: { approvals: 0, sops: 0 },
      panelFocus: null,
    },
    canvas: new TerminalCanvas(dims.columns, dims.rows),
  };
}

describe('DashboardView', () => {
  it('renders all 4 panels on the canvas', () => {
    const view = new DashboardView();
    const c = ctx({ dims: { columns: 120, rows: 30 } });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toMatch(/DAEMON/);
    expect(frame).toMatch(/APPROVALS/);
    expect(frame).toMatch(/RUNTIME/);
    expect(frame).toMatch(/SOPS/);
  });

  it('renders the offline notice when daemon snapshot is null', () => {
    const view = new DashboardView();
    const c = ctx({
      dims: { columns: 120, rows: 30 },
      snap: {
        generatedAt: 1,
        session: null,
        daemon: null,
        approvals: null,
        runtime: null,
        sops: null,
        policy: null,
      },
    });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toContain('not running');
  });

  it('stacks panels vertically on narrow terminals', () => {
    const view = new DashboardView();
    const c = ctx({ dims: { columns: 80, rows: 24 } });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    // On a small terminal, all 4 panels should still render
    expect(frame).toMatch(/DAEMON/);
    expect(frame).toMatch(/SOPS/);
  });

  it('uses 2x2 grid on wide terminals', () => {
    const view = new DashboardView();
    const c = ctx({ dims: { columns: 140, rows: 40 } });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toMatch(/DAEMON/);
    expect(frame).toMatch(/APPROVALS/);
    expect(frame).toMatch(/RUNTIME/);
    expect(frame).toMatch(/SOPS/);
    // The grid layout should not show panels stacked sequentially
    // (no DAEMON before RUNTIME in the linear y-order).
    // We verify by checking both top-left and top-right panels appear
    // in the first few rows of the frame.
    const lines = frame.split('\n');
    const firstThird = lines.slice(0, Math.floor(lines.length / 2)).join('\n');
    expect(firstThird).toMatch(/DAEMON/);
    expect(firstThird).toMatch(/APPROVALS/);
  });
});
