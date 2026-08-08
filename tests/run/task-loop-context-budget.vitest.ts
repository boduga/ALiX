/**
 * Task 5 integration tests: budget + assembly + preflight in the task loop.
 *
 * Tests the money invariant (provider NEVER receives an over-budget request),
 * explicit maxOutputTokens, irreducible overflow error, and reducible reduction.
 *
 * Seam: mock provider that RECORDS the request it receives, real EventLog on
 * tmpdir (same pattern as task-loop-emit-agent.vitest.ts).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
import { createContextBudget } from '../../src/config/context-budget.js';
import { ContextBudgetOverflowError } from '../../src/config/context-budget.js';
import type { ContextBudget } from '../../src/config/context-budget.js';
import { assembleContext } from '../../src/config/context-assembly.js';
import {
  ensureEncoder,
  estimateBudgetTokens,
  estimateMessageBudgetTokens,
} from '../../src/utils/tokens.js';
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedMessage,
  ToolCall,
  TokenUsage,
} from '../../src/providers/types.js';
import { TaskStateMachine, RunLimiter } from '../../src/autonomy/state-machine.js';
import { ScopeTracker } from '../../src/autonomy/scope-tracker.js';
import { MemoryStore } from '../../src/utils/memory/store.js';
import { ProgressLedger } from '../../src/run/progress-ledger.js';
import type { MutationSessionState } from '../../src/run.js';

// ── Minimal mock provider that RECORDS what it receives ────────────────
type RecordedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
  maxOutputTokens?: number;
};

function createMockProvider(opts?: {
  responseText?: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}): ModelAdapter & { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  return {
    id: 'mock',
    capabilities: {
      provider: 'mock',
      model: 'mock',
      inputTokenLimit: 100_000,
      outputTokenLimit: 16_384,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    },
    editFormatPreference: 'search_replace',
    longContextStrategy: 'trimmed_context',
    async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
      requests.push({
        systemPrompt: req.systemPrompt,
        messages: [...req.messages],
        maxOutputTokens: req.maxOutputTokens,
      });
      return {
        text: opts?.responseText ?? 'done. Task completed.',
        toolCalls: opts?.toolCalls ?? [],
        usage: opts?.usage ?? { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
      };
    },
    requests,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────
function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function makeTestDeps(overrides: {
  provider: ModelAdapter & { requests: RecordedRequest[] };
  contextBudget: ContextBudget;
  messages: NormalizedMessage[];
  systemPrompt?: string;
  task?: string;
  maxIterations?: number;
}): Promise<{ deps: TaskLoopDeps; log: EventLog; sessionDir: string; cleanup: () => void }> {
  const tmpRoot = makeTempDir('alix-t5-');
  const sessionId = 't5-test';
  const sessionDir = join(tmpRoot, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const memoryDir = join(tmpRoot, 'memory');
  const memoryStore = new MemoryStore(memoryDir);
  await memoryStore.init();

  const log = new EventLog(join(tmpRoot, 'events'));
  await log.init();

  const sessionState: MutationSessionState = {
    created: new Set<string>(),
    deleted: new Set<string>(),
    changed: new Set<string>(),
    fatalErrors: [],
    pendingScopeExpansion: false,
  };

  const scope = new ScopeTracker();
  const stateMachine = new TaskStateMachine(new RunLimiter({
    maxIterations: overrides.maxIterations ?? 2,
    maxRepairs: 3,
    maxFileChanges: 100,
    maxShellCommands: 50,
    maxRuntimeMs: 60_000,
  }));

  const deps: TaskLoopDeps = {
    config: {
      model: { provider: 'mock', name: 'mock', streaming: false },
      permissions: {},
    },
    provider: overrides.provider,
    providerTools: [],
    mcpToolIndex: [],
    messages: overrides.messages,
    sessionState,
    stateMachine,
    scope,
    session: { sessionId, actor: 'system' as const },
    log,
    executor: {} as any, // not used in no-tool-calls path
    mcpDiscovery: null,
    selectedTools: [],
    hooks: {},
    maxIterations: overrides.maxIterations ?? 2,
    contextBudget: overrides.contextBudget,
    tokenizer: 'cl100k_base',
    task: overrides.task ?? 'test task',
    taskType: 'docs',
    depth: 'quick',
    memoryStore,
    sessionId,
    sessionDir,
    systemPrompt: overrides.systemPrompt ?? 'You are a test assistant.',
  };

  return {
    deps,
    log,
    sessionDir,
    cleanup: () => {
      // Best-effort cleanup — temp dirs
    },
  };
}

/** Build a long text of approximately `targetTokens` tokens (cl100k_base). */
function longText(targetTokens: number): string {
  // Rough approximation: most English words are ~1.3 tokens, so produce
  // enough words to exceed the target. Use a repeating sentence for density.
  const sentence = 'The quick brown fox jumps over the lazy dog. ';
  // ~10 tokens per sentence. Each repetition gives ~10 tokens.
  const reps = Math.ceil(targetTokens / 10);
  return sentence.repeat(reps);
}

