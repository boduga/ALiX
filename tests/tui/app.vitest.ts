import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';
import { KeyDispatcher } from '../../src/tui/key-dispatcher.js';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../src/tui/capabilities/capability-service.js';
import type { InvocationPresenter } from '../../src/tui/capabilities/invocation-presenter.js';
import type { PerTabState } from '../../src/tui/state.js';
import { EventLog } from '../../src/events/event-log.js';

/** Deterministic flush of a fire-and-forget EventLog append: the log notifies
 *  watchers AFTER appendFile resolves, so awaiting `count` watch notifications
 *  guarantees the entries are on disk before readAll. */
async function flushedAfter(log: EventLog, count: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let seen = 0;
    log.watch(() => { if (++seen >= count) resolve(); });
  });
}

/** Project the log's text-bearing events of `type` onto their text — the
 *  single source of truth timeline (the per-tab cache is gone, Phase 6). */
async function timelineTexts(log: EventLog, type: 'chat.message' | 'chat.response' | 'agent.message' | 'agent.response'): Promise<string[]> {
  const events = await log.readAll();
  return events.filter((e) => e.type === type).map((e) => (e.payload as { text?: string }).text ?? '');
}

// Build a tui app wired to a real EventLog + sub-session ids, so the
// submitted prompt/response land in the log — the timeline's single source
// of truth. We never paint in these tests — we drive handleRaw and inspect
// the emitted log entries.
async function makeApp(opts: Partial<{ agentSession: unknown }> = {}) {
  const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-app-input-')));
  await log.init();
  const snap = {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 },
    daemon: null, approvals: null, runtime: null, sops: null, policy: null,
  };
  const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
  const metrics = { start: () => {}, stop: async () => {} };
  const app = new TuiApp({
    builder, daemonMetrics: metrics, agentSession: opts.agentSession,
    eventLog: log, chatSessionId: 'sess-chat', agentSessionId: 'sess-agent',
  } as unknown as TuiAppOptions);
  const internal = app as unknown as {
    handleRaw(buf: Buffer): void;
    getStateForTest(): {
      lastSnapshot: unknown;
      activeTab?: string;
      views: { chat: { inputBuffer: string }; agent: { inputBuffer: string } };
    };
    recorded?: any;
    slashManifestsForTest?: unknown[];
    slashHintForTest?: string | null;
    slashSelectionForTest?: number;
  };
  // Seed lastSnapshot so handleRaw doesn't bail at its `if (!lastSnapshot) return;` guard.
  internal.getStateForTest().lastSnapshot = snap;
  // Switch to chat tab — the default is now 'dashboard', but these
  // tests specifically exercise the chat input path.
  internal.getStateForTest().activeTab = 'chat';
  internal.getStateForTest().views.chat.inputBuffer = '';
  return { app, internal, log };
}

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

  it('refresh() re-reads the slash manifest catalog (CLI-side invalidation visibility)', async () => {
    // Regression: a TUI running while the operator installs a skill in a
    // separate process must pick up the new skill within ~1s. The wired
    // call is `refreshSlashCatalog()`, which is a Promise wrapper over
    // `getSlashCatalog()` (generation-based cache). Steal the getter from
    // the TuiApp instance, call it directly, and assert the in-memory
    // mirror updates.
    const { setSlashCatalogLoaderForTest } = await import('../../src/skills/slash-catalog.js');
    let installed: any[] = [];
    setSlashCatalogLoaderForTest(async () => installed);
    try {
      app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
      await app.start();
      // Initial catalog read returns the empty install list.
      const internal = app as unknown as { slashManifests: any[]; refreshSlashCatalog(): Promise<void> };
      await internal.refreshSlashCatalog();
      expect(internal.slashManifests).toEqual([]);

      // CLI-side install: invalidate the cache and bump the loader.
      installed = [{ name: 'newskill', description: 'NEW', trigger: '/newskill', version: '1.0.0', is_core: false }];
      const { invalidateSlashCatalog } = await import('../../src/skills/slash-catalog.js');
      invalidateSlashCatalog();

      // The fix: refresh() (the snapshot tick) calls refreshSlashCatalog,
      // so a subsequent tick picks up the new catalog without restart.
      await internal.refreshSlashCatalog();
      expect(internal.slashManifests.length).toBe(1);
      expect(internal.slashManifests[0].name).toBe('newskill');
    } finally {
      setSlashCatalogLoaderForTest(null);
      if (app) await app.stop().catch(() => {});
    }
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

  it('appends printable characters to the chat buffer', async () => {
    const { internal } = await makeApp();
    internal.handleRaw(Buffer.from('h'));
    internal.handleRaw(Buffer.from('i'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('hi');
  });

  it('supports Backspace deletion via DEL byte (0x7f)', async () => {
    const { internal } = await makeApp();
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

  it('supports Backspace deletion via BS byte (0x08)', async () => {
    const { internal } = await makeApp();
    internal.handleRaw(Buffer.from('x'));
    internal.handleRaw(Buffer.from('y'));
    internal.handleRaw(Buffer.from([0x08])); // BS
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('x');
  });

  it('supports Enter (CR) and clears the buffer for non-empty input', async () => {
    const { internal } = await makeApp();
    internal.handleRaw(Buffer.from('h'));
    internal.handleRaw(Buffer.from('i'));
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    // After Enter with non-empty buffer, the buffer is cleared.
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });

  it('Enter on an empty buffer does nothing harmful', async () => {
    const { internal } = await makeApp();
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });

  it('Enter records the submitted prompt in the timeline (echoed scrollback)', async () => {
    const { internal, log } = await makeApp();
    for (const c of 'fix it') internal.handleRaw(Buffer.from(c));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('fix it');
    // Log has 0 chat.message entries before submit.
    expect(await timelineTexts(log, 'chat.message')).toEqual([]);
    const flushed = flushedAfter(log, 1);
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await flushed;
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
    expect(await timelineTexts(log, 'chat.message')).toEqual(['fix it']);
  });

  it('each Enter appends the prompt to the timeline (history grows)', async () => {
    const { internal, log } = await makeApp();
    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    const flushed = flushedAfter(log, 1);
    internal.handleRaw(Buffer.from([0x0d])); // first submit
    await flushed;
    expect(await timelineTexts(log, 'chat.message')).toEqual(['hi']);
    for (const c of 'you') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x7f])); // backspace: 'yo'
    // Submitting a 2-char buffer should record it (not 'you').
    const flushed2 = flushedAfter(log, 1);
    internal.handleRaw(Buffer.from([0x0d]));
    await flushed2;
    expect(await timelineTexts(log, 'chat.message')).toEqual(['hi', 'yo']);
  });

  it('submit calls agentSession.processChat and appends the summary to the timeline', async () => {
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
    const { internal, log } = await makeApp({ agentSession });
    for (const c of 'fix it') internal.handleRaw(Buffer.from(c));
    const flushed = flushedAfter(log, 2);
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await flushed;
    expect(agentSession.processChat).toHaveBeenCalledWith('fix it');
    expect(agentSession.processTurn).not.toHaveBeenCalled();
    expect(await timelineTexts(log, 'chat.message')).toEqual(['fix it']);
    expect(await timelineTexts(log, 'chat.response')).toEqual(['reply to: fix it']);
  });

  it('submit without agentSession falls back to a placeholder response', async () => {
    const { internal, log } = await makeApp({ agentSession: undefined });
    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    const flushed = flushedAfter(log, 2);
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await flushed;
    expect(await timelineTexts(log, 'chat.message')).toEqual(['hi']);
    const responses = await timelineTexts(log, 'chat.response');
    expect(responses.length).toBe(1);
    expect(responses[0]).toContain('hi');
  });

  it('agent tab Enter calls processTurn (not processChat) and routes to the agent timeline', async () => {
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
    const { internal, log } = await makeApp({ agentSession });
    // Switch to the agent tab.
    const state = internal.getStateForTest() as unknown as { activeTab: string };
    state.activeTab = 'agent';
    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    const flushed = flushedAfter(log, 2);
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await flushed;
    // Agent tab routes chat-first so casual queries don't enter the
    // workflow loop. processTurn stays a fallback when processChat is
    // unavailable or returns an unhelpful answer. The agent tab's own
    // conversation emits `agent.*` kinds (prompt → agent.message,
    // summary → agent.response) so the agent view renders it.
    expect(processTurn).toHaveBeenCalledWith('hi');
    expect(processChat).not.toHaveBeenCalled();
    expect(await timelineTexts(log, 'agent.message')).toEqual(['hi']);
    expect(await timelineTexts(log, 'agent.response')).toEqual(['[agent] hi']);
  });

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
    const { internal } = await makeApp({ agentSession });
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
      const { internal, log } = await makeApp({ agentSession });
      for (const c of 'hi') internal.handleRaw(Buffer.from(c));
      const flushed = flushedAfter(log, 2);
      internal.handleRaw(Buffer.from([0x0d])); // Enter
      await flushed;
      const responses = await timelineTexts(log, 'chat.response');
      expect(responses[0]).toContain('agent error');
      expect(responses[0]).toContain('boom');
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
        const { internal, log } = await makeApp({ agentSession });
        for (const c of 'hi') internal.handleRaw(Buffer.from(c));
        const flushed = flushedAfter(log, 2);
        internal.handleRaw(Buffer.from([0x0d])); // Enter
        await flushed;
        const responses = await timelineTexts(log, 'chat.response');
        expect(responses[0]).toMatch(/timed out|agent error/);
      } finally {
        globalThis.setTimeout = origSetTimeout;
      }
    } finally {
      errSpy.mockRestore();
    }
  });

  it('round-trips a typed prompt with backspace edits and a final Enter', async () => {
    const { internal } = await makeApp();
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
    // Switch to chat tab — the default is now 'dashboard', but these
    // tests exercise the chat input path.
    (internal.getStateForTest() as any).activeTab = 'chat';
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
        activeTab?: string;
        views: { chat: PerTabState };
      };
    };
    internal.getStateForTest().lastSnapshot = snap;
    // Switch to chat tab — the default is now 'dashboard', but these
    // tests exercise the chat input path.
    internal.getStateForTest().activeTab = 'chat';
    return { app, internal };
  }

  it('Alt+C with content copies OSC 52 sequence to stdout', () => {
    const { internal } = makeCopyApp();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Seed the chat sub-session's log projection — the single source of truth
    // timeline the copy reads (the per-tab cache is gone).
    (internal as any).chatRuntime = {
      trace: [],
      timeline: [{ id: 'tl-1', kind: 'chat.response', sessionId: 'sess-chat', startedAt: 1, text: 'test response', sourceEvents: { firstSequence: 1 } }],
      workflow: null, totalEventCount: 1, lastEventAt: 1, sessionId: 'sess-chat',
    };
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

  it('copies operator timeline (prompts, responses, capabilities)', () => {
    const { internal } = makeCopyApp();
    // Capability completions land in the log projection as chat.response
    // entries carrying their status text (see ChatInvocationPresenter).
    (internal as any).chatRuntime = {
      trace: [],
      timeline: [
        { id: 'tl-1', kind: 'chat.message', sessionId: 'sess-chat', startedAt: 1, text: 'q1', sourceEvents: { firstSequence: 1 } },
        { id: 'tl-2', kind: 'chat.message', sessionId: 'sess-chat', startedAt: 2, text: 'q2', sourceEvents: { firstSequence: 2 } },
        { id: 'tl-3', kind: 'chat.response', sessionId: 'sess-chat', startedAt: 3, text: 'a1', sourceEvents: { firstSequence: 3 } },
        { id: 'tl-4', kind: 'chat.response', sessionId: 'sess-chat', startedAt: 4, text: 'a2', sourceEvents: { firstSequence: 4 } },
        { id: 'tl-5', kind: 'chat.response', sessionId: 'sess-chat', startedAt: 5, text: 'core.session.list [completed ✓]', sourceEvents: { firstSequence: 5 } },
      ],
      workflow: null, totalEventCount: 5, lastEventAt: 5, sessionId: 'sess-chat',
    };
    const text = (internal as any).collectVisibleTranscript('chat');
    expect(text).toContain('→ q1');
    expect(text).toContain('← a1');
    expect(text).toContain('← a2');
    // Capability completion renders as a chat.response (←) entry, matching ChatView.
    expect(text).toContain('← core.session.list [completed ✓]');
  });
});

