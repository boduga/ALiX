import { describe, it, expect } from 'vitest';
import { DaemonView } from '../../../src/tui/views/daemon-view.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';

function ctx(snap: any = null): ViewRenderContext {
  return {
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: [],
            agentResponses: []
          },
  };
}

describe('DaemonView', () => {
  it('renders PID, uptime, version, workspace when daemon is online', () => {
    const view = new DaemonView();
    const snap = {
      generatedAt: 1, session: null,
      daemon: { pid: 1234, uptimeSeconds: 3600, cpuPercent: 12, memoryRssBytes: 50e6, memoryTotalBytes: 16e9, diskUsedBytes: 1e9, diskTotalBytes: 100e9, clients: [], sampledAt: 1 },
      approvals: null, runtime: null, sops: null, policy: null,
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /1234/.test(r))).toBe(true);
    expect(out.rows.some((r) => /uptime/i.test(r))).toBe(true);
    expect(out.rows.some((r) => /disk/i.test(r))).toBe(true);
  });

  it('renders offline notice when daemon snapshot is null', () => {
    const view = new DaemonView();
    const out = view.render(ctx());
    expect(out.rows.some((r) => /not running|offline|○/.test(r))).toBe(true);
  });

  it('renders CPU/MEM bars', () => {
    const view = new DaemonView();
    const snap = {
      generatedAt: 1, session: null,
      daemon: { pid: 1, uptimeSeconds: 10, cpuPercent: 42, memoryRssBytes: 8e9, memoryTotalBytes: 16e9, diskUsedBytes: 0, diskTotalBytes: 100e9, clients: [], sampledAt: 1 },
      approvals: null, runtime: null, sops: null, policy: null,
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /cpu/i.test(r))).toBe(true);
    expect(out.rows.some((r) => /mem/i.test(r))).toBe(true);
  });

  it('is pure — same ctx, same rows', () => {
    const view = new DaemonView();
    const c = ctx();
    expect(view.render(c).rows).toEqual(view.render(c).rows);
  });
});
