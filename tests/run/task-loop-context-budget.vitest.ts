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
  StreamChunk,
  ToolCall,
  ToolDef,
  TokenUsage,
} from '../../src/providers/types.js';
import type { DeferredToolEntry } from '../../src/mcp/tool-deferral.js';
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
  /** The structured tools array sent to the provider (wire payload). */
  tools?: (ToolDef | DeferredToolEntry)[];
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
        tools: req.tools ? [...req.tools] : undefined,
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

// Streaming variant: implements BOTH `stream` (recording the request) and
// `complete` (the streamToResponse fail-soft fallback path). The money
// invariant must hold on the streaming path exactly as on the blocking path.
function createMockStreamingProvider(opts?: {
  responseText?: string;
  usage?: TokenUsage;
}): ModelAdapter & { requests: RecordedRequest[]; streamCalls: number; completeCalls: number } {
  const requests: RecordedRequest[] = [];
  let streamCalls = 0;
  let completeCalls = 0;
  const record = (req: NormalizedRequest) => {
    requests.push({
      systemPrompt: req.systemPrompt,
      messages: [...req.messages],
      maxOutputTokens: req.maxOutputTokens,
      tools: req.tools ? [...req.tools] : undefined,
    });
  };
  return {
    id: 'mock-stream',
    capabilities: {
      provider: 'mock',
      model: 'mock',
      inputTokenLimit: 100_000,
      outputTokenLimit: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    },
    editFormatPreference: 'search_replace',
    longContextStrategy: 'trimmed_context',
    async *stream(req: NormalizedRequest): AsyncGenerator<StreamChunk> {
      streamCalls++;
      record(req);
      yield { type: 'text_delta', text: opts?.responseText ?? 'done. Task completed.' };
      yield { type: 'usage', usage: opts?.usage ?? { inputTokens: 100, outputTokens: 50 } };
      yield { type: 'done' };
    },
    async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
      completeCalls++;
      record(req);
      return {
        text: opts?.responseText ?? 'done. Task completed.',
        toolCalls: [],
        usage: opts?.usage ?? { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
      };
    },
    requests,
    get streamCalls() { return streamCalls; },
    get completeCalls() { return completeCalls; },
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
  streaming?: boolean;
  executor?: TaskLoopDeps['executor'];
  selectedTools?: TaskLoopDeps['selectedTools'];
  providerTools?: TaskLoopDeps['providerTools'];
  mcpToolIndex?: TaskLoopDeps['mcpToolIndex'];
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
      model: { provider: 'mock', name: 'mock', streaming: overrides.streaming ?? false },
      permissions: {},
    },
    provider: overrides.provider,
    providerTools: overrides.providerTools ?? [],
    mcpToolIndex: overrides.mcpToolIndex ?? [],
    messages: overrides.messages,
    sessionState,
    stateMachine,
    scope,
    session: { sessionId, actor: 'system' as const },
    log,
    executor: overrides.executor ?? ({} as any),
    mcpDiscovery: null,
    selectedTools: overrides.selectedTools ?? [],
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

/** Create `count` simple provider tools for budget discrimination.
 *  The structured JSON for these tools is a separate wire payload from
 *  the tool-manifest text embedded in the system prompt. Round-2 code
 *  does NOT reserve this payload; round-3 code does. More tools = larger
 *  unaccounted delta = stronger discriminating power. */
function makeProviderTools(count: number): ToolDef[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `alix_tool_${i}`,
    description: `Tool ${i} for task automation. Performs operations as directed.`,
    input_schema: {
      type: 'object' as const,
      properties: { param: { type: 'string' as const, description: 'Input parameter' } },
      required: ['param'],
    },
  }));
}

/**
 * Estimate total padded tokens for a recorded request including the
 * structured tools array (a separate wire payload from the system prompt).
 * Used by money-invariant checks to detect unaccounted tool schema tokens.
 */
