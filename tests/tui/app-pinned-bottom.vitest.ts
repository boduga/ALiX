import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';
import { EventLog } from '../../src/events/event-log.js';
import { computeBottomAnchor } from '../../src/tui/views/scroll-math.js';
import type { ViewRenderContext } from '../../src/tui/views/types.js';
import { RuntimeCollectorImpl } from '../../src/tui/runtime-collector.js';
import { FileProjectionCheckpointStore } from '../../src/tui/runtime/projection-checkpoint-store.js';
import { TimelineBuilder } from '../../src/tui/runtime/timeline-builder.js';
import { IncrementalExecutionTraceBuilder } from '../../src/tui/runtime/execution-trace-builder.js';
import { createProjectionRuntime } from '../../src/tui/runtime/projection-runtime.js';
import * as viewportModule from '../../src/tui/views/bottom-anchored-viewport.js';

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

/**
 * End-to-end variant of `makeApp`: wires a REAL EventLog → RuntimeCollector
 * → TuiApp.runtimeCollectors → paintFullFrame chain (instead of mutating
 * `internal.agentRuntime` directly). Each collector owns its own
 * per-session checkpoint store and projection runtime (sessionId = projection
 * domain). `start()` sets up the 1s poller, so callers must stop both
 * collectors (and the app) in a `finally` block.
 */
