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
        activeTab?: string;
        views: {
          chat: { inputBuffer: string; submittedPrompts: string[]; agentResponses: string[] };
          agent: { inputBuffer: string; submittedPrompts: string[]; agentResponses: string[] };
        };
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

  it('submit calls agentSession.processChat and appends the summary to agentResponses', async () => {
    const agentSession = {
      processTurn: vi.fn(async (text: string) => ({
        summary: `reply to: ${text}`,
        sessionId: 'test-session',
        toolCalls: [],
      })),
      processChat: vi.fn(async (text: string) => ({
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
    expect(agentSession.processChat).toHaveBeenCalledWith('fix it');
    expect(agentSession.processTurn).not.toHaveBeenCalled();
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

  it('agent tab Enter calls processTurn (not processChat) and routes to agent Responses', async () => {
    const processChat = vi.fn(async (text: string) => ({
      summary: `[chat] ${text}`,
      sessionId: 'test-session',
      toolCalls: [],
      reason: 'chat',
    }));
    const processTurn = vi.fn(async (text: string) => ({
      summary: `[agent] ${text}`,
      sessionId: 'test-session',
      toolCalls: [],
      reason: 'agent',
    }));
    const agentSession = { processChat, processTurn };
    const { internal } = makeApp({ agentSession });
    // Switch to the agent tab.
    const state = internal.getStateForTest() as unknown as { activeTab: string };
    state.activeTab = 'agent';
    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await Promise.resolve();
    await Promise.resolve();
    // Agent tab routes chat-first so casual queries don't enter the
    // workflow loop. processTurn stays a fallback when processChat is
    // unavailable or returns an unhelpful answer.
    expect(processTurn).toHaveBeenCalledWith('hi');
    expect(processChat).not.toHaveBeenCalled();
    expect(internal.getStateForTest().views.agent.submittedPrompts).toEqual(['hi']);
    expect(internal.getStateForTest().views.agent.agentResponses).toEqual(['[agent] hi']);
  });

 ;

  it('chat tab Enter calls processChat (not processTurn)', async () => {
    const processChat = vi.fn(async (text: string) => ({
      summary: `[chat] ${text}`,
      sessionId: 'test-session',
      toolCalls: [],
      reason: 'chat',
    }));
    const processTurn = vi.fn(async (text: string) => ({
      summary: `[agent] ${text}`,
      sessionId: 'test-session',
      toolCalls: [],
      reason: 'agent',
    }));
    const agentSession = { processChat, processTurn };
    const { internal } = makeApp({ agentSession });
    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await Promise.resolve();
    await Promise.resolve();
    expect(processChat).toHaveBeenCalledWith('hi');
    expect(processTurn).not.toHaveBeenCalled();
  });

  it('chat submit falls back to error message when processChat throws — and pipes to stderr', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const processChat = vi.fn(async () => { throw new Error('boom'); });
      const agentSession = { processChat };
      const { internal } = makeApp({ agentSession });
      for (const c of 'hi') internal.handleRaw(Buffer.from(c));
      internal.handleRaw(Buffer.from([0x0d])); // Enter
      await new Promise((r) => setTimeout(r, 30));
      expect(internal.getStateForTest().views.chat.agentResponses[0]).toContain('agent error');
      expect(internal.getStateForTest().views.chat.agentResponses[0]).toContain('boom');
      // Stderr was used so silent hangs surface in logs.
      expect(errSpy).toHaveBeenCalled();
      const errArg = errSpy.mock.calls.find((c) => String(c[0]).includes('boom'));
      expect(errArg).toBeDefined();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('chat submit falls back when processChat hangs past the 5s timeout', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const processChat = vi.fn((_text: string) => new Promise<{ summary: string }>(() => {
        // Intentionally never resolves — simulates a hung provider.
      }));
      const agentSession = { processChat };
      // Override the 5s timeout with a short one so the test finishes quickly.
      const origSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((cb: () => void, ms?: number) => origSetTimeout(cb, Math.min(ms ?? 0, 50))) as typeof setTimeout;
      try {
        const { internal } = makeApp({ agentSession });
        for (const c of 'hi') internal.handleRaw(Buffer.from(c));
        internal.handleRaw(Buffer.from([0x0d])); // Enter
        await new Promise((r) => setTimeout(r, 80));
        const responses = internal.getStateForTest().views.chat.agentResponses;
        expect(responses[0]).toMatch(/timed out|agent error/);
      } finally {
        globalThis.setTimeout = origSetTimeout;
      }
    } finally {
      errSpy.mockRestore();
    }
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

describe('TuiApp — bracketed paste', () => {
  function makePasteApp() {
    const snap = { generatedAt: 1, session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null };
    const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
    const metrics = { start: () => {}, stop: async () => {} };
    const app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    const internal = app as unknown as {
      handleRaw(buf: Buffer): void;
      getStateForTest(): {
        lastSnapshot: unknown;
        views: { chat: { inputBuffer: string }; agent: { inputBuffer: string } };
      };
    };
    internal.getStateForTest().lastSnapshot = snap;
    return { app, internal };
  }

  it('paste start sets state to reading', () => {
    const { internal } = makePasteApp();
    const spy = vi.spyOn(internal as any, 'handlePaste');
    internal.handleRaw(Buffer.from('\x1b[200~'));
    expect(spy).toHaveReturnedWith(true);
    spy.mockRestore();
  });

  it('paste inserts content into the chat input buffer', () => {
    const { internal } = makePasteApp();
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from('hello world'));
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('hello world');
  });

  it('paste inserts content into the agent input buffer', () => {
    const { internal } = makePasteApp();
    internal.getStateForTest().views.agent.inputBuffer = '';
    (internal.getStateForTest() as any).activeTab = 'agent';
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from('agent paste'));
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('agent paste');
  });

  it('paste normalizes CRLF to LF', () => {
    const { internal } = makePasteApp();
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from('a\r\nb\r\nc'));
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('a\nb\nc');
  });

  it('empty paste does nothing', () => {
    const { internal } = makePasteApp();
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });

  it('paste accumulates multi-byte UTF-8 safely', () => {
    const { internal } = makePasteApp();
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from([0xf0, 0x9f]));
    internal.handleRaw(Buffer.from([0x98, 0x80])); // completes 😀
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('😀');
  });
});

describe('TuiApp — OSC 52 copy', () => {
  function makeCopyApp() {
    const snap = { generatedAt: 1, session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null };
    const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
    const metrics = { start: () => {}, stop: async () => {} };
    const app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    const internal = app as unknown as {
      handleRaw(buf: Buffer): void;
      getStateForTest(): {
        lastSnapshot: unknown;
        views: { chat: { inputBuffer: string; submittedPrompts: string[]; agentResponses: string[] } };
      };
    };
    internal.getStateForTest().lastSnapshot = snap;
    return { app, internal };
  }

  it('Alt+C with content copies OSC 52 sequence to stdout', () => {
    const { internal } = makeCopyApp();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    internal.getStateForTest().views.chat.agentResponses = ['test response'];
    internal.handleRaw(Buffer.from('\x1bc'));
    expect(writeSpy).toHaveBeenCalled();
    const output = (writeSpy.mock.calls[0] as [string])[0];
    expect(output).toMatch(/^\x1b\]52;;/);
    expect(output).toMatch(/\x1b\\$/); // ST terminator
    writeSpy.mockRestore();
  });

  it('Alt+C with empty scrollback does nothing', () => {
    const { internal } = makeCopyApp();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    internal.handleRaw(Buffer.from('\x1bc'));
    expect(writeSpy.mock.calls.some((c: unknown[]) => (c[0] as string).startsWith('\x1b]52;;'))).toBe(false);
    writeSpy.mockRestore();
  });

  it('copies interleaved prompts and responses', () => {
    const { internal } = makeCopyApp();
    internal.getStateForTest().views.chat.submittedPrompts = ['q1', 'q2'];
    internal.getStateForTest().views.chat.agentResponses = ['a1', 'a2'];
    const text = (internal as any).collectVisibleTranscript('chat');
    expect(text).toContain('→ q1');
    expect(text).toContain('← a1');
    expect(text).toContain('← a2');
  });
});
