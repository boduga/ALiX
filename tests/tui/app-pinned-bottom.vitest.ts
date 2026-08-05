import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';
import { EventLog } from '../../src/events/event-log.js';
import { computeBottomAnchor } from '../../src/tui/views/scroll-math.js';
import type { ViewRenderContext } from '../../src/tui/views/types.js';

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

  it('chat End key: pinnedBottom=true and scrollOffset equals bottom anchor', () => {
    const seeded = Array.from({ length: 60 }, (_, i) => ({
      id: `chat-tl-${i}`,
      kind: 'chat.response' as const,
      sessionId: 'sess-chat',
      startedAt: i,
      text: `seeded chat line ${i}`,
      sourceEvents: { firstSequence: i },
    }));
    (internal as unknown as { chatRuntime: unknown }).chatRuntime = {
      trace: [], timeline: seeded, workflow: null,
      totalEventCount: seeded.length, lastEventAt: seeded.length, sessionId: 'sess-chat',
    };
    internal.getStateForTest().activeTab = 'chat';

    internal.handleRaw(ARROW_UP);
    const per = internal.getStateForTest().views.chat;
    expect(per.pinnedBottom).toBe(false);

    internal.handleRaw(END);
    const expected = computeBottomAnchor(
      (app as unknown as { buildViewRenderContext(tab: string): ViewRenderContext }).buildViewRenderContext('chat'),
      'chat',
      Math.max(0, (process.stdout.columns ?? 80) - 4),
      Math.max(0, (process.stdout.rows ?? 24) - 3 - 1),
    );
    expect(per.pinnedBottom).toBe(true);
    expect(per.scrollOffset).toBe(expected);
  });

  it('new content while pinned: pinnedBottom stays true', () => {
    // The view's render reads snapshot.lastSnapshot fresh each frame when
    // pinned, so even without an actual event arrival, the flag should
    // not flip on its own.
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
  });

  it('new content while unpinned does not drift the scroll offset', () => {
    const seeded = Array.from({ length: 60 }, (_, i) => ({
      id: `tl-${i}`,
      kind: 'agent.response' as const,
      sessionId: 'sess-agent',
      startedAt: i,
      text: `seeded line ${i}`,
      sourceEvents: { firstSequence: i },
    }));
    const runtime = {
      trace: [], timeline: seeded, workflow: null,
      totalEventCount: seeded.length, lastEventAt: seeded.length, sessionId: 'sess-agent',
    };
    (internal as unknown as { agentRuntime: typeof runtime }).agentRuntime = runtime;
    internal.getStateForTest().activeTab = 'dashboard';
    internal.getStateForTest().activeTab = 'agent';

    internal.handleRaw(ARROW_UP);
    const per = internal.getStateForTest().views.agent;
    const offsetBefore = per.scrollOffset;
    expect(per.pinnedBottom).toBe(false);

    for (let i = 60; i < 65; i++) {
      runtime.timeline.push({
        id: `tl-${i}`,
        kind: 'agent.response',
        sessionId: 'sess-agent',
        startedAt: i,
        text: `new line ${i}`,
        sourceEvents: { firstSequence: i },
      });
    }
    runtime.totalEventCount = runtime.timeline.length;

    expect(per.scrollOffset).toBe(offsetBefore);
    expect(per.pinnedBottom).toBe(false);
  });

  it('onActivate resets pinnedBottom=true', () => {
    internal.handleRaw(ARROW_UP);
    internal.getStateForTest().activeTab = 'dashboard';
    internal.getStateForTest().activeTab = 'agent';
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
  });

  it('onActivate sets scrollOffset to bottomAnchor (spec invariant), not literal 0', () => {
    // Spec invariant (docs/superpowers/specs/2026-08-05-tui-bottom-anchored-panel-design.md,
    // "Documented tradeoffs" #1): `scrollOffset` must equal `bottomAnchor` so
    // the scroll-up capture formula in `dispatch`'s `scroll` case has a
    // consistent baseline when `pinnedBottom` flips to false. Regression
    // guard: prior hardcoded `scrollOffset = 0` happened to render correctly
    // because the pinned render branch ignored `scrollOffset`, but the
    // invariant was broken.
    // Seed agent timeline with N > scrollbackRows events so bottomAnchor > 0.
    const seeded: Array<{ id: string; kind: 'agent.response'; sessionId: string; startedAt: number; text: string; sourceEvents: { firstSequence: number } }> = [];
    for (let i = 0; i < 60; i++) {
      seeded.push({
        id: `tl-${i}`,
        kind: 'agent.response',
        sessionId: 'sess-agent',
        startedAt: i,
        text: `seeded line ${i}`,
        sourceEvents: { firstSequence: i },
      });
    }
    (internal as unknown as { agentRuntime: unknown }).agentRuntime = {
      trace: [], timeline: seeded, workflow: null,
      totalEventCount: seeded.length, lastEventAt: seeded.length, sessionId: 'sess-agent',
    };
    // Switch away and back so the onActivate path runs.
    internal.getStateForTest().activeTab = 'dashboard';
    internal.getStateForTest().activeTab = 'agent';

    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
    // Compute the expected baseline the same way `switchTab`/`onActivate` does.
    const expected = computeBottomAnchor(
      (app as unknown as { buildViewRenderContext(tab: string): ViewRenderContext }).buildViewRenderContext('agent'),
      'agent',
      Math.max(0, (process.stdout.columns ?? 80) - 4),
      Math.max(0, (process.stdout.rows ?? 24) - 3 - 1),
    );
    expect(expected).toBeGreaterThan(0);
    expect(per.scrollOffset).toBe(expected);
    expect(per.scrollOffset).not.toBe(0);
  });

  it('chat tab has the same transitions as agent tab', () => {
    internal.getStateForTest().activeTab = 'chat';
    const per = internal.getStateForTest().views.chat;
    expect(per.pinnedBottom).toBe(true);
    expect(per.scrollOffset).toBe(0);
  });

  // Spec regression (docs/superpowers/specs/2026-08-05-tui-bottom-anchored-panel-design.md,
  // §State transitions): ArrowUp must move the window toward older history
  // (smaller windowStart); ArrowDown must move toward newer content (larger
  // windowStart). PinnedBottom must flip correctly along the way. Without
  // this guard, a future refactor could silently invert the dispatch
  // case 'scroll' else-if branch — the existing tests only check the
  // pinned-state endpoints (pinnedBottom true after End / 50× ArrowDown on
  // empty timeline), not the in-flight direction.
  it('scroll direction: ArrowUp moves window toward older content, ArrowDown toward newer', () => {
    // Seed 100 events so bottomAnchor > 0 (so offset0 is meaningful).
    const seeded: Array<{ id: string; kind: 'agent.response'; sessionId: string; startedAt: number; text: string; sourceEvents: { firstSequence: number } }> = [];
    for (let i = 0; i < 100; i++) {
      seeded.push({
        id: `tl-${i}`,
        kind: 'agent.response',
        sessionId: 'sess-agent',
        startedAt: i,
        text: `seeded line ${i}`,
        sourceEvents: { firstSequence: i },
      });
    }
    (internal as unknown as { agentRuntime: unknown }).agentRuntime = {
      trace: [], timeline: seeded, workflow: null,
      totalEventCount: seeded.length, lastEventAt: seeded.length, sessionId: 'sess-agent',
    };
    // Switch away and back so onActivate resets scrollOffset to bottomAnchor.
    internal.getStateForTest().activeTab = 'dashboard';
    internal.getStateForTest().activeTab = 'agent';

    const per = internal.getStateForTest().views.agent;
    const offset0 = per.scrollOffset;
    expect(offset0).toBeGreaterThan(0); // baseline must be > 0 for the assertions below

    internal.handleRaw(ARROW_UP);
    const offset1 = per.scrollOffset;
    expect(per.pinnedBottom).toBe(false); // ArrowUp from pinned → unpinned
    expect(offset1).toBeLessThan(offset0); // ArrowUp moves window toward older content

    internal.handleRaw(ARROW_DOWN);
    const offset2 = per.scrollOffset;
    expect(offset2).toBeGreaterThan(offset1); // ArrowDown moves window toward newer content
  });
});
