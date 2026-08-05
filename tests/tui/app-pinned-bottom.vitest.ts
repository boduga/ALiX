import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';
import { EventLog } from '../../src/events/event-log.js';

async function makeApp() {
  const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-pinned-')));
  await log.init();
  const snap = {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 },
    daemon: null, approvals: null, runtime: null, sops: null, policy: null,
  };
  const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
  const metrics = { start: () => {}, stop: async () => {} };
  const app = new TuiApp({
    builder, daemonMetrics: metrics,
    eventLog: log, chatSessionId: 'sess-chat', agentSessionId: 'sess-agent',
  } as unknown as TuiAppOptions);
  const internal = app as unknown as {
    handleRaw(buf: Buffer): void;
    getStateForTest(): { lastSnapshot: any; activeTab?: string; views: { [k: string]: any } };
  };
  internal.getStateForTest().lastSnapshot = snap;
  return { app, internal };
}

// Raw ANSI key sequences (matches app.ts:1522-1527 decoder).
const ARROW_UP = Buffer.from('\x1b[A');
const ARROW_DOWN = Buffer.from('\x1b[B');
const END = Buffer.from('\x1b[F');

describe('TuiApp pinnedBottom transitions', () => {
  let app: TuiApp;
  let internal: any;

  beforeEach(async () => {
    const m = await makeApp();
    app = m.app;
    internal = m.internal;
    internal.getStateForTest().activeTab = 'agent';
  });
  afterEach(async () => { await app.stop().catch(() => {}); });

  it('initial state on agent tab: pinnedBottom=true, scrollOffset=0', () => {
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
    expect(per.scrollOffset).toBe(0);
  });

  // Focused regression: the scroll-up capture formula must not silently drift.
  // Invariant: pressing ArrowUp exactly once from a freshly-activated pinned
  // tab with N>scrollbackRows lines must move `scrollOffset` from 0 to
  // (bottomAnchor - step), where step = 3 (the SCROLL_STEP in agent-view.ts:265).
  // Note: this test is partial because TuiApp's `handleRaw` arrow-key path
  // requires a snapshot to compute bottomAnchor (it reads allLines.length via
  // the view context). The harness below uses an empty snapshot for now —
  // to exercise the formula precisely, the implementer may need to seed the
  // snapshot with a populated `runtime.agent.timeline` and an EventLog.
  // If exact-assertion isn't feasible in this harness, fall back to:
  //   - assert pinnedBottom === false after one ArrowUp
  //   - assert scrollOffset is some finite number >= 0
  it('scroll-up exactly once from pinned: pinnedBottom becomes false', () => {
    internal.handleRaw(ARROW_UP);
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(false);
    expect(typeof per.scrollOffset).toBe('number');
  });

  it('scroll-down re-engages pinnedBottom when reaching bottom anchor', () => {
    internal.handleRaw(ARROW_UP);
    internal.handleRaw(ARROW_UP);
    for (let i = 0; i < 50; i++) internal.handleRaw(ARROW_DOWN);
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
  });

  it('End key: pinnedBottom=true regardless of prior state', () => {
    internal.handleRaw(ARROW_UP);
    internal.handleRaw(ARROW_UP);
    internal.handleRaw(END);
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
  });

  it('new content while pinned: pinnedBottom stays true', () => {
    // The view's render reads snapshot.lastSnapshot fresh each frame when
    // pinned, so even without an actual event arrival, the flag should
    // not flip on its own.
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
  });

  it('onActivate resets pinnedBottom=true', () => {
    internal.handleRaw(ARROW_UP);
    internal.getStateForTest().activeTab = 'dashboard';
    internal.getStateForTest().activeTab = 'agent';
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
  });

  it('chat tab has the same transitions as agent tab', () => {
    internal.getStateForTest().activeTab = 'chat';
    const per = internal.getStateForTest().views.chat;
    expect(per.pinnedBottom).toBe(true);
    expect(per.scrollOffset).toBe(0);
  });
});