async function makeAppWithCollectors() {
  const dir = mkdtempSync(join(tmpdir(), 'alix-pinned-'));
  const log = new EventLog(dir);
  await log.init();
  const snap = {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 },
    daemon: null, approvals: null, runtime: null, sops: null, policy: null,
  };
  const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
  const metrics = { start: () => {}, stop: async () => {} };
  const mkCollector = (sessionId: string) =>
    new RuntimeCollectorImpl({
      eventLog: log,
      checkpointStore: new FileProjectionCheckpointStore(join(dir, 'projections', sessionId)),
      sessionId,
      projectionRuntime: createProjectionRuntime([
        ['timeline', new TimelineBuilder(sessionId)],
        ['trace', new IncrementalExecutionTraceBuilder()],
      ]),
    });
  const agentCollector = mkCollector('sess-agent');
  const chatCollector = mkCollector('sess-chat');
  await agentCollector.start();
  await chatCollector.start();

  const app = new TuiApp({
    builder, daemonMetrics: metrics,
    eventLog: log, chatSessionId: 'sess-chat', agentSessionId: 'sess-agent',
    runtimeCollectors: { chat: chatCollector, agent: agentCollector },
  } as unknown as TuiAppOptions);
  const internal = app as unknown as {
    handleRaw(buf: Buffer): void;
    getStateForTest(): { lastSnapshot: any; activeTab?: string; views: { [k: string]: any } };
    refresh(): Promise<void>;
    setActiveTabForTest(tab: string): void;
  };
  internal.getStateForTest().lastSnapshot = snap;
  return { app, internal, log, agentCollector, chatCollector };
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
    internal.setActiveTabForTest('agent');
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
    internal.setActiveTabForTest('chat');

    internal.handleRaw(ARROW_UP);
    const per = internal.getStateForTest().views.chat;
    expect(per.pinnedBottom).toBe(false);

    internal.handleRaw(END);
    const expected = computeBottomAnchor(
      (app as unknown as { framePainter: { buildViewRenderContext(tab: string): ViewRenderContext } }).framePainter.buildViewRenderContext('chat'),
      'chat',
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
    internal.setActiveTabForTest('dashboard');
    internal.setActiveTabForTest('agent');

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

  it('new content while unpinned: end-to-end rendered slice stays identical', async () => {
    // Stronger than the direct-mutation no-drift test above: wires a real
    // EventLog → RuntimeCollectorImpl → TuiApp.runtimeCollectors →
    // refresh() → paintFullFrame chain, appends new agent.response entries
    // to the log, forces the collector's private sample(), repaints, and
    // asserts the SLICE passed to renderBottomAnchoredSlice is identical
    // over the shared index range (parked window must not move).
    const m = await makeAppWithCollectors();
    app = m.app;
    internal = m.internal;
    const { log, agentCollector } = m;
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      // Seed the agent timeline through the real log → collector projection.
      // Operator entries (user/agent.message) match the plan's seed; the
      // collector projects them the same as any agent.* line.
      for (let i = 0; i < 60; i++) {
        await log.append({ sessionId: 'sess-agent', actor: 'user', type: 'agent.message', payload: { text: `line ${i}` } });
      }
      const sample = (agentCollector as unknown as { sample(): Promise<void> }).sample;
      await sample.call(agentCollector);
      await internal.refresh();

      internal.setActiveTabForTest('agent');
      internal.handleRaw(ARROW_UP); // unpin
      const per = internal.getStateForTest().views.agent;
      expect(per.pinnedBottom).toBe(false);
      const offsetBefore = per.scrollOffset;

      // Capture the slice passed to renderBottomAnchoredSlice during paint.
      spy = vi.spyOn(viewportModule, 'renderBottomAnchoredSlice');
      await internal.refresh(); // repaint now
      const optsBefore = spy.mock.calls.at(-1)?.[0]!;
      const allLinesBefore = optsBefore.allLines as readonly unknown[];
      const offsetArgBefore = optsBefore.offset as number;
      spy.mockClear();

      // Append new content via the log, force sample + refresh (repaint).
      for (let i = 60; i < 65; i++) {
        await log.append({ sessionId: 'sess-agent', actor: 'agent', type: 'agent.response', payload: { text: `new ${i}` } });
      }
      await sample.call(agentCollector);
      await internal.refresh();
      const optsAfter = spy.mock.calls.at(-1)?.[0]!;
      const allLinesAfter = optsAfter.allLines as readonly unknown[];
      const offsetArgAfter = optsAfter.offset as number;

      // Parked window must not move: same offset, rendered slice identical
      // over the shared index range.
      expect(per.scrollOffset).toBe(offsetBefore);
      expect(per.pinnedBottom).toBe(false);
      expect(offsetArgAfter).toBe(offsetArgBefore);
      expect(allLinesAfter.length).toBeGreaterThan(allLinesBefore.length);
      for (let i = 0; i < Math.min(allLinesBefore.length - offsetArgBefore, 30); i++) {
        expect(allLinesAfter[offsetArgAfter + i]).toEqual(allLinesBefore[offsetArgBefore + i]);
      }
    } finally {
      spy?.mockRestore();
      await agentCollector.stop();
      await m.chatCollector.stop();
      await m.app.stop().catch(() => {});
    }
  });

  it('onActivate resets pinnedBottom=true', () => {
    internal.handleRaw(ARROW_UP);
    internal.setActiveTabForTest('dashboard');
    internal.setActiveTabForTest('agent');
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
    internal.setActiveTabForTest('dashboard');
    internal.setActiveTabForTest('agent');

    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(true);
    // Compute the expected baseline the same way `switchTab`/`onActivate` does.
    const expected = computeBottomAnchor(
      (app as unknown as { framePainter: { buildViewRenderContext(tab: string): ViewRenderContext } }).framePainter.buildViewRenderContext('agent'),
      'agent',
    );
    expect(expected).toBeGreaterThan(0);
    expect(per.scrollOffset).toBe(expected);
    expect(per.scrollOffset).not.toBe(0);
  });

  it('chat tab has the same transitions as agent tab', () => {
    internal.setActiveTabForTest('chat');
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
    internal.setActiveTabForTest('dashboard');
    internal.setActiveTabForTest('agent');

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

  // T437 (spec #429 slice 8): operator-initiated submission re-pins the
  // scrollback to bottom so the new prompt and any subsequent agent output
  // are immediately visible. Arriving approvals, tool results, and other
  // system events MUST NOT re-pin — only submission does.
  // The re-pin is a state mutation (offset zeroed to bottomAnchor), NOT a
  // render mutation — the scrollback's append-only property is unchanged.
  it('agent tab Enter while scrolled up re-pins to bottom (T437)', () => {
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
    // Activate so scrollOffset is the bottom anchor baseline.
    internal.setActiveTabForTest('dashboard');
    internal.setActiveTabForTest('agent');

    const per = internal.getStateForTest().views.agent;
    // Scroll-up: explicitly unpin so the next submit has work to do.
    internal.handleRaw(ARROW_UP);
    expect(per.pinnedBottom).toBe(false);
    expect(per.scrollOffset).toBeGreaterThan(0);

    // Submit a prompt.
    for (const c of 'fix it') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // Enter

    // Submit must re-pin: pinnedBottom true, scrollOffset == bottomAnchor.
    expect(per.pinnedBottom).toBe(true);
    const expected = computeBottomAnchor(
      (app as unknown as { framePainter: { buildViewRenderContext(tab: string): ViewRenderContext } }).framePainter.buildViewRenderContext('agent'),
      'agent',
    );
    expect(per.scrollOffset).toBe(expected);
  });

  it('chat tab Enter while scrolled up re-pins to bottom (T437)', () => {
    const seeded: Array<{ id: string; kind: 'chat.response'; sessionId: string; startedAt: number; text: string; sourceEvents: { firstSequence: number } }> = [];
    for (let i = 0; i < 60; i++) {
      seeded.push({
        id: `tl-${i}`,
        kind: 'chat.response',
        sessionId: 'sess-chat',
        startedAt: i,
        text: `seeded chat ${i}`,
        sourceEvents: { firstSequence: i },
      });
    }
    (internal as unknown as { chatRuntime: unknown }).chatRuntime = {
      trace: [], timeline: seeded, workflow: null,
      totalEventCount: seeded.length, lastEventAt: seeded.length, sessionId: 'sess-chat',
    };
    internal.setActiveTabForTest('agent');
    internal.setActiveTabForTest('chat');

    const per = internal.getStateForTest().views.chat;
    internal.handleRaw(ARROW_UP);
    expect(per.pinnedBottom).toBe(false);
    expect(per.scrollOffset).toBeGreaterThan(0);

    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // Enter

    expect(per.pinnedBottom).toBe(true);
    const expected = computeBottomAnchor(
      (app as unknown as { framePainter: { buildViewRenderContext(tab: string): ViewRenderContext } }).framePainter.buildViewRenderContext('chat'),
      'chat',
    );
    expect(per.scrollOffset).toBe(expected);
  });

  it('after submit re-pin, scrolling up preserves the parked window and the next submit re-pins (T437)', () => {
    const seeded: Array<{ id: string; kind: 'agent.response'; sessionId: string; startedAt: number; text: string; sourceEvents: { firstSequence: number } }> = [];
    for (let i = 0; i < 80; i++) {
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
    internal.setActiveTabForTest('dashboard');
    internal.setActiveTabForTest('agent');

    const per = internal.getStateForTest().views.agent;

    // 1. Scroll up (unpin).
    internal.handleRaw(ARROW_UP);
    expect(per.pinnedBottom).toBe(false);
    const offsetAfterScrollUp = per.scrollOffset;
    expect(offsetAfterScrollUp).toBeGreaterThan(0);

    // 2. Submit → re-pin.
    for (const c of 'first') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d]));
    expect(per.pinnedBottom).toBe(true);

    // 3. Scroll up again — the user's position must be preserved (no auto-re-pin on new events).
    internal.handleRaw(ARROW_UP);
    expect(per.pinnedBottom).toBe(false);
    const parkedOffset = per.scrollOffset;
    expect(parkedOffset).toBeGreaterThan(0);

    // 4. Next submit → re-pins again.
    for (const c of 'second') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d]));
    expect(per.pinnedBottom).toBe(true);
    const expected = computeBottomAnchor(
      (app as unknown as { framePainter: { buildViewRenderContext(tab: string): ViewRenderContext } }).framePainter.buildViewRenderContext('agent'),
      'agent',
    );
    expect(per.scrollOffset).toBe(expected);
  });
});

