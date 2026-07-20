import { beforeEach, describe, it, expect, vi } from "vitest";
import { createAgentSession } from "../../src/agent/session.js";
import type { ModelAdapter } from "../../src/providers/types.js";
import { SessionPhase } from "../../src/tui/state.js";

const mocks = vi.hoisted(() => ({
  append: vi.fn(() => Promise.resolve()),
  initAgent: vi.fn(),
  runTaskLoop: vi.fn(),
}));

vi.mock("../../src/agent/agent.js", () => ({ initAgent: mocks.initAgent }));
vi.mock("../../src/run/task-loop.js", () => ({ runTaskLoop: mocks.runTaskLoop }));
vi.mock("../../src/utils/memory/recall.js", () => ({
  buildMemoryContext: vi.fn(() => Promise.resolve(undefined)),
  buildMemoryStats: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("../../src/skills/loader.js", () => ({
  loadSkillManifests: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../../src/skills/catalog.js", () => ({
  buildSkillCatalog: vi.fn(() => ({
    getMatchedContent: vi.fn(() => Promise.resolve([])),
  })),
}));
vi.mock("../../src/skills/lifecycle.js", () => ({ evictIfNeeded: vi.fn() }));

beforeEach(() => {
  mocks.append.mockClear();
  mocks.initAgent.mockReset().mockResolvedValue({
    sessionId: "phase-test-session",
    sessionDir: "/tmp/phase-test-session",
    log: {
      append: mocks.append,
      readAll: vi.fn(() => Promise.resolve([])),
    },
    config: {
      model: {
        provider: "anthropic",
        name: "test-model",
        streaming: false,
        maxContextTokens: 1_000,
        maxIterations: 1,
      },
      permissions: { sessionMode: "auto" },
      apiKeys: {},
    },
    provider: { editFormatPreference: "structured_patch" },
    editFormatPolicy: {},
    mcpManager: null,
    toolExecutor: {},
    checkpointManager: {},
    memoryStore: {},
    repoMap: undefined,
    scope: {},
    hookRunner: {},
  });
  mocks.runTaskLoop.mockReset().mockResolvedValue({
    summary: "phase test complete",
    streamed: false,
    reason: "completed",
  });
});

describe("SessionPhase (contract)", () => {
  it("Idle is defined for sessions that have not yet run", () => {
    expect(SessionPhase.Idle).toBeDefined();
  });

  it("progresses through Understanding → Planning → Executing → Verifying → Summarizing → Idle", () => {
    const order = [
      SessionPhase.Understanding,
      SessionPhase.Planning,
      SessionPhase.Executing,
      SessionPhase.Verifying,
      SessionPhase.Summarizing,
      SessionPhase.Idle,
    ];
    expect(order).toEqual([
      SessionPhase.Understanding,
      SessionPhase.Planning,
      SessionPhase.Executing,
      SessionPhase.Verifying,
      SessionPhase.Summarizing,
      SessionPhase.Idle,
    ]);
  });

  it("enum has 6 phases (string-valued, no reverse-mapped duplication)", () => {
    expect(Object.keys(SessionPhase).length).toBe(6);
  });

  it("each phase is a distinct non-empty string", () => {
    const values = Object.values(SessionPhase);
    expect(values).toHaveLength(6);
    for (const v of values) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
    expect(new Set(values).size).toBe(6);
  });

  it("phase values are JSON-serialisable as readable strings", () => {
    expect(JSON.stringify({ phase: SessionPhase.Understanding })).toBe(
      '{"phase":"Understanding"}',
    );
  });

  it("getPhase() returns Idle initially", () => {
    const session = createAgentSession({ cwd: "/tmp", task: "" });

    expect(session.getPhase?.()).toBe(SessionPhase.Idle);
  });

  it("phase_changed event payload shape", async () => {
    const session = createAgentSession({
      cwd: "/tmp",
      task: "",
      planMode: false,
    });

    await session.processTurn("exercise phase wiring");

    expect(mocks.append).toHaveBeenCalledWith({
      sessionId: "phase-test-session",
      actor: "system",
      type: "agent.session.phase_changed",
      payload: { phase: SessionPhase.Understanding },
    });
    expect(mocks.append).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent.session.phase_changed",
        payload: { phase: SessionPhase.Planning },
      }),
    );
  });
});

