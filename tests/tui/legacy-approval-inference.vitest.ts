/**
 * R4/V3 — the legacy agent-tab a/d approval handler must NOT infer the
 * outcome locally. The pending card clears only when the authoritative
 * resolved projection is sampled (syncPendingApprovals), matching the
 * Workbench path. Before this fix the legacy handler optimistically shifted
 * the pending entry and unshifted a synthetic resolved entry before any
 * evidence existed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../src/interfaces/tui/app.js';

function snapshot(approvals: unknown) {
  return {
    generatedAt: Date.now(),
    session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: Date.now(), turns: 0 },
    daemon: null,
    approvals,
    runtime: null,
    sops: null,
    policy: null,
  };
}

const PENDING = {
  pending: [{ id: 'ap-1', toolName: 'write_file', target: 'x.ts', args: {}, requestedAt: Date.now(), requestedBy: 't' }],
  recentlyResolved: [],
  totalPending: 1,
  totalResolved: 0,
};

const RESOLVED = {
  pending: [],
  recentlyResolved: [
    { id: 'ap-1', status: 'approved', toolName: 'write_file', target: 'x.ts', requestedAt: Date.now(), resolvedAt: Date.now() },
  ],
  totalPending: 0,
  totalResolved: 1,
};

type AppInternals = {
  setActiveTabForTest: (tab: string) => void;
  getStateForTest: () => { views: Record<string, { pendingApprovals: Array<{ id: string; status?: string }>; resolvedApprovals: Array<{ id: string; status: string }> }> };
  refresh: () => Promise<void>;
  handleRaw: (buf: Buffer) => void;
};

describe('legacy a/d approval inference (R4/V3)', () => {
  let app: TuiApp | undefined;
  let state: unknown = PENDING;
  let origColumns: PropertyDescriptor | undefined;
  let origRows: PropertyDescriptor | undefined;

  beforeEach(() => {
    origColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    origRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 40, configurable: true });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    if (app) await app.stop().catch(() => {});
    vi.restoreAllMocks();
    if (origColumns) Object.defineProperty(process.stdout, 'columns', origColumns);
    if (origRows) Object.defineProperty(process.stdout, 'rows', origRows);
  });

  it('clears the card only from the authoritative resolved projection', async () => {
    state = PENDING;
    const builder = { build: vi.fn(async () => snapshot(state)), buildSync: vi.fn(() => null) };
    app = new TuiApp({ builder, daemonMetrics: { start: () => {}, stop: async () => {} } } as unknown as TuiAppOptions);
    await app.start();

    const it = app as unknown as AppInternals;
    it.setActiveTabForTest('agent');
    await it.refresh();
    expect(it.getStateForTest().views.agent.pendingApprovals.map((a) => a.id)).toEqual(['ap-1']);

    it.handleRaw(Buffer.from('a'));

    // No optimistic mutation before any projection evidence exists.
    const view = it.getStateForTest().views.agent;
    expect(view.pendingApprovals.map((a) => a.id)).toEqual(['ap-1']);
    expect(view.resolvedApprovals).toEqual([]);

    // The authoritative projection now reports the resolution.
    state = RESOLVED;
    await it.refresh();
    const after = it.getStateForTest().views.agent;
    expect(after.pendingApprovals).toEqual([]);
    expect(after.resolvedApprovals.map((a) => [a.id, a.status])).toEqual([['ap-1', 'approved']]);
  });
});