// ── Tests ──────────────────────────────────────────────────────────────
describe('Task 5: budget + assembly + preflight in task-loop', () => {
  it('sends maxOutputTokens on the provider request', async () => {
    const mockProvider = createMockProvider({ responseText: 'done. Task completed.' });
    const budget = createContextBudget(
      { contextWindowTokens: 100_000 },
      { outputRatio: 0.2, outputFloor: 4096, outputCap: 32768 },
    );
    const { deps } = await makeTestDeps({
      provider: mockProvider,
      contextBudget: budget,
      messages: [{ role: 'user', content: 'hello' }],
      maxIterations: 1,
    });

    try {
      await runTaskLoop(deps);
    } catch {
      // If the budget path throws, the test still checks the recorded request
    }

    // The provider should be called for a simple single-turn conversation.
    expect(mockProvider.requests.length).toBeGreaterThan(0);
    expect(mockProvider.requests[0]!.maxOutputTokens).toBe(budget.reservedOutputTokens);
  });

  it('guarantees the request the provider receives never exceeds the budget (money invariant)', async () => {
    const mockProvider = createMockProvider({ responseText: 'done. Task completed.' });
    // Budget where mandatory core fits but full conversation does not.
    // 2k reserved, 10k available input.
    const budget = createContextBudget(
      { contextWindowTokens: 12_000 },
      { outputRatio: 0.1667, outputFloor: 2000, outputCap: 2000 },
    );
    // Messages that overflow 2k available input tokens.
    const overflowMessages: NormalizedMessage[] = [
      { role: 'user', content: 'Long task: ' + longText(2000) },
      { role: 'assistant', content: longText(2000) },
      { role: 'user', content: longText(2000) },
      { role: 'assistant', content: longText(2000) },
      { role: 'user', content: '<tool_result id="1">\n' + longText(2000) + '\n</tool_result>' },
    ];
    const { deps } = await makeTestDeps({
      provider: mockProvider,
      contextBudget: budget,
      messages: overflowMessages,
      systemPrompt: 'You are a helpful assistant. ',
      maxIterations: 1,
    });

    await ensureEncoder('cl100k_base');

    try {
      await runTaskLoop(deps);
    } catch {
      // If irreducible, the provider should never have been called.
    }

    // The money invariant: the provider was called (reducible overflow)
    // and every request fits within the budget.
    // I4 fix: measure actual tokens using the padded estimators.
    expect(mockProvider.requests.length).toBeGreaterThan(0);

    for (const req of mockProvider.requests) {
      expect(req.maxOutputTokens).toBe(budget.reservedOutputTokens);

      const sysMeta = await estimateBudgetTokens(req.systemPrompt, 'cl100k_base');
      let totalTokens = sysMeta.budgetEstimate;
      for (const msg of req.messages) {
        const meta = await estimateMessageBudgetTokens(
          { role: msg.role, content: msg.content },
          'cl100k_base',
        );
        totalTokens += meta.budgetEstimate;
      }
      expect(totalTokens).toBeLessThanOrEqual(budget.availableInputTokens);
    }
  });

  it('throws ContextBudgetOverflowError for irreducible mandatory overflow', async () => {
    const mockProvider = createMockProvider({ responseText: 'done.' });
    // Extremely small budget: 200 window, 100 reserved, 100 available
    // Even the mandatory core (system prompt + task) won't fit in 100 tokens.
    const budget = createContextBudget(
      { contextWindowTokens: 200 },
      { outputFloor: 100, outputCap: 100, outputRatio: 0.5 },
    );
    const { deps } = await makeTestDeps({
      provider: mockProvider,
      contextBudget: budget,
      messages: [{ role: 'user', content: longText(200) }], // ~200 tokens > 100 available
      systemPrompt: 'You are an assistant. ' + longText(50), // ~50 tokens
      maxIterations: 1,
    });

    let error: unknown;
    try {
      await runTaskLoop(deps);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ContextBudgetOverflowError);
    if (error instanceof ContextBudgetOverflowError) {
      expect(error.reducible).toBe(false);
      expect(error.kind).toBe('context_budget_overflow');
      expect(error.overageTokens).toBeGreaterThan(0);
    }

    // Money invariant: provider was NEVER called
    expect(mockProvider.requests.length).toBe(0);
  });

  it('reduces a reducible overflow deterministically and re-preflights before sending', async () => {
    const mockProvider = createMockProvider({ responseText: 'done. Task completed.' });
    // Budget big enough for mandatory core + some conversation, but not all.
    // I3 makes the last user message mandatory, so budget must accommodate
    // system prompt + msg0 + msg5 (~1203 padded) as mandatory core.
    const budget = createContextBudget(
      { contextWindowTokens: 2_500 },
      { outputFloor: 500, outputCap: 500, outputRatio: 0.2 },
    );
    // System prompt + task are small, but conversation messages overflow.
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'Fix the bug. ' },                            // Tier 2
      { role: 'assistant', content: longText(500) },                          // Tier 4
      { role: 'user', content: longText(500) },                               // Tier 4
      { role: 'assistant', content: longText(500) },                          // Tier 4
      { role: 'user', content: '<tool_result id="1">\n' + longText(500) + '\n</tool_result>' }, // Tier 5
      { role: 'user', content: longText(500) },                               // Tier 4
    ];
    const { deps } = await makeTestDeps({
      provider: mockProvider,
      contextBudget: budget,
      messages,
      systemPrompt: 'Helpful. ',
      maxIterations: 1,
    });

    try {
      await runTaskLoop(deps);
    } catch {
      // May throw if irreducible, but this case should be reducible
    }

    // Provider was called (reducible)
    expect(mockProvider.requests.length).toBeGreaterThan(0);
    const req = mockProvider.requests[0]!;
    expect(req.maxOutputTokens).toBe(budget.reservedOutputTokens);
    // The request the provider received should have fewer messages than
    // the original (some were dropped by assembly).
    expect(req.messages.length).toBeLessThan(messages.length);
  });

  // ── C1 regression: non-streaming path MUST populate text/toolCalls/usage ──
  it('non-streaming path captures provider response (C1 regression)', async () => {
    // The C1 bug: the non-streaming `else` branch called provider.complete()
    // and assigned to `resp` but NEVER read `resp` — text/toolCalls/usage
    // stayed at their initial values ("" / [] / undefined). This test
    // verifies the fix by checking that model.usage is emitted, which only
    // happens when `usage` is populated from the response.
    const mockProvider = createMockProvider({
      responseText: 'done. Task completed.',
      usage: { inputTokens: 500, outputTokens: 200 },
    });
    const budget = createContextBudget(
      { contextWindowTokens: 100_000 },
      { outputRatio: 0.2, outputFloor: 4096, outputCap: 32768 },
    );
    const { deps, log } = await makeTestDeps({
      provider: mockProvider,
      contextBudget: budget,
      messages: [{ role: 'user', content: 'Complete this task' }],
      maxIterations: 1,
    });

    await runTaskLoop(deps);

    // Provider MUST have been called.
    expect(mockProvider.requests.length).toBe(1);

    // C1 money assertion: model.usage MUST be emitted, proving `usage` was
    // populated from the response. Without the C1 fix, `usage` stays undefined
    // and this event is never emitted.
    const { events } = await log.readSince(log.beginningCursor());
    const usageEvents = events.filter((e) => e.type === 'model.usage');
    expect(usageEvents.length).toBe(1);
  });

  // ── I3: last user message MUST be classified as mandatory (never dropped) ──
  it('keeps the last user turn as mandatory current_task (I3)', async () => {
    const mockProvider = createMockProvider({
      responseText: 'done.',
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    // Budget tight enough that best-effort tiers get dropped.
    const budget = createContextBudget(
      { contextWindowTokens: 4_000 },
      { outputRatio: 0.5, outputFloor: 2000, outputCap: 2000 },
    );
    // Multi-turn: first user message is a long-ago instruction, last user
    // message is the actual current request.
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'Initial task: ' + longText(300) },
      { role: 'assistant', content: longText(300) },
      { role: 'user', content: 'Quick follow-up request' }, // LAST user turn — mandatory
    ];
    const { deps } = await makeTestDeps({
      provider: mockProvider,
      contextBudget: budget,
      messages,
      systemPrompt: 'Helpful. ',
      maxIterations: 1,
    });

    await runTaskLoop(deps);

    expect(mockProvider.requests.length).toBe(1);
    const req = mockProvider.requests[0]!;

    // The last user message ("Quick follow-up request") MUST be present
    // in the request — it is the current instruction and is not droppable.
    const lastUserContent = messages[2]!.content;
    const hasLastUser = req.messages.some(
      (m) => m.role === 'user' && (typeof m.content === 'string' ? m.content : '').includes('Quick follow-up'),
    );
    expect(hasLastUser).toBe(true);
  });
});