describe('TuiApp -- pluggable key dispatcher', () => {
  function makeDispatcherApp() {
    const snap = { generatedAt: 1, session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null };
    const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
    const metrics = { start: () => {}, stop: async () => {} };
    const dispatcher = new KeyDispatcher();
    const app = new TuiApp({ builder, daemonMetrics: metrics, keyDispatcher: dispatcher } as unknown as TuiAppOptions);
    const internal = app as unknown as {
      handleRaw(buf: Buffer): void;
      getStateForTest(): { lastSnapshot: unknown };
    };
    internal.getStateForTest().lastSnapshot = snap;
    return { app, internal, dispatcher };
  }

  it('dispatches to a registered keybinding and the handler can consume the key', () => {
    const { internal, dispatcher } = makeDispatcherApp();
    let consumed = false;
    dispatcher.on('Enter', () => { consumed = true; return true; });
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    expect(consumed).toBe(true);
  });

  it('non-consumed key falls through to default dispatch', () => {
    const { internal, dispatcher } = makeDispatcherApp();
    let saw = false;
    dispatcher.on('x', () => { saw = true; return false; });
    // 'x' should not crash even though it wasn't consumed
    expect(() => internal.handleRaw(Buffer.from('x'))).not.toThrow();
    expect(saw).toBe(true);
  });
});