// ─── AC#7 (ticket #436): approve/deny keys keep working from any scroll ─────
// The inline a/d resolver (app.ts) is not gated on scroll position — it shifts
// the oldest pending approval and unshifts a resolved record regardless of
// whether the scrollback is pinned to bottom. This proves the keys act from a
// scrolled-up position too (the #436 diff shipped without this test).
describe('TuiApp approve/deny from scrolled-up position (AC#7)', () => {
  let app: TuiApp;
  let internal: any;

  beforeEach(async () => {
    const m = await makeApp();
    app = m.app;
    internal = m.internal;
    internal.setActiveTabForTest('agent');
  });
  afterEach(async () => { await app.stop().catch(() => {}); });

  const seedPending = () => {
    const per = internal.getStateForTest().views.agent;
    per.pendingApprovals = [{
      id: 'a1',
      toolName: 'write_file',
      target: 'src/x.ts',
      args: {},
      requestedAt: Date.now(),
      requestedBy: 'test',
    }];
  };

  it('approve (a) resolves the oldest pending approval from a scrolled-up position', () => {
    seedPending();
    internal.handleRaw(ARROW_UP); // scrolled away from bottom anchor
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(false);
    expect(per.pendingApprovals).toHaveLength(1);

    internal.handleRaw(Buffer.from('a'));

    expect(per.pendingApprovals).toHaveLength(0);
    expect(per.resolvedApprovals[0]).toMatchObject({ id: 'a1', status: 'approved' });
  });

  it('deny (d) resolves the oldest pending approval from a scrolled-up position', () => {
    seedPending();
    internal.handleRaw(ARROW_UP);
    const per = internal.getStateForTest().views.agent;
    expect(per.pinnedBottom).toBe(false);

    internal.handleRaw(Buffer.from('d'));

    expect(per.pendingApprovals).toHaveLength(0);
    expect(per.resolvedApprovals[0]).toMatchObject({ id: 'a1', status: 'denied' });
  });
});