async function estimateTotalRequestTokens(
  req: RecordedRequest,
  tokenizer: 'cl100k_base' = 'cl100k_base',
): Promise<number> {
  const sysMeta = await estimateBudgetTokens(req.systemPrompt, tokenizer);
  let total = sysMeta.budgetEstimate;
  for (const msg of req.messages) {
    const meta = await estimateMessageBudgetTokens(
      { role: msg.role, content: msg.content },
      tokenizer,
    );
    total += meta.budgetEstimate;
  }
  // Include structured tool schema tokens — a separate wire payload from
  // the tool manifest text that is embedded in the system prompt.
  if (req.tools && req.tools.length > 0) {
    total += (await estimateBudgetTokens(JSON.stringify(req.tools), tokenizer)).budgetEstimate;
  }
  return total;
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
    expect(mockProvider.requests.length).toBeGreaterThan(0);

    for (const req of mockProvider.requests) {
      expect(req.maxOutputTokens).toBe(budget.reservedOutputTokens);
      // R3: measure the full wire payload including any structured tool schema
      const totalTokens = await estimateTotalRequestTokens(req, 'cl100k_base');
      expect(totalTokens).toBeLessThanOrEqual(budget.availableInputTokens);
    }
  });

  // ── Money-invariant with provider tools: tool schema tokens must be accounted ──
  it('guarantees the budget fits when provider tools carry a structured schema (money invariant + tools)', async () => {
    const mockProvider = createMockProvider({ responseText: 'done. Task completed.' });
    // window=1300, reserved=200, available=1100.
    // With 3 tools (sys=239, tools=177), round-2 all-admitted=1019,+tools=1196>1100 FAIL.
    // Round-3 mandatory(798) fits, best-effort dropped → 829≤1100 PASS.
    const budget = createContextBudget(
      { contextWindowTokens: 1_300 },
      { outputFloor: 200, outputCap: 200, outputRatio: 0.15 },
    );
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'First: ' + longText(300) },     // ~369 padded
      { role: 'assistant', content: longText(300) },              // ~367 padded, Tier-4
      { role: 'user', content: 'Current request: fix this bug' }, // ~13 padded, last user
    ];
    const { deps } = await makeTestDeps({
      provider: mockProvider, contextBudget: budget, messages,
      systemPrompt: 'Helpful. ', maxIterations: 1,
      providerTools: makeProviderTools(3),
    });

    await ensureEncoder('cl100k_base');

    try {
      await runTaskLoop(deps);
    } catch {
      // If irreducible, the provider should never have been called.
    }

    // The provider was called (or not, if irreducible).
    // Every request must fit within the budget INCLUDING tool schema tokens.
    for (const req of mockProvider.requests) {
      expect(req.maxOutputTokens).toBe(budget.reservedOutputTokens);
      const totalTokens = await estimateTotalRequestTokens(req, 'cl100k_base');
      expect(totalTokens).toBeLessThanOrEqual(budget.availableInputTokens);
    }
  });

  // ── Streaming path (C2 #20): the money invariant must hold there too ──
  // The streaming branch (streamToResponse → provider.stream) is symmetric to
  // the blocking branch but was untested under a tight budget with tools.
  it('guarantees the budget fits on the STREAMING path with tools (money invariant + tools)', async () => {
    const mockProvider = createMockStreamingProvider({ responseText: 'done. Task completed.' });
    // window=1300, reserved=200, available=1100 — identical to the blocking
    // path test above: tools must be reserved and best-effort tiers dropped.
    const budget = createContextBudget(
      { contextWindowTokens: 1_300 },
      { outputFloor: 200, outputCap: 200, outputRatio: 0.15 },
    );
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'First: ' + longText(300) },     // ~369 padded
      { role: 'assistant', content: longText(300) },              // ~367 padded, Tier-4
      { role: 'user', content: 'Current request: fix this bug' }, // ~13 padded, last user
    ];
    const { deps } = await makeTestDeps({
      provider: mockProvider, contextBudget: budget, messages,
      systemPrompt: 'Helpful. ', maxIterations: 1,
      providerTools: makeProviderTools(3),
      streaming: true,
    });

    await ensureEncoder('cl100k_base');

    try {
      await runTaskLoop(deps);
    } catch {
      // If irreducible, the provider should never have been called.
    }

    // Prove the STREAMING branch actually ran (via streamToResponse), not a
    // silent fallback to the blocking complete() path.
    expect(mockProvider.streamCalls).toBe(1);
    expect(mockProvider.completeCalls).toBe(0);

    // Every streamed request must fit within the budget INCLUDING tool schemas.
    for (const req of mockProvider.requests) {
      expect(req.maxOutputTokens).toBe(budget.reservedOutputTokens);
      const totalTokens = await estimateTotalRequestTokens(req, 'cl100k_base');
      expect(totalTokens).toBeLessThanOrEqual(budget.availableInputTokens);
    }
  });

  it('returns context_budget_overflow RunResult for irreducible mandatory overflow', async () => {
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

    // C2 #18: irreducible overflow is a graceful RunResult failure, not a throw.
    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('context_budget_overflow');
    expect(result.contextBudgetOverflow).toBeDefined();
    expect(result.contextBudgetOverflow?.reducible).toBe(false);
    expect(result.contextBudgetOverflow?.kind).toBe('context_budget_overflow');
    expect(result.contextBudgetOverflow?.overageTokens).toBeGreaterThan(0);
    expect(result.contextBudgetOverflow?.availableInputTokens).toBeGreaterThan(0);
    expect(result.contextBudgetOverflow?.mandatoryTokens).toBeGreaterThan(0);
    // Summary is a human-readable diagnostic, not a raw error string.
    expect(result.summary).toContain('more input tokens');

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

  // ── I3: the real last user turn is never dropped when a ledger is present ──
  // R4 genuinely discriminating: the real last user turn is large enough (~370
  // padded tokens) that when MISCLASSIFIED as Tier-4 (droppable) by a reverted
  // classifyMessageToCategory ordering, it is genuinely dropped by the greedy
  // selector. The ledger, correctly classified as Tier-3 (current_execution_state),
  // must NOT claim the last-user slot.
  //
  // Budget: window=1600, outputFloor/Cap=200, outputRatio=0.125 → available=1400.
  //   With fix: mandatory = sys(~240)+tools(~180)+msg0(~370)+msg2(~370) ≈ 1160 fits.
  //   Tier-3 ledger(~35) fits all-or-nothing. msg1(~365) dropped. msg2 SURVIVES.
  //   Without fix: mandatory = sys(~240)+tools(~180)+msg0(~370)+ledger(~35) ≈ 825.
  //   remaining = 1400−825=575. msg1(~365) fits → remaining=210. msg2(~370)>210 → DROPPED.
  it('classifies the real last user turn as mandatory when ledger is present (I3 regression)', async () => {
    const mockProvider = createMockProvider({ responseText: 'done.', usage: { inputTokens: 100, outputTokens: 50 } });
    await ensureEncoder('cl100k_base');

    // window=1600, outputFloor/Cap=200, outputRatio=0.125 → available=1400.
    const budget = createContextBudget(
      { contextWindowTokens: 1_600 },
      { outputFloor: 200, outputCap: 200, outputRatio: 0.125 },
    );

    // Pre-seed a ledger-style message to test the I3 classification contract.
    // msg2 is the REAL last user turn (large — would genuinely drop if misclassified).
    // msg3 starts with "[Progress Ledger]" → must be Tier-3 (current_execution_state).
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'First: ' + longText(300) },                    // ~370 padded, Tier-2 (index 0)
      { role: 'assistant', content: longText(300) },                            // ~365 padded, Tier-4
      { role: 'user', content: 'Current request: ' + longText(300) },          // ~370 padded, Tier-2 (REAL last user)
      { role: 'user', content: '[Progress Ledger]\nStep 1: called read — done\n---\nProgress: step 1/2' }, // Tier-3
    ];

    const { deps } = await makeTestDeps({
      provider: mockProvider, contextBudget: budget, messages,
      systemPrompt: 'Helpful. ', maxIterations: 1,
      providerTools: makeProviderTools(3),
    });

    let threwIrreducible = false;
    try { await runTaskLoop(deps); } catch (e) {
      if (e instanceof ContextBudgetOverflowError && !e.reducible) threwIrreducible = true;
    }

    // Must NOT throw irreducible — this is a reducible scenario.
    expect(threwIrreducible).toBe(false);
    expect(mockProvider.requests.length).toBe(1);
    const req = mockProvider.requests[0]!;

    // The REAL last user turn MUST be present (I3: Tier-2, mandatory).
    // When the I3 fix is regressed, msg2 is classified as Tier-4 and dropped.
    const hasRealLastUser = req.messages.some(
      (m) => m.role === 'user' && (typeof m.content === 'string' ? m.content : '').includes('Current request'),
    );
    expect(hasRealLastUser).toBe(true);

    // The ledger MUST be present (Tier-3, protected, correct classification).
    const hasLedger = req.messages.some(
      (m) => m.role === 'user' && (typeof m.content === 'string' ? m.content : '').startsWith('[Progress Ledger]'),
    );
    expect(hasLedger).toBe(true);

    // Money invariant: total request tokens (including structured tool schema)
    // must not exceed available.
    const totalTokens = await estimateTotalRequestTokens(req, 'cl100k_base');
    expect(totalTokens).toBeLessThanOrEqual(budget.availableInputTokens);
  });

  // ── Tool-schema gate: reducible overflow must NOT throw, best-effort dropped ──
  it('fits mandatory+tools by dropping best-effort (tool-schema reducible)', async () => {
    // R3 discriminating: 3 tools, tight budget. Round-2 admitted+tools overflows;
    // Round-3 mandatory(798) fits, best-effort dropped.
    const mockProvider = createMockProvider({ responseText: 'done.', usage: { inputTokens: 100, outputTokens: 50 } });
    await ensureEncoder('cl100k_base');

    // window=1300, reserved=200, available=1100.
    const budget = createContextBudget(
      { contextWindowTokens: 1_300 },
      { outputFloor: 200, outputCap: 200, outputRatio: 0.15 },
    );

    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'First instruction: ' + longText(300) },  // ~370 padded, Tier-2
      { role: 'assistant', content: longText(300) },                      // ~365 padded, Tier-4
      { role: 'user', content: 'Current: fix it' },                       // ~10 padded, Tier-2 (LAST user)
      { role: 'assistant', content: longText(100) },                      // ~127 padded, Tier-4
      { role: 'assistant', content: longText(100) },                      // ~127 padded, Tier-4 (NOT user — avoids claiming last-user slot)
    ];

    const { deps } = await makeTestDeps({
      provider: mockProvider, contextBudget: budget, messages,
      systemPrompt: 'Helpful. ', maxIterations: 1,
      providerTools: makeProviderTools(3),
    });

    let threwIrreducible = false;
    try { await runTaskLoop(deps); } catch (e) {
      if (e instanceof ContextBudgetOverflowError && !e.reducible) threwIrreducible = true;
    }

    // Must NOT throw irreducible — the selector drops best-effort to fit.
    expect(threwIrreducible).toBe(false);
    // Provider MUST have been called (the request fits after reduction).
    expect(mockProvider.requests.length).toBe(1);

    // Some best-effort messages were dropped (the admission reduced).
    const req = mockProvider.requests[0]!;
    expect(req.messages.length).toBeLessThan(messages.length);

    // Money invariant: total request tokens (incl. tool schema) must fit.
    const totalTokens = await estimateTotalRequestTokens(req, 'cl100k_base');
    expect(totalTokens).toBeLessThanOrEqual(budget.availableInputTokens);
  });

  // ── Tool-schema gate: genuinely irreducible when mandatory core + tools > available ──
  it('returns context_budget_overflow when mandatory core plus tool schema exceeds available', async () => {
    // R3 discriminating: mandatory+tools > available. 1 tool (sys=194, tools=62).
    // longText(200) msg=247. Round-2 mand=441, Round-3 mand=503.
    // available=470: Round-2 fits (441≤470), Round-3 irreducible (503>470).
    const mockProvider = createMockProvider({ responseText: 'done.', usage: { inputTokens: 100, outputTokens: 50 } });
    await ensureEncoder('cl100k_base');

    const budget = createContextBudget(
      { contextWindowTokens: 570 },
      { outputFloor: 100, outputCap: 100, outputRatio: 0.18 },
    );

    const messages: NormalizedMessage[] = [
      { role: 'user', content: longText(200) },  // ~247 padded
    ];

    const { deps } = await makeTestDeps({
      provider: mockProvider, contextBudget: budget, messages,
      systemPrompt: 'Helpful. ', maxIterations: 1,
      providerTools: makeProviderTools(1),
    });

    // C2 #18: graceful RunResult failure, not a throw.
    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('context_budget_overflow');
    expect(result.contextBudgetOverflow?.reducible).toBe(false);
    expect(result.contextBudgetOverflow?.kind).toBe('context_budget_overflow');
    expect(result.contextBudgetOverflow?.overageTokens).toBeGreaterThan(0);
    // Money invariant: provider was NEVER called (irreducible → no request sent).
    expect(mockProvider.requests.length).toBe(0);
  });

  // ── I1: ledger is token-accounted in the admitted request ──
  // R3 discriminating test: tight budget where the ledger is admitted and
  // counted. On round-2 code (tools unaccounted) the total overflows the
  // budget. On round-3 code, tools are reserved and the request fits.
  it('counts the progress ledger in the admitted request (I1 token accounting)', async () => {
    const mockExecutor = {
      execute: async (_req: any) => ({ kind: 'success' as const, output: 'ok\n' }),
      getApproval: (_id: string) => undefined,
    };

    let callCount = 0;
    const requests: RecordedRequest[] = [];
    // Return >= 200 chars of text on iteration 1 to avoid the synthesis
    // re-prompt which injects a user-role message that displaces the real
    // last user turn.
    const statefulProvider: ModelAdapter & { requests: RecordedRequest[] } = {
      id: 'mock', capabilities: {
        provider: 'mock', model: 'mock', inputTokenLimit: 100_000, outputTokenLimit: 16_384,
        supportsTools: true, supportsStreaming: false, supportsStructuredOutput: false, supportsVision: false,
      },
      editFormatPreference: 'search_replace' as const, longContextStrategy: 'trimmed_context' as const,
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        requests.push({
          systemPrompt: req.systemPrompt, messages: [...req.messages],
          maxOutputTokens: req.maxOutputTokens,
          tools: req.tools ? [...req.tools] : undefined,
        });
        callCount++;
        if (callCount === 1) {
          return {
            text: 'Analysis complete. Configuration matches expected schema. Key parameters: server port, db connection, log level. Proceeding to implementation.',
            toolCalls: [{ id: 't1', name: 'alix_tool_0', args: { param: '/tmp/x' }, summary: 'reading' }],
            usage: { inputTokens: 500, outputTokens: 50 },
            finishReason: 'tool_calls',
          };
        }
        return { text: 'done.', toolCalls: [], usage: { inputTokens: 100, outputTokens: 50 }, finishReason: 'stop' };
      },
      requests,
    };

    // 3-tool discriminating budget: window=1300, reserved=200, available=1100.
    const budget = createContextBudget(
      { contextWindowTokens: 1_300 },
      { outputFloor: 200, outputCap: 200, outputRatio: 0.15 },
    );

    const { deps } = await makeTestDeps({
      provider: statefulProvider, contextBudget: budget,
      messages: [
        { role: 'user', content: 'First setup: ' + longText(300) },
        { role: 'assistant', content: longText(300) },
        { role: 'user', content: 'Current: fix this' },
      ],
      systemPrompt: 'Helpful. ', maxIterations: 2,
      executor: mockExecutor as any,
      providerTools: makeProviderTools(3),
      selectedTools: [{ name: 'alix_tool_0', execName: 'file.read' }],
    });

    await ensureEncoder('cl100k_base');
    await runTaskLoop(deps);

    // Iteration 2's request should include the ledger in messages.
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const iter2Req = requests[requests.length - 1]!;
    const ledgerMsg = iter2Req.messages.find(
      (m) => m.role === 'user' && (typeof m.content === 'string' ? m.content : '').startsWith('[Progress Ledger]'),
    );
    expect(ledgerMsg).toBeDefined();
    // Narrow for TypeScript — expect().toBeDefined() doesn't propagate.
    const ledgerMsg_ = ledgerMsg!;

    // Money invariant: the padded token estimate of system + messages
    // + tool schema must not exceed the budget. On round-2 code (no tool
    // reservation) this assertion FAILS because the unaccounted tool tokens
    // push the total over availableInputTokens.
    const totalTokens = await estimateTotalRequestTokens(iter2Req, 'cl100k_base');
    expect(totalTokens).toBeLessThanOrEqual(budget.availableInputTokens);

    // I1 gate: the ledger MUST be present in the request. If the ledger
    // were injected AFTER the budget gate (the round-1 I1 bug), it would
    // consume tokens without being counted. The money-invariant assertion
    // above would catch this.
    const ledgerText = typeof ledgerMsg_.content === 'string' ? ledgerMsg_.content : '';
    expect(ledgerText.length).toBeGreaterThan(0);
  });

  // ── Admission order ≠ conversation order (review fix) ──
  // The tier selector may reorder PRIORITY during admission but must never
  // reorder the resulting conversation. reconstructRequest must emit admitted
  // messages in SOURCE order — the tier structure (system, mandatory tasks,
  // ledger, then best-effort tiers) must not leak into conversational
  // chronology. On the pre-fix code the latest instruction was displaced to
  // position 2 (A, E, [ledger], B, C, D); this test pins the correct order.
  it('preserves source conversation order on the wire (admission order ≠ conversation order)', async () => {
    const mockProvider = createMockProvider({ responseText: 'done.' });
    await ensureEncoder('cl100k_base');
    // Huge budget: nothing is dropped; the test isolates ORDERING from
    // selection.
    const budget = createContextBudget({ contextWindowTokens: 1_000_000 }, {});

    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'A: original task' },
      { role: 'assistant', content: 'B: assistant turn 1' },
      { role: 'user', content: 'C: <tool_result id="t1">\nok\n</tool_result>' },
      { role: 'assistant', content: 'D: assistant turn 2' },
      { role: 'user', content: 'E: latest instruction' },
    ];

    const { deps } = await makeTestDeps({
      provider: mockProvider, contextBudget: budget, messages,
      systemPrompt: 'Helpful. ', maxIterations: 1,
    });

    try { await runTaskLoop(deps); } catch { /* budget path may throw */ }

    expect(mockProvider.requests.length).toBe(1);
    const req = mockProvider.requests[0]!;
    const labels = req.messages.map((m) => String(m.content).slice(0, 1)).join('');
    // A,B,C,D,E then the (optional, loop-injected) ledger. The five
    // conversation messages MUST stay in source order — the buggy
    // tier-grouped reconstruction produced A,E,[,B,C,D.
    expect(labels.startsWith('ABCDE')).toBe(true);
  });

  // ── Tool result must not claim the mandatory current-task slot ──
  // A trailing <tool_result> is a `user`-role message on the wire but is
  // execution evidence, NOT a user instruction. On the pre-fix classifier the
  // lastUserIndex scan stopped at the tool result, so the real instruction was
  // demoted to Tier-4 (droppable) and dropped under budget pressure while the
  // tool result survived as mandatory current_task. This test pins the
  // discriminating invariant: the REAL instruction survives, the tool result
  // is best-effort.
  it('does not let a tool result occupy the mandatory current-task slot (tool-result masquerade)', async () => {
    const mockProvider = createMockProvider({ responseText: 'done.', usage: { inputTokens: 100, outputTokens: 50 } });
    await ensureEncoder('cl100k_base');
    // window=1600, available=1400 (mirrors the I3 regression budget).
    const budget = createContextBudget(
      { contextWindowTokens: 1_600 },
      { outputFloor: 200, outputCap: 200, outputRatio: 0.125 },
    );

    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'First: ' + longText(300) },                                 // ~370, Tier-2 (index 0)
      { role: 'assistant', content: 'B: analysis ' + longText(200) },                        // ~365, Tier-4
      { role: 'user', content: 'Current request: ' + longText(300) },                        // ~370, REAL instruction
      { role: 'assistant', content: 'D: done reading' },                                     // small, Tier-4
      { role: 'user', content: '<tool_result id="t1">\n' + longText(300) + '\n</tool_result>' }, // last user, tool result
    ];

    const { deps } = await makeTestDeps({
      provider: mockProvider, contextBudget: budget, messages,
      systemPrompt: 'Helpful. ', maxIterations: 1,
      providerTools: makeProviderTools(3),
    });

    let threwIrreducible = false;
    try { await runTaskLoop(deps); } catch (e) {
      if (e instanceof ContextBudgetOverflowError && !e.reducible) threwIrreducible = true;
    }

    // Must NOT throw irreducible — this is a reducible scenario.
    expect(threwIrreducible).toBe(false);
    expect(mockProvider.requests.length).toBe(1);
    const req = mockProvider.requests[0]!;

    // The REAL current instruction MUST be present (mandatory current_task).
    // On the pre-fix code it is misclassified Tier-4 and dropped.
    const hasRealInstruction = req.messages.some(
      (m) => m.role === 'user' && (typeof m.content === 'string' ? m.content : '').includes('Current request'),
    );
    expect(hasRealInstruction).toBe(true);

    // Money invariant still holds (incl. structured tool schema).
    const totalTokens = await estimateTotalRequestTokens(req, 'cl100k_base');
    expect(totalTokens).toBeLessThanOrEqual(budget.availableInputTokens);
  });
});