describe('TuiApp — palette-open Ctrl+C quit', () => {
  it("Ctrl+C ('\\x03') while the palette is open reaches handlePaletteKey and calls the quit path", () => {
    // Opening the palette (Ctrl+P) calls PaletteModal.refresh →
    // CapabilityProvider.search → getCapabilityService(), which throws when
    // the module accessor is unset. A real service must be registered
    // module-wide (same pattern as tests/tui/capabilities/palette.vitest.ts).
    clearCapabilityService();
    const presenter: InvocationPresenter = { present: vi.fn(async () => {}) };
    const svc = new CapabilityService(presenter);
    setCapabilityService(svc);
    try {
      const snap = { generatedAt: 1, session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null };
      const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
      const metrics = { start: () => {}, stop: async () => {} };
      const app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
      const internal = app as unknown as {
        handleRaw(buf: Buffer): void;
        handlePaletteKey(key: string): void;
        getStateForTest(): { lastSnapshot: unknown };
      };
      internal.getStateForTest().lastSnapshot = snap;
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: string | number | null) => never);
      const paletteSpy = vi.spyOn(internal, 'handlePaletteKey');
      try {
        // Open the palette (Ctrl+P = 0x10) — the modal then owns every key.
        internal.handleRaw(Buffer.from([0x10]));
        // Ctrl+C (ETX = 0x03) while the palette is open must quit, not fall
        // through to the text-append branch and pollute the search query.
        internal.handleRaw(Buffer.from([0x03]));
        expect(paletteSpy).toHaveBeenCalledWith('\x03');
        expect(exitSpy).toHaveBeenCalledWith(0);
      } finally {
        paletteSpy.mockRestore();
        exitSpy.mockRestore();
      }
    } finally {
      clearCapabilityService();
    }
  });
});