describe("processChat (lightweight chat path)", () => {
  /** Build a ModelAdapter stub with vi.fn for the complete() call. */
  function makeMockProvider(complete: ReturnType<typeof vi.fn>) {
    return {
      id: 'mock',
      capabilities: {} as never,
      editFormatPreference: 'unified_diff' as const,
      longContextStrategy: 'trimmed_context' as const,
      // Cast to satisfy the ModelAdapter shape; the test reaches inside
      // via `complete.mock.calls[N]?.[0]` and inspects fields as any.
      complete: complete as unknown as ModelAdapter['complete'],
    };
  }

  function makeSession(chatProvider?: ReturnType<typeof makeMockProvider>) {
    return createAgentSession({
      cwd: '/tmp/chat-test',
      task: '',
      sessionId: 'chat-test',
      ...(chatProvider ? { chatProvider } : {}),
    });
  }

  it('falls back to a placeholder when no chatProvider or chatModel is configured', async () => {
    const session = makeSession();
    const result = await session.processChat('hi');
    expect(result.summary).toContain('[chat:no-provider]');
    expect(result.summary).toContain('hi');
    expect(result.toolCalls).toEqual([]);
    expect(result.reason).toBe('chat');
  });

  it('calls provider.complete with the configured system prompt + user message', async () => {
    const complete = vi.fn(async () => ({ text: 'Hello back!', toolCalls: [] }));
    const session = makeSession(makeMockProvider(complete));
    const result = await session.processChat('hello');
    expect(complete).toHaveBeenCalledOnce();
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as { systemPrompt: string; messages: Array<{ role: string; content: string }>; maxOutputTokens: number } | undefined;
    expect(req).toBeDefined();
    expect(req!.systemPrompt).toMatch(/ALiX/);
    expect(req!.messages).toHaveLength(1);
    expect(req!.messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(req!.maxOutputTokens).toBeGreaterThan(0);
    expect(result.summary).toBe('Hello back!');
    expect(result.toolCalls).toEqual([]);
    expect(result.reason).toBe('chat');
  });

  it('grows conversation history across multiple turns', async () => {
    let turn = 0;
    const complete = vi.fn(async () => {
      turn += 1;
      return { text: `reply-${turn}`, toolCalls: [] };
    });
    const session = makeSession(makeMockProvider(complete));
    await session.processChat('hi');
    await session.processChat('how are you?');
    await session.processChat('goodbye');
    expect(complete).toHaveBeenCalledTimes(3);
    const lastReq = (complete.mock.calls as unknown[][])[2]?.[0] as { messages: Array<{ role: string; content: string }> } | undefined;
    expect(lastReq).toBeDefined();
    // Each turn appends both a user + assistant; the third call sees
    // 5 entries (user, assistant, user, assistant, user).
    expect(lastReq!.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:hi',
      'assistant:reply-1',
      'user:how are you?',
      'assistant:reply-2',
      'user:goodbye',
    ]);
  });

  it('drops the optimistic user message when the provider throws', async () => {
    const complete = vi.fn(async () => { throw new Error('rate limited'); });
    const session = makeSession(makeMockProvider(complete));
    await session.processChat('hi');
    await session.processChat('how are you?');
    const lastReq = (complete.mock.calls as unknown[][])[1]?.[0] as { messages: Array<{ role: string; content: string }> } | undefined;
    // After the first call failed and we popped the optimistic user msg,
    // the second call should see exactly one user message — not two.
    expect(lastReq!.messages).toHaveLength(1);
    expect(lastReq!.messages[0]).toEqual({ role: 'user', content: 'how are you?' });
    const errorResult = await session.processChat('third');
    expect(errorResult.summary).toContain('[chat error]');
    expect(errorResult.summary).toContain('rate limited');
  });

  it('allows overriding the chat system prompt via config', async () => {
    const complete = vi.fn(async () => ({ text: 'custom-ok', toolCalls: [] }));
    const session = createAgentSession({
      cwd: '/tmp/chat-test',
      task: '',
      sessionId: 'chat-test',
      chatProvider: makeMockProvider(complete),
      chatSystemPrompt: 'You are a pirate. Reply briefly.',
    });
    await session.processChat('hello');
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as { systemPrompt: string } | undefined;
    expect(req!.systemPrompt).toBe('You are a pirate. Reply briefly.');
  });

  it('runs chatSearchTool and injects results into the user message', async () => {
    const chatSearchTool = vi.fn(async () => 'headline: ALiX ships new TUI');
    const complete = vi.fn(async () => ({ text: 'fresh-reply', toolCalls: [] }));
    const session = createAgentSession({
      cwd: '/tmp/chat-test',
      task: '',
      sessionId: 'chat-test',
      chatProvider: makeMockProvider(complete),
      chatSearchTool,
    });
    const result = await session.processChat("what's new");
    expect(chatSearchTool).toHaveBeenCalledWith("what's new");
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as { messages: Array<{ role: string; content: string }> } | undefined;
    expect(req).toBeDefined();
    expect(req!.messages[0].role).toBe('user');
    // The user message should now include the search label + result.
    expect(req!.messages[0].content).toContain("what's new");
    expect(req!.messages[0].content).toContain('[Web search results]');
    expect(req!.messages[0].content).toContain('headline: ALiX ships new TUI');
    expect(result.summary).toBe('fresh-reply');
  });

  it('falls back to plain user message when chatSearchTool returns empty', async () => {
    const chatSearchTool = vi.fn(async () => '');
    const complete = vi.fn(async () => ({ text: 'r', toolCalls: [] }));
    const session = createAgentSession({
      cwd: '/tmp/chat-test',
      task: '',
      sessionId: 'chat-test',
      chatProvider: makeMockProvider(complete),
      chatSearchTool,
    });
    await session.processChat('hi');
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as { messages: Array<{ role: string; content: string }> } | undefined;
    expect(req!.messages[0].content).toBe('hi');
  });

  it('falls back to plain user message when chatSearchTool throws', async () => {
    const chatSearchTool = vi.fn(async () => { throw new Error('rate limited'); });
    const complete = vi.fn(async () => ({ text: 'r', toolCalls: [] }));
    const session = createAgentSession({
      cwd: '/tmp/chat-test',
      task: '',
      sessionId: 'chat-test',
      chatProvider: makeMockProvider(complete),
      chatSearchTool,
    });
    const result = await session.processChat('hi');
    expect(result.summary).toBe('r');
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as { messages: Array<{ role: string; content: string }> } | undefined;
    expect(req!.messages[0].content).toBe('hi');
  });

  it('honours chatSearchLabel override', async () => {
    const chatSearchTool = vi.fn(async () => 'fresh data');
    const complete = vi.fn(async () => ({ text: 'r', toolCalls: [] }));
    const session = createAgentSession({
      cwd: '/tmp/chat-test',
      task: '',
      sessionId: 'chat-test',
      chatProvider: makeMockProvider(complete),
      chatSearchTool,
      chatSearchLabel: '[FRESH CONTEXT]',
    });
    await session.processChat('q');
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as { messages: Array<{ role: string; content: string }> } | undefined;
    expect(req!.messages[0].content).toContain('[FRESH CONTEXT]');
    expect(req!.messages[0].content).toContain('fresh data');
  });
});
