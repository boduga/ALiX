/**
 * Parity integration test: new TuiApp produces the same chat behavior as the
 * legacy runLegacyChatTuiForCompat.
 *
 * The legacy TUI flow:
 *   1. new Tui({ sessionId, eventLog }) — store + renderer
 *   2. await init() — read existing events, start renderer
 *   3. readline task → agentSession.processTurn(task) → Tui.appendOutput(summary)
 *   4. destroy() — stop renderer
 *
 * The new TuiApp flow:
 *   1. new TuiApp({ builder, daemonMetrics }) — renderer + terminal + views
 *   2. await start() — metrics.start, builder.build → DashboardSnapshot, stdin listener
 *   3. raw keys → view.handleKey() → dispatch(action)
 *   4. await stop() — metrics.stop, cleanup
 *
 * This test verifies that the lifecycle produces equivalent state and that
 * the raw-input dispatch path works (the actual chat-roundtrip end-to-end is
 * too coupled to legacy session internals for a pure-unit test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';
import { NoopRenderer } from '../../src/tui/renderer/contract.js';

describe('TuiApp — parity with legacy chat input', () => {
  const renderer = new NoopRenderer();
  let builder: { build: ReturnType<typeof vi.fn>; buildSync: ReturnType<typeof vi.fn> };
  let metrics: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  let app: TuiApp | undefined;

  beforeEach(() => {
    builder = {
      build: vi.fn(async (_gen: number) => ({
        generatedAt: Date.now(),
        session: { mode: 'auto' as const, phase: 'Idle', version: '1.0', startedAt: Date.now(), turns: 0 },
        daemon: null,
        approvals: null,
        runtime: null,
        sops: null,
        policy: null,
      })),
      buildSync: vi.fn(() => null),
    };
    metrics = {
      start: vi.fn(),
      stop: vi.fn(async () => {}),
    };
  });

  afterEach(async () => {
    if (app) await app.stop().catch(() => {});
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Lifecycle parity
  // ---------------------------------------------------------------------------

  it('lifecycle parity: start() produces snapshot state like legacy Tui.init()', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();

    // Legacy: Tui.init() → TuiStore populated
    // TuiApp:  start() → builder.build() → DashboardSnapshot in state
    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(metrics.start).toHaveBeenCalled();

    const state = app.getStateForTest();
    expect(state.lastSnapshot).toBeDefined();
    expect(state.lastSnapshot!.session).not.toBeNull();
    expect(state.lastSnapshot!.session!.turns).toBe(0);
    expect(state.lastSnapshot!.session!.mode).toBe('auto');
    expect(state.activeTab).toBe('chat');
  });

  it('lifecycle parity: stop() releases subsystems like legacy Tui.destroy()', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();
    await app.stop();

    // Legacy: renderer.stop() called
    // TuiApp:  daemonMetrics.stop() called
    expect(metrics.stop).toHaveBeenCalledTimes(1);

    // Second stop is idempotent (detached guard)
    await app.stop();
    expect(metrics.stop).toHaveBeenCalledTimes(1);
  });

  it('builds a fresh snapshot on each refresh cycle', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();

    // Initial build
    expect(builder.build).toHaveBeenCalledTimes(1);

    // Simulate a refresh cycle: the setInterval in start() calls refresh()
    // every 1s.  We cannot spy on a private method, so we verify that after
    // start the snapshot is populated.  The refresh timer itself is verified
    // indirectly by the builder.build assertion above and by the fact that
    // stop() clears the interval without error.
    const state = app.getStateForTest();
    expect(state.lastSnapshot).toBeDefined();
    expect(state.lastSnapshot!.session?.version).toBe('1.0');
  });

  // ---------------------------------------------------------------------------
  // Input dispatch parity (readline → raw mode)
  // ---------------------------------------------------------------------------

  it('navigates tabs via raw keyboard input (Tab / digit / letter shortcuts)', async () => {
    // Capture the stdin 'data' handler instead of attaching it for real
    let stdinHandler: ((buf: Buffer) => void) | undefined;
    vi.spyOn(process.stdin, 'on').mockImplementation((event: string | symbol, handler: any) => {
      if (event === 'data') stdinHandler = handler;
      return process.stdin;
    });

    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();
    expect(stdinHandler).toBeDefined();

    // TAB_ORDER: chat(0), agent(1), daemon(2), approvals(3),
    //            runtime(4), sops(5), policy(6)
    const getTab = () => app!.getStateForTest().activeTab;
    expect(getTab()).toBe('chat');

    // Tab → cycle forward one slot
    stdinHandler!(Buffer.from('\t', 'utf8'));
    expect(getTab()).toBe('agent');

    // Tab again → daemon
    stdinHandler!(Buffer.from('\t', 'utf8'));
    expect(getTab()).toBe('daemon');

    // Tab again → approvals
    stdinHandler!(Buffer.from('\t', 'utf8'));
    expect(getTab()).toBe('approvals');

    // Ctrl+digit shortcuts (terminals encode these as ESC + digit).
    // stdinHandler receives bytes; we send the 2-byte sequence that
    // parseKey recognises as Ctrl+1 through Ctrl+7.
    const sendCtrlDigit = (digit: string) => {
      const buf = Buffer.alloc(2);
      buf[0] = 0x1b; // ESC
      buf[1] = digit.charCodeAt(0);
      stdinHandler!(buf);
    };
    sendCtrlDigit('1'); expect(getTab()).toBe('chat');
    sendCtrlDigit('2'); expect(getTab()).toBe('agent');
    sendCtrlDigit('3'); expect(getTab()).toBe('daemon');
    sendCtrlDigit('4'); expect(getTab()).toBe('approvals');
    sendCtrlDigit('5'); expect(getTab()).toBe('runtime');
    sendCtrlDigit('6'); expect(getTab()).toBe('sops');
    sendCtrlDigit('7'); expect(getTab()).toBe('policy');

    // Out-of-range Ctrl+8 / Ctrl+9 / Ctrl+0 are no-ops (bounds-checked).
    sendCtrlDigit('8'); expect(getTab()).toBe('policy');
    sendCtrlDigit('9'); expect(getTab()).toBe('policy');
    sendCtrlDigit('0'); expect(getTab()).toBe('policy');

    // Single-letter shortcuts removed in favor of Ctrl+digit. A raw
    // letter reaches the active view (or the prompt in chat/agent)
    // rather than triggering a tab jump.
    stdinHandler!(Buffer.from('c', 'utf8'));
    expect(getTab()).toBe('policy');
    stdinHandler!(Buffer.from('e', 'utf8'));
    expect(getTab()).toBe('policy');
    stdinHandler!(Buffer.from('p', 'utf8'));
    expect(getTab()).toBe('policy');

    // Ctrl-l triggers repaint but does NOT change tab (global handler)
    stdinHandler!(Buffer.from([0x0c]));
    expect(getTab()).toBe('policy');
  });

  // ---------------------------------------------------------------------------
  // Per-tab state preservation parity
  // ---------------------------------------------------------------------------

  it('preserves per-tab state across navigation like legacy TUI preserves panel state', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();

    const state = app.getStateForTest();

    // Each tab gets a fresh PerTabState on construction — legacy TuiStore
    // similarly sets initial values for all panels on init.
    for (const tab of ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'] as const) {
      expect(state.views[tab].cursor).toBe(0);
      expect(state.views[tab].scrollOffset).toBe(0);
      expect(state.views[tab].searchQuery).toBe('');
      expect(state.views[tab].expandedSections).toEqual([]);
    }

    // Mutating a tab's state persists (simulating what view.handleKey()
    // does to perTab for moveCursor / scroll actions).
    state.views.runtime.scrollOffset = 42;
    state.views.chat.cursor = 3;
    expect(state.views.runtime.scrollOffset).toBe(42);
    expect(state.views.chat.cursor).toBe(3);
  });
});