describe('TuiApp -- slash commands (agent tab only)', () => {
  async function makeAgentApp(opts: Partial<{ agentSession: unknown }> = {}) {
    const { internal } = await makeApp(opts);
    internal.getStateForTest().activeTab = 'agent';
    internal.getStateForTest().views.agent.inputBuffer = '';
    return { internal };
  }

  it('does not enter slash mode for a bare "/" on the agent tab', async () => {
    const { internal } = await makeAgentApp();
    internal.handleRaw(Buffer.from('/'));
    internal.handleRaw(Buffer.from('\r'));
    // length-1 buffer is not slash mode → normal submit path, no skill
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('');
  });

  it('submits the rest of a slash command with the skill name', async () => {
    const { internal } = await makeAgentApp({
      agentSession: {
        processTurn: async (text: string, options?: { skills?: string[] }) => {
          internal.recorded = { text, skills: options?.skills };
          return { summary: `did ${text}`, sessionId: 's', toolCalls: [], streamed: false, reason: 'agent' };
        },
      },
    });
    internal.slashManifestsForTest = [{ name: 'tdd', description: 'TDD', trigger: '/tdd', version: '1.0.0', is_core: false }];
    for (const ch of '/tdd fix parser') internal.handleRaw(Buffer.from(ch));
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.recorded.text).toBe('fix parser');
    expect(internal.recorded.skills).toEqual(['tdd']);
  });

  it('keeps the buffer and shows a hint for an unknown command', async () => {
    const { internal } = await makeAgentApp({
      agentSession: {
        processTurn: async () => { internal.recorded = true; return { summary: 'x', sessionId: 's', toolCalls: [], streamed: false, reason: 'agent' }; },
      },
    });
    internal.slashManifestsForTest = [{ name: 'tdd', description: 'TDD', trigger: '/tdd', version: '1.0.0', is_core: false }];
    for (const ch of '/nope hi') internal.handleRaw(Buffer.from(ch));
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.recorded).toBeUndefined();
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('/nope hi');
    expect(internal.slashHintForTest).toBeTruthy();
  });

  it('Tab cycles the strip selection without modifying the buffer', async () => {
    const { internal } = await makeAgentApp();
    internal.slashManifestsForTest = [
      { name: 'a', description: 'A', trigger: '/ty', version: '1.0.0', is_core: false },
      { name: 'b', description: 'B', trigger: '/typing', version: '1.0.0', is_core: false },
    ];
    // Plan amendment (2026-08-04, applies Task-4 ruling): handleRaw calls
    // parseKey(buf) once per buffer, and parseKey returns null for any
    // multi-char string (only single bytes + control sequences are keys).
    // Buffer.from('/ty') is a 3-byte buffer → parseKey returns null →
    // handleRaw bails before slash mode runs. The brief's literal test
    // could never reach the Tab assertions. Feed each char separately,
    // matching the other tests' pattern.
    for (const ch of '/ty') internal.handleRaw(Buffer.from(ch));
    internal.handleRaw(Buffer.from('\t'));
    expect(internal.slashSelectionForTest).toBe(1);
    internal.handleRaw(Buffer.from('\t'));
    expect(internal.slashSelectionForTest).toBe(0);
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('/ty');
  });

  it('does NOT activate slash commands on the chat tab', async () => {
    // Chat tab: '/tdd fix parser' submits as plain text — no skill resolution.
    const { internal } = await makeApp({
      agentSession: {
        processChat: async (text: string) => {
          internal.recorded = text;
          return { summary: `did ${text}`, sessionId: 's', toolCalls: [], streamed: false, reason: 'chat' };
        },
      },
    });
    internal.slashManifestsForTest = [{ name: 'tdd', description: 'TDD', trigger: '/tdd', version: '1.0.0', is_core: false }];
    for (const ch of '/tdd fix parser') internal.handleRaw(Buffer.from(ch));
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.recorded).toBe('/tdd fix parser'); // plain text, no skill
  });

  it('clears a stale unknown-command hint when the buffer now matches', async () => {
    // Regression: a sticky slashHint hid the candidate strip until submit/restart.
    // Repro: type `/nope`, Enter (hint shows), then backspace to `/` and type a
    // valid skill — the candidate strip must reappear.
    const { internal } = await makeAgentApp({
      agentSession: {
        processTurn: async () => ({ summary: 'x', sessionId: 's', toolCalls: [], streamed: false, reason: 'agent' }),
      },
    });
    internal.slashManifestsForTest = [{ name: 'tdd', description: 'TDD', trigger: '/tdd', version: '1.0.0', is_core: false }];
    // First: unknown command → hint set.
    for (const ch of '/nope') internal.handleRaw(Buffer.from(ch));
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.slashHintForTest).toBeTruthy();
    // Backspace the full command to `/`, then type `/tdd`.
    // "/nope" is 5 chars; backspace 4 times removes "nope" leaving "/".
    for (let i = 0; i < 4; i++) internal.handleRaw(Buffer.from([0x7f]));
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('/');
    for (const ch of 'tdd') internal.handleRaw(Buffer.from(ch));
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('/tdd');
    // The fix: candidate strip must reappear, hint must clear.
    expect(internal.slashHintForTest).toBeNull();
    const s = (internal as any).computeSlashStrip();
    expect(s.hint).toBeNull();
    expect(s.entries.length).toBeGreaterThan(0);
  });
});

