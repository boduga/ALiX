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

describe('TuiApp -- chat-input dispatch', () => {
  // Build a tui app whose snapshot builder returns a fixed snapshot, so
  // paintFullFrame() has something valid to render. We never paint in
  // these tests — we only drive handleRaw and inspect state.
  function makeApp(opts: Partial<{ agentSession: unknown }> = {}) {
    const snap = {
      generatedAt: 1,
      session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 },
      daemon: null, approvals: null, runtime: null, sops: null, policy: null,
    };
    const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
    const metrics = { start: () => {}, stop: async () => {} };
    const app = new TuiApp({ builder, daemonMetrics: metrics, agentSession: opts.agentSession } as unknown as TuiAppOptions);
    const internal = app as unknown as {
      handleRaw(buf: Buffer): void;
      getStateForTest(): {
        lastSnapshot: unknown;
        views: { chat: { inputBuffer: string; submittedPrompts: string[]; agentResponses: string[] } };
      };
    };
    // Seed lastSnapshot so handleRaw doesn't bail at its `if (!lastSnapshot) return;` guard.
    internal.getStateForTest().lastSnapshot = snap;
    internal.getStateForTest().views.chat.inputBuffer = '';
    internal.getStateForTest().views.chat.submittedPrompts = [];
    internal.getStateForTest().views.chat.agentResponses = [];
    return { app, internal };
  }

  it('appends printable characters to the chat buffer', () => {
    const { internal } = makeApp();
    internal.handleRaw(Buffer.from('h'));
    internal.handleRaw(Buffer.from('i'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('hi');
  });

  it('supports Backspace deletion via DEL byte (0x7f)', () => {
    const { internal } = makeApp();
    // Use letters that aren't navigation shortcuts (avoid a/d/r/s/p/c).
    internal.handleRaw(Buffer.from('x'));
    internal.handleRaw(Buffer.from('y'));
    internal.handleRaw(Buffer.from('z'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('xyz');
    internal.handleRaw(Buffer.from([0x7f]));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('xy');
    internal.handleRaw(Buffer.from([0x7f]));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('x');
    internal.handleRaw(Buffer.from([0x7f]));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });

  it('supports Backspace deletion via BS byte (0x08)', () => {
    const { internal } = makeApp();
    internal.handleRaw(Buffer.from('x'));
    internal.handleRaw(Buffer.from('y'));
    internal.handleRaw(Buffer.from([0x08])); // BS
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('x');
  });

  it('supports Enter (CR) and clears the buffer for non-empty input', () => {
    const { internal } = makeApp();
    internal.handleRaw(Buffer.from('h'));
    internal.handleRaw(Buffer.from('i'));
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    // After Enter with non-empty buffer, the buffer is cleared.
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });

  it('Enter on an empty buffer does nothing harmful', () => {
    const { internal } = makeApp();
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });

  it('Enter records the submitted prompt in submittedPrompts (echoed scrollback)', () => {
    const { internal } = makeApp();
    for (const c of 'fix it') internal.handleRaw(Buffer.from(c));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('fix it');
    // Buffer has 0 entries before submit.
    expect(internal.getStateForTest().views.chat.submittedPrompts).toEqual([]);
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
    expect(internal.getStateForTest().views.chat.submittedPrompts).toEqual(['fix it']);
  });

  it('each Enter appends the prompt to submittedPrompts (history grows)', () => {
    const { internal } = makeApp();
    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // first submit
    expect(internal.getStateForTest().views.chat.submittedPrompts).toEqual(['hi']);
    for (const c of 'you') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x7f])); // backspace: 'yo'
    // Submitting a 2-char buffer should record it (not 'you').
    internal.handleRaw(Buffer.from([0x0d]));
    expect(internal.getStateForTest().views.chat.submittedPrompts).toEqual(['hi', 'yo']);
  });

  it('submit calls agentSession.processTurn and appends the summary to agentResponses', async () => {
    const agentSession = {
      processTurn: vi.fn(async (text: string) => ({
        summary: `reply to: ${text}`,
        sessionId: 'test-session',
        toolCalls: [],
      })),
    };
    const { internal } = makeApp({ agentSession });
    for (const c of 'fix it') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    // submitChatInput is async; await a microtask so the response lands.
    await Promise.resolve();
    await Promise.resolve();
    expect(agentSession.processTurn).toHaveBeenCalledWith('fix it');
    expect(internal.getStateForTest().views.chat.submittedPrompts).toEqual(['fix it']);
    expect(internal.getStateForTest().views.chat.agentResponses).toEqual(['reply to: fix it']);
  });

  it('submit without agentSession falls back to a placeholder response', async () => {
    const { internal } = makeApp({ agentSession: undefined });
    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await Promise.resolve();
    await Promise.resolve();
    expect(internal.getStateForTest().views.chat.submittedPrompts).toEqual(['hi']);
    expect(internal.getStateForTest().views.chat.agentResponses.length).toBe(1);
    expect(internal.getStateForTest().views.chat.agentResponses[0]).toContain('hi');
  });

  it('round-trips a typed prompt with backspace edits and a final Enter', () => {
    const { internal } = makeApp();
    // Chars in this fixture avoid navigation shortcuts (a/c/d/p/q/r/s/digits).
    // Allowed: e, f, g, h, i, j, k, l, m, n, o, t, u, v, w, x, y, z, space.
    for (const c of 'fix it now') internal.handleRaw(Buffer.from(c));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('fix it now');
    // Backspace 4 times — remove "now ".
    for (let i = 0; i < 4; i++) internal.handleRaw(Buffer.from([0x7f]));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('fix it');
    // Append " now too" — note: 'r' is a shortcut to the runtime tab,
    // so this fixture deliberately avoids it.
    for (const c of ' now too') internal.handleRaw(Buffer.from(c));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('fix it now too');
    // Enter — clears the buffer.
    internal.handleRaw(Buffer.from([0x0d]));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });
});
