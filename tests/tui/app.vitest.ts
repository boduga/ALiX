import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';

describe('TuiApp -- lifecycle', () => {
  let builder: { build: ReturnType<typeof vi.fn>; buildSync: ReturnType<typeof vi.fn> };
  let metrics: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  let app: TuiApp | undefined;

  beforeEach(() => {
    builder = { build: vi.fn(async () => null), buildSync: vi.fn(() => null) };
    metrics = { start: vi.fn(() => {}), stop: vi.fn(async () => {}) };
  });
  afterEach(async () => { if (app) await app.stop().catch(() => {}); });

  it('start() invokes metrics.start and the snapshot builder', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();
    expect(metrics.start).toHaveBeenCalled();
    expect(builder.build).toHaveBeenCalled();
    await app.stop();
  });

  it('stop() invokes metrics.stop', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    await app.start();
    await app.stop();
    expect(metrics.stop).toHaveBeenCalled();
  });
});

describe('TuiApp -- tab-state preservation', () => {
  it('preserves runtime.scrollOffset across tab switches', () => {
    const builder = { build: vi.fn(async () => ({} as any)), buildSync: () => ({} as any) };
    const metrics = { start: () => {}, stop: async () => {} };
    const app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    const state = app.getStateForTest();
    state.views.runtime.scrollOffset = 200;
    expect(state.views.runtime.scrollOffset).toBe(200);
  });
});
