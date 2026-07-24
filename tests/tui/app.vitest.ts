import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';
import { NoopRenderer } from '../../src/tui/renderer/contract.js';
import type { RendererEvent } from '../../src/tui/renderer/types.js';

const renderer = new NoopRenderer();

describe('TuiApp -- lifecycle', () => {
  let builder: { build: ReturnType<typeof vi.fn>; buildSync: ReturnType<typeof vi.fn> };
  let metrics: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  let app: TuiApp | undefined;

  beforeEach(() => {
    builder = { build: vi.fn(async () => null), buildSync: vi.fn(() => null) };
    metrics = { start: vi.fn(() => {}), stop: vi.fn(async () => {}) };
  });
  afterEach(async () => { if (app) await app.stop().catch(() => {}); });

  it('start() invokes renderer.initialize', async () => {
    const spy = vi.spyOn(renderer, 'initialize');
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();
    expect(spy).toHaveBeenCalled();
    await app.stop();
  });

  it('resize routes through renderer', async () => {
    const spy = vi.spyOn(renderer, 'resize');
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();
    process.stdout.emit('resize');
    expect(spy).toHaveBeenCalled();
    await app.stop();
  });

  it('stop() invokes renderer.shutdown', async () => {
    const spy = vi.spyOn(renderer, 'shutdown');
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();
    await app.stop();
    expect(spy).toHaveBeenCalled();
  });
});

describe('TuiApp -- tab-state preservation', () => {
  let app: TuiApp | undefined;
  const builder = {
    build: vi.fn(async () => null),
    buildSync: vi.fn(() => null),
  };
  const metrics = { start: () => {}, stop: async () => {} };

  afterEach(async () => { if (app) await app.stop().catch(() => {}); });

  it('preserves runtime.scrollOffset across tab switches', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics, renderer } as unknown as TuiAppOptions);
    await app.start();
    const state = app.getStateForTest() as unknown as {
      views: { runtime: { scrollOffset: number }; chat: { cursor: number } };
    };
    state.views.runtime.scrollOffset = 42;
    state.views.chat.cursor = 3;
    expect(state.views.runtime.scrollOffset).toBe(42);
    expect(state.views.chat.cursor).toBe(3);
    await app.stop();
  });
});

// ---------------------------------------------------------------------------
// Renderer-event driven tests
//
// The TuiApp no longer reads raw stdin. The renderer (Blessed) owns the
// textarea and emits a RendererEvent for every state change; the app
// dispatches those events into handleRenderSubmit, mirrors inputBuffer,
// and resolves approvals. These tests drive that contract end-to-end.
// ---------------------------------------------------------------------------

function emitEvent(app: TuiApp, event: RendererEvent): void {
  const r = (app as unknown as { renderer: { onEvent?: (e: RendererEvent) => void } }).renderer;
  if (!r.onEvent) throw new Error('renderer.onEvent not wired — did you forget to await start()?');
  r.onEvent(event);
}

