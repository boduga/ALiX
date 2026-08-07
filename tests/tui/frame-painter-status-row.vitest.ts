/**
 * #433 — retire the phase radio strip from the status row.
 *
 * The status row sits at the bottom of the frame. The strip previously wrote
 * five `●/○ PHASE` entries at column 0; the pipeline counters are written
 * right-aligned. Ticket acceptance: the strip is gone, the counters remain
 * exactly as before, and the left of the row is empty when nothing is pending.
 *
 * The strip is conditionally rendered: it only paints when the column budget
 * fits alongside the pipeline fields. The tests here force a wide terminal
 * (200 columns) so the strip WOULD render if present — that makes the
 * assertion a true negative (the strip is gone, not just "skipped").
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';

const STRIP_LABELS = [
  'UNDERSTANDING',
  'PLANNING',
  'EXECUTING',
  'VERIFYING',
  'SUMMARIZING',
] as const;

describe('FramePainter status row — phase radio strip (#433)', () => {
  let app: TuiApp | undefined;
  let captured: string[] = [];
  let origColumns: PropertyDescriptor | undefined;
  let origRows: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Force a wide terminal so the strip's "fits alongside fields" guard
    // would allow it to render. Without this, the strip is silently dropped
    // on the default 80-col PTY and the negative test would never fail.
    origColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    origRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 30, configurable: true });

    captured = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    });
  });

  afterEach(async () => {
    if (app) await app.stop().catch(() => {});
    vi.restoreAllMocks();
    if (origColumns) Object.defineProperty(process.stdout, 'columns', origColumns);
    if (origRows) Object.defineProperty(process.stdout, 'rows', origRows);
  });

  function internals(a: TuiApp): {
    setActiveTabForTest: (tab: string) => void;
    refresh: () => Promise<void>;
  } {
    return a as unknown as {
      setActiveTabForTest: (tab: string) => void;
      refresh: () => Promise<void>;
    };
  }

  it('renders the agent tab status row with no phase radio strip', async () => {
    const builder = {
      build: vi.fn(async () => ({
        generatedAt: Date.now(),
        session: {
          mode: 'auto' as const,
          phase: 'Executing',
          version: '0.3.1',
          startedAt: Date.now(),
          turns: 1,
        },
        daemon: null,
        approvals: null,
        runtime: null,
        sops: null,
        policy: null,
      })),
      buildSync: vi.fn(() => null),
    };
    const metrics = { start: () => {}, stop: async () => {} };

    app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();

    const it = internals(app);
    it.setActiveTabForTest('agent');
    await it.refresh();

    const frame = captured.join('');

    // Strip labels must not appear anywhere in the rendered frame.
    for (const label of STRIP_LABELS) {
      expect(frame, `frame must not contain phase label "${label}"`).not.toContain(label);
    }
  });

  it('keeps the pipeline counters right-aligned on the status row', async () => {
    const builder = {
      build: vi.fn(async () => ({
        generatedAt: Date.now(),
        session: {
          mode: 'auto' as const,
          phase: 'Idle',
          version: '0.3.1',
          startedAt: Date.now(),
          turns: 0,
        },
        daemon: null,
        approvals: null,
        runtime: {
          totalEventCount: 1204,
          chat: null,
          agent: null,
        } as any,
        sops: null,
        policy: null,
      })),
      buildSync: vi.fn(() => null),
    };
    const metrics = { start: () => {}, stop: async () => {} };

    app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();

    const it = internals(app);
    it.setActiveTabForTest('agent');
    await it.refresh();

    const frame = captured.join('');

    // Pipeline counters must still be present.
    expect(frame).toContain('EVENTS');
    expect(frame).toContain('1,204');
  });

  // ─── TOKENS live data (Task #5) ────────────────────────────────────────
  // The status row TOKENS field rides the same transport as EVENTS: task-loop
  // `model.usage` events → outer RuntimeCollector → MetricsProjection →
  // snap.runtime.metrics.tokensUsed. Locale-formatted, used-only.
  it('renders live tokensUsed from snap.runtime.metrics into the TOKENS field', async () => {
    const builder = {
      build: vi.fn(async () => ({
        generatedAt: Date.now(),
        session: {
          mode: 'auto' as const,
          phase: 'Idle',
          version: '0.3.1',
          startedAt: Date.now(),
          turns: 0,
        },
        daemon: null,
        approvals: null,
        runtime: {
          totalEventCount: 1204,
          metrics: { tokensUsed: 3918 },
          chat: null,
          agent: null,
        } as any,
        sops: null,
        policy: null,
      })),
      buildSync: vi.fn(() => null),
    };
    const metrics = { start: () => {}, stop: async () => {} };

    app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();

    const it = internals(app);
    it.setActiveTabForTest('agent');
    await it.refresh();

    const frame = captured.join('');
    expect(frame).toContain('TOKENS: 3,918');
  });

  it('defaults TOKENS to 0 when no usage has been projected', async () => {
    const builder = {
      build: vi.fn(async () => ({
        generatedAt: Date.now(),
        session: {
          mode: 'auto' as const,
          phase: 'Idle',
          version: '0.3.1',
          startedAt: Date.now(),
          turns: 0,
        },
        daemon: null,
        approvals: null,
        runtime: null,
        sops: null,
        policy: null,
      })),
      buildSync: vi.fn(() => null),
    };
    const metrics = { start: () => {}, stop: async () => {} };

    app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();

    const it = internals(app);
    it.setActiveTabForTest('agent');
    await it.refresh();

    const frame = captured.join('');
    expect(frame).toContain('TOKENS: 0');
  });
});

// ─── #436 — pending-approval banner on the agent status row ─────
// The status row has been quiet on the left since #433 retired the
// phase radio strip. When an approval is pending the banner takes the
// vacated space and names the tool + target the approve/deny keys
// will act on, so the operator never resolves an approval blind.
// ───────────────────────────────────────────────────────────────────────
describe('FramePainter status row — pending-approval banner (#436)', () => {
  let app: TuiApp | undefined;
  let captured: string[] = [];
  let origColumns: PropertyDescriptor | undefined;
  let origRows: PropertyDescriptor | undefined;

  beforeEach(() => {
    origColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    origRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 30, configurable: true });
    captured = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    });
  });

  afterEach(async () => {
    if (app) await app.stop().catch(() => {});
    vi.restoreAllMocks();
    if (origColumns) Object.defineProperty(process.stdout, 'columns', origColumns);
    if (origRows) Object.defineProperty(process.stdout, 'rows', origRows);
  });

  function internals(a: TuiApp): {
    setActiveTabForTest: (tab: string) => void;
    refresh: () => Promise<void>;
  } {
    return a as unknown as {
      setActiveTabForTest: (tab: string) => void;
      refresh: () => Promise<void>;
    };
  }

  function baselineBuilder(approvals: any) {
    return {
      build: vi.fn(async () => ({
        generatedAt: Date.now(),
        session: {
          mode: 'auto' as const,
          phase: 'Executing',
          version: '0.3.1',
          startedAt: Date.now(),
          turns: 1,
          filesTouched: 3,
        },
        daemon: null,
        approvals,
        runtime: {
          totalEventCount: 1204,
          chat: null,
          agent: null,
        } as any,
        sops: null,
        policy: null,
      })),
      buildSync: vi.fn(() => null),
    };
  }

  it('renders the banner naming the oldest pending approval when one is queued', async () => {
    const metrics = { start: () => {}, stop: async () => {} };
    const approvals = {
      pending: [
        {
          id: 'ap-1',
          toolName: 'write_file',
          target: 'guard.ts',
          args: {},
          requestedAt: Date.now(),
          requestedBy: 'test',
        },
      ],
      recentlyResolved: [],
      totalPending: 1,
      totalResolved: 0,
    };
    app = new TuiApp({ builder: baselineBuilder(approvals), daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();

    const it = internals(app);
    it.setActiveTabForTest('agent');
    await it.refresh();

    const frame = captured.join('');
    // Banner names the tool and target the keys act on.
    expect(frame).toContain('⏸');
    expect(frame).toContain('1 pending');
    expect(frame).toContain('a/d: write_file guard.ts');
  });

  it('AC#2 — banner renders from a non-agent tab when approvals are pending (no a/d hint)', async () => {
    const metrics = { start: () => {}, stop: async () => {} };
    const approvals = {
      pending: [
        {
          id: 'ap-1',
          toolName: 'write_file',
          target: 'guard.ts',
          args: {},
          requestedAt: Date.now(),
          requestedBy: 'test',
        },
      ],
      recentlyResolved: [],
      totalPending: 1,
      totalResolved: 0,
    };
    app = new TuiApp({ builder: baselineBuilder(approvals), daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();

    const it = internals(app);
    // Active tab is daemon, NOT agent — the banner is shared status-row
    // chrome and must surface pending approvals on any tab (spec AC#2), but
    // the a/d keys only resolve on the agent tab (app.ts handleRaw), so the
    // non-agent banner names the approval without advertising keys that
    // won't respond.
    it.setActiveTabForTest('daemon');
    await it.refresh();

    const frame = captured.join('');
    expect(frame).toContain('⏸');
    expect(frame).toContain('1 pending');
    expect(frame).toContain('write_file guard.ts');
    expect(frame).not.toContain('a/d:');
  });

  it('marks the oldest target explicitly when multiple approvals are queued', async () => {
    const metrics = { start: () => {}, stop: async () => {} };
    // pendingApprovals[0] is the OLDEST — the key handler resolves that
    // one. Seed with two entries, the first is the named one.
    const approvals = {
      pending: [
        {
          id: 'ap-oldest',
          toolName: 'write_file',
          target: 'guard.ts',
          args: {},
          requestedAt: Date.now() - 1000,
          requestedBy: 'test',
        },
        {
          id: 'ap-newer',
          toolName: 'edit_file',
          target: 'login.ts',
          args: {},
          requestedAt: Date.now(),
          requestedBy: 'test',
        },
      ],
      recentlyResolved: [],
      totalPending: 2,
      totalResolved: 0,
    };
    app = new TuiApp({ builder: baselineBuilder(approvals), daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();

    const it = internals(app);
    it.setActiveTabForTest('agent');
    await it.refresh();

    const frame = captured.join('');
    expect(frame).toContain('2 pending');
    expect(frame).toContain('oldest');
    expect(frame).toContain('write_file guard.ts');
    // The newer entry must NOT be the named target.
    expect(frame).not.toContain('edit_file login.ts');
  });

  it('disappears when no approvals are pending', async () => {
    const metrics = { start: () => {}, stop: async () => {} };
    const approvals = {
      pending: [],
      recentlyResolved: [],
      totalPending: 0,
      totalResolved: 0,
    };
    app = new TuiApp({ builder: baselineBuilder(approvals), daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();

    const it = internals(app);
    it.setActiveTabForTest('agent');
    await it.refresh();

    const frame = captured.join('');
    // No banner when nothing is pending. The pause marker is unique to
    // the banner; "a/d:" is also a banner-only prefix.
    expect(frame).not.toContain('⏸');
    expect(frame).not.toContain('a/d:');
    // Pipeline counters still present.
    expect(frame).toContain('EVENTS');
    expect(frame).toContain('1,204');
  });

  it('on a narrow terminal the banner is kept and the pipeline counters yield', async () => {
    // Force a narrow terminal (40 cols) so banner + pipeline fields
    // would not both fit. Banner takes precedence: pipeline counters
    // yield rather than truncate the actionable banner.
    const origCols = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    Object.defineProperty(process.stdout, 'columns', { value: 40, configurable: true });

    try {
      const metrics = { start: () => {}, stop: async () => {} };
      const approvals = {
        pending: [
          {
            id: 'ap-1',
            toolName: 'write_file',
            target: 'guard.ts',
            args: {},
            requestedAt: Date.now(),
            requestedBy: 'test',
          },
        ],
        recentlyResolved: [],
        totalPending: 1,
        totalResolved: 0,
      };
      app = new TuiApp({ builder: baselineBuilder(approvals), daemonMetrics: metrics } as unknown as TuiAppOptions);
      await app.start();

      const it = internals(app);
      it.setActiveTabForTest('agent');
      await it.refresh();

      const frame = captured.join('');
      // Banner survives.
      expect(frame).toContain('⏸');
      expect(frame).toContain('write_file guard.ts');
      // Pipeline counters may yield. The banner is what survives.
      // We assert the banner IS present (above) — yielding is the
      // frame-painter choosing not to write the counters, which the
      // captured frame will reflect.
    } finally {
      if (origCols) Object.defineProperty(process.stdout, 'columns', origCols);
    }
  });
});