describe('TuiApp — emit into the EventLog (Phase 6)', () => {
  async function makeEmitApp() {
    const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-app-')));
    await log.init();
    const snap = { generatedAt: 1, session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null };
    const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
    const metrics = { start: () => {}, stop: async () => {} };
    const agentSession = {
      processChat: vi.fn(async (text: string) => ({ summary: `reply to: ${text}`, sessionId: 'test-session', toolCalls: [] })),
      processTurn: vi.fn(async (text: string) => ({ summary: `[agent] ${text}`, sessionId: 'test-session', toolCalls: [], reason: 'agent' })),
    };
    const app = new TuiApp({
      builder, daemonMetrics: metrics, agentSession,
      eventLog: log, chatSessionId: 'sess-chat', agentSessionId: 'sess-agent',
    } as unknown as TuiAppOptions);
    const internal = app as unknown as {
      handleRaw(buf: Buffer): void;
      getStateForTest(): {
        lastSnapshot: unknown;
        activeTab: string;
        views: { chat: { inputBuffer: string }; agent: { inputBuffer: string } };
      };
    };
    internal.getStateForTest().lastSnapshot = snap;
    internal.getStateForTest().activeTab = 'chat';
    return { app, internal, log };
  }

  it('chat submit emits chat.message (user) and chat.response (agent) with the chat sub-session id', async () => {
    const { internal, log } = await makeEmitApp();
    const flushed = flushedAfter(log, 2);
    for (const c of 'fix it') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['chat.message', 'chat.response']);
    for (const e of events) expect(e.sessionId).toBe('sess-chat');
  });

  it('agent submit emits agent.message (user) and agent.response (agent) with the agent sub-session id', async () => {
    const { internal, log } = await makeEmitApp();
    (internal.getStateForTest() as { activeTab: string }).activeTab = 'agent';
    const flushed = flushedAfter(log, 2);
    for (const c of 'hi') internal.handleRaw(Buffer.from(c));
    internal.handleRaw(Buffer.from([0x0d])); // Enter
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['agent.message', 'agent.response']);
    for (const e of events) expect(e.sessionId).toBe('sess-agent');
  });
});
