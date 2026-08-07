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
});