describe('TuiApp -- renderer event dispatch', () => {
  let builder: { build: ReturnType<typeof vi.fn>; buildSync: ReturnType<typeof vi.fn> };
  let metrics: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  let app: TuiApp | undefined;

  const snap = {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 },
    daemon: null,
    approvals: null,
    runtime: null,
    sops: null,
    policy: null,
  };

  beforeEach(() => {
    builder = {
      build: vi.fn(async () => snap),
      buildSync: vi.fn(() => snap),
    };
    metrics = { start: vi.fn(() => {}), stop: vi.fn(async () => {}) };
  });
  afterEach(async () => { if (app) await app.stop().catch(() => {}); });

  function makeApp(opts: Partial<{ agentSession: unknown }> = {}): TuiApp {
    const a = new TuiApp({
      builder,
      daemonMetrics: metrics,
      agentSession: opts.agentSession,
      renderer,
    } as unknown as TuiAppOptions);
    return a;
  }

  // -- inputChanged mirrors the renderer's textarea buffer ------------------

  it('inputChanged event writes value into state.views[activeTab].inputBuffer', async () => {
    app = makeApp();
    await app.start();

    emitEvent(app, { type: 'inputChanged', value: 'hello' });
    const state = app.getStateForTest() as unknown as {
      views: { chat: { inputBuffer: string } };
    };
    expect(state.views.chat.inputBuffer).toBe('hello');

    // Updating inputChanged again overwrites (the renderer is the source of truth).
    emitEvent(app, { type: 'inputChanged', value: 'hello world' });
    expect(state.views.chat.inputBuffer).toBe('hello world');

    await app.stop();
  });

  it('inputChanged mirrors into the active tab only', async () => {
    app = makeApp();
    await app.start();

    // Switch to agent tab by emitting a switchTab event.
    emitEvent(app, { type: 'switchTab', tab: 'agent' });
    emitEvent(app, { type: 'inputChanged', value: 'agent prompt' });

    const state = app.getStateForTest() as unknown as {
      activeTab: string;
      views: { chat: { inputBuffer: string }; agent: { inputBuffer: string } };
    };
    expect(state.activeTab).toBe('agent');
    expect(state.views.agent.inputBuffer).toBe('agent prompt');
    expect(state.views.chat.inputBuffer).toBe('');

    await app.stop();
  });

  // -- submitInput drives handleRenderSubmit --------------------------------

  it('submitInput event routes chat tab through processChat', async () => {
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
    app = makeApp({ agentSession: { processChat, processTurn } });
    await app.start();

    // Mirror what the renderer does before submit: textarea typed then enter.
    emitEvent(app, { type: 'inputChanged', value: 'hello chat' });
    emitEvent(app, { type: 'submitInput', value: 'hello chat' });

    // submitChatInput is async; wait a microtask so the response lands.
    await Promise.resolve();
    await Promise.resolve();

    expect(processChat).toHaveBeenCalledWith('hello chat');
    expect(processTurn).not.toHaveBeenCalled();

    const state = app.getStateForTest() as unknown as {
      views: { chat: { submittedPrompts: string[]; agentResponses: string[]; inputBuffer: string } };
    };
    expect(state.views.chat.submittedPrompts).toEqual(['hello chat']);
    expect(state.views.chat.agentResponses).toEqual(['[chat] hello chat']);

    await app.stop();
  });

  it('submitInput event routes agent tab through processTurn', async () => {
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
    app = makeApp({ agentSession: { processChat, processTurn } });
    await app.start();

    emitEvent(app, { type: 'switchTab', tab: 'agent' });
    emitEvent(app, { type: 'inputChanged', value: 'go agent' });
    emitEvent(app, { type: 'submitInput', value: 'go agent' });

    await Promise.resolve();
    await Promise.resolve();

    // Agent tab routes chat-first; processTurn is the fallback.
    expect(processTurn).toHaveBeenCalledWith('go agent');
    expect(processChat).not.toHaveBeenCalled();

    const state = app.getStateForTest() as unknown as {
      views: { agent: { submittedPrompts: string[]; agentResponses: string[] } };
    };
    expect(state.views.agent.submittedPrompts).toEqual(['go agent']);
    expect(state.views.agent.agentResponses).toEqual(['[agent] go agent']);

    await app.stop();
  });

  it('submitInput without an agentSession appends a placeholder response', async () => {
    app = makeApp({ agentSession: undefined });
    await app.start();

    emitEvent(app, { type: 'inputChanged', value: 'hi' });
    emitEvent(app, { type: 'submitInput', value: 'hi' });
    await Promise.resolve();
    await Promise.resolve();

    const state = app.getStateForTest() as unknown as {
      views: { chat: { submittedPrompts: string[]; agentResponses: string[] } };
    };
    expect(state.views.chat.submittedPrompts).toEqual(['hi']);
    expect(state.views.chat.agentResponses.length).toBe(1);
    expect(state.views.chat.agentResponses[0]).toContain('hi');

    await app.stop();
  });

  // -- resolveApproval delegates to resolveApprovalFromView ----------------

  it('resolveApproval event calls resolveApprovalFromView (no-op when no pending approval)', async () => {
    app = makeApp();
    await app.start();

    const spy = vi.spyOn(
      app as unknown as { resolveApprovalFromView: (s: 'approved' | 'denied') => Promise<void> },
      'resolveApprovalFromView',
    );

    // No pending approval → resolveApprovalFromView runs but returns early.
    emitEvent(app, { type: 'resolveApproval', status: 'approved' });
    expect(spy).toHaveBeenCalledWith('approved');

    spy.mockRestore();
    await app.stop();
  });

  it('resolveApproval event removes the oldest pending approval from active tab', async () => {
    app = makeApp();
    await app.start();

    // Skip the post-resolve refresh() — it would rebuild pendingApprovals
    // from the snapshot, which has no approvals wired in this test. The
    // shape we care about is the splice performed *before* refresh runs.
    const refreshSpy = vi.spyOn(
      app as unknown as { refresh: () => Promise<void> },
      'refresh',
    ).mockResolvedValue();

    // Seed two pending approvals on the chat tab.
    const state = app.getStateForTest() as unknown as {
      views: { chat: { pendingApprovals: Array<{ id: string; toolName: string; target: string; requestedAt: number }> } };
    };
    state.views.chat.pendingApprovals = [
      { id: 'apr_1', toolName: 'file.write', target: 'foo.txt', requestedAt: 100 },
      { id: 'apr_2', toolName: 'file.read', target: 'bar.txt', requestedAt: 200 },
    ];

    // Skip ApprovalManager — no manager wired → resolves locally only.
    emitEvent(app, { type: 'resolveApproval', status: 'approved' });
    await Promise.resolve();
    await Promise.resolve();

    expect(refreshSpy).toHaveBeenCalled();
    expect(state.views.chat.pendingApprovals).toEqual([
      { id: 'apr_2', toolName: 'file.read', target: 'bar.txt', requestedAt: 200 },
    ]);

    refreshSpy.mockRestore();
    await app.stop();
  });

  it('resolveApproval event with status "denied" picks the oldest pending', async () => {
    app = makeApp();
    await app.start();

    const refreshSpy = vi.spyOn(
      app as unknown as { refresh: () => Promise<void> },
      'refresh',
    ).mockResolvedValue();

    const state = app.getStateForTest() as unknown as {
      views: { chat: { pendingApprovals: Array<{ id: string; toolName: string; target: string; requestedAt: number }>; resolvedApprovals: Array<{ id: string; status: 'approved' | 'denied' }> } };
    };
    state.views.chat.pendingApprovals = [
      { id: 'apr_1', toolName: 'file.write', target: 'foo.txt', requestedAt: 100 },
    ];

    emitEvent(app, { type: 'resolveApproval', status: 'denied' });
    await Promise.resolve();
    await Promise.resolve();

    expect(state.views.chat.pendingApprovals).toEqual([]);
    expect(state.views.chat.resolvedApprovals[0]).toMatchObject({
      id: 'apr_1',
      status: 'denied',
    });

    refreshSpy.mockRestore();
    await app.stop();
  });

  // -- Tab navigation events still work through the renderer path ----------

  it('switchTab event changes activeTab', async () => {
    app = makeApp();
    await app.start();

    emitEvent(app, { type: 'switchTab', tab: 'approvals' });
    const state = app.getStateForTest() as unknown as { activeTab: string };
    expect(state.activeTab).toBe('approvals');

    emitEvent(app, { type: 'homeTab' });
    expect(state.activeTab).toBe('chat');

    await app.stop();
  });

  it('cycleTab event advances and retreats through TAB_ORDER', async () => {
    app = makeApp();
    await app.start();

    emitEvent(app, { type: 'cycleTab', forward: true });
    expect((app.getStateForTest() as unknown as { activeTab: string }).activeTab).toBe('agent');

    emitEvent(app, { type: 'cycleTab', forward: true });
    expect((app.getStateForTest() as unknown as { activeTab: string }).activeTab).toBe('daemon');

    emitEvent(app, { type: 'cycleTab', forward: false });
    expect((app.getStateForTest() as unknown as { activeTab: string }).activeTab).toBe('agent');

    await app.stop();
  });
});
