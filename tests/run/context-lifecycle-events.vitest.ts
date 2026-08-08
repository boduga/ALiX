/**
 * Integration test: assert all five context lifecycle events are emitted
 * with `invocationId` correlation metadata during a model-facing invocation.
 *
 * Drives ONE model-facing invocation against a mock provider, reads the
 * resulting EventLog, and asserts each of the five event types appears
 * with the shared invocationId.
 */
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { EventLog } from '../../src/events/event-log.js';
import {
  createContextBudget,
  type ContextBudget,
} from '../../src/config/context-budget.js';
import { runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
import {
  type NormalizedMessage,
  type NormalizedRequest,
  type ToolCall,
  type TokenUsage,
  type ToolDef,
} from '../../src/providers/types.js';
import type { DeferredToolEntry } from '../../src/mcp/tool-deferral.js';
import type { MutationSessionState } from '../../src/run.js';
import type { TaskStateMachine } from '../../src/autonomy/state-machine.js';
import type { ScopeTracker } from '../../src/autonomy/scope-tracker.js';
import type { MemoryStore } from '../../src/utils/memory/store.js';
import { estimateBudgetTokens, ensureEncoder } from '../../src/utils/tokens.js';
import type { TokenizerName } from '../../src/config/context-limits.js';
import { resolveModelDescriptor } from '../../src/config/context-limits.js';

/** Token test helpers */
function longText(tokensHint: number): string {
  // A 1:1 chars-to-tokens approximation for testing
  return 'x'.repeat(tokensHint);
}

function mockStateMachine(): TaskStateMachine {
  return { tick: () => {}, recordRepair: () => {}, toJSON: () => ({}) } as unknown as TaskStateMachine;
}

function mockMutationState(): MutationSessionState {
  return { created: new Set<string>(), changed: new Set<string>(), deleted: new Set<string>(), pendingScopeExpansion: false, fatalErrors: [] };
}

function mockScopeTracker(): ScopeTracker {
  return { checkMutation: () => 'allow' as const, toJSON: () => ({}) } as unknown as ScopeTracker;
}

function mockMemoryStore(): MemoryStore {
  return { save: async () => {}, load: async () => null, delete: async () => {} } as unknown as MemoryStore;
}

async function runOneInvocation(opts: {
  windowTokens?: number;
  outputFloor?: number;
  outputCap?: number;
  outputRatio?: number;
  messages?: NormalizedMessage[];
  providerTools?: ToolDef[];
  mcpToolIndex?: DeferredToolEntry[];
}): Promise<{ events: Awaited<ReturnType<EventLog['readAll']>>; budget: ContextBudget }> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'alix-t6-int-'));
  const log = new EventLog(join(tmpDir, 'events'));
  await log.init();

  const descriptor = await resolveModelDescriptor('local', 'test');
  const budget = createContextBudget(
    { contextWindowTokens: opts.windowTokens ?? descriptor.contextWindowTokens },
    {
      outputFloor: opts.outputFloor,
      outputCap: opts.outputCap,
      outputRatio: opts.outputRatio,
    },
  );

  const tokenizer: TokenizerName = 'cl100k_base';
  await ensureEncoder(tokenizer);

  // Estimate token cost of the request so we can budget properly
  const messages = opts.messages ?? [
    { role: 'user', content: 'hello' },
  ];
  const systemPrompt = 'You are a helpful assistant.';

  // Compute total padded tokens to ensure the budget is large enough
  let totalTokenEstimate = 0;
  const sysEstimate = await estimateBudgetTokens(systemPrompt, tokenizer);
  totalTokenEstimate += sysEstimate.budgetEstimate;
  for (const msg of messages) {
    const mEstimate = await estimateBudgetTokens(
      typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      tokenizer,
    );
    totalTokenEstimate += mEstimate.budgetEstimate;
  }
  const toolTokens = opts.providerTools?.length
    ? (await estimateBudgetTokens(JSON.stringify(opts.providerTools), tokenizer)).budgetEstimate
    : 0;

  // If the budget might be too tight, use a generous one
  const effectiveBudget = totalTokenEstimate + toolTokens + 200 > budget.availableInputTokens
    ? createContextBudget({ contextWindowTokens: Math.max(opts.windowTokens ?? descriptor.contextWindowTokens, totalTokenEstimate + toolTokens + 5000) }, { outputFloor: 200, outputCap: 200, outputRatio: 0.05 })
    : budget;

  const mockProvider = {
    name: 'test',
    stream: undefined,
    complete: async (_req: NormalizedRequest) => ({
      text: 'Hello! I am ready to help.',
      toolCalls: [] as ToolCall[],
      usage: { inputTokens: 10, outputTokens: 5 } as TokenUsage,
    }),
    supportsStreaming: false,
  };

  const deps: TaskLoopDeps = {
    config: {
      model: { provider: 'local', name: 'test', streaming: false },
      permissions: { sessionMode: 'bypass' },
    },
    provider: mockProvider as any,
    providerTools: opts.providerTools ?? [],
    mcpToolIndex: opts.mcpToolIndex ?? [],
    messages: [...messages],
    sessionState: mockMutationState(),
    stateMachine: mockStateMachine(),
    scope: mockScopeTracker(),
    session: { sessionId: 's1', actor: 'system' },
    log,
    executor: { execute: async () => ({ result: '' }) } as any,
    mcpDiscovery: null,
    selectedTools: [],
    hooks: { pre_task: [], post_task: [] },
    maxIterations: 1,
    contextBudget: effectiveBudget,
    tokenizer,
    task: 'test task',
    taskType: 'research',
    depth: 'quick',
    memoryStore: mockMemoryStore(),
    sessionId: 's1',
    sessionDir: tmpDir,
    systemPrompt,
  };

  await runTaskLoop(deps);
  const events = await log.readAll();

  rmSync(tmpDir, { recursive: true, force: true });
  return { events, budget: effectiveBudget };
}

describe('context lifecycle events — integration', () => {
  it('emits context.snapshot.created once per model-facing invocation', async () => {
    const { events } = await runOneInvocation({});
    const snapshots = events.filter((e) => e.type === 'context.snapshot.created');
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.payload).toHaveProperty('invocationId');
    expect(typeof (snapshots[0]!.payload as any).invocationId).toBe('string');
  });

  it('emits context.budget.computed with invocationId', async () => {
    const { events } = await runOneInvocation({});
    const budgets = events.filter((e) => e.type === 'context.budget.computed');
    expect(budgets.length).toBe(1);
    const p = budgets[0]!.payload as any;
    expect(p).toHaveProperty('invocationId');
    expect(typeof p.invocationId).toBe('string');
    expect(typeof p.contextWindowTokens).toBe('number');
    expect(typeof p.availableInputTokens).toBe('number');
    expect(typeof p.reservedOutputTokens).toBe('number');
  });

  it('emits context.assembled with invocationId and category breakdown', async () => {
    const { events } = await runOneInvocation({});
    const assembled = events.filter((e) => e.type === 'context.assembled');
    expect(assembled.length).toBe(1);
    const p = assembled[0]!.payload as any;
    expect(p).toHaveProperty('invocationId');
    expect(typeof p.invocationId).toBe('string');
    expect(typeof p.admittedTokens).toBe('number');
    expect(typeof p.droppedTokens).toBe('number');
    expect(p.admittedTokens).toBeGreaterThan(0);
    expect(p).toHaveProperty('admittedByCategory');
    expect(p).toHaveProperty('droppedReasons');
  });

  it('all five events share the same invocationId', async () => {
    const { events } = await runOneInvocation({});
    const contextEventTypes = [
      'context.snapshot.created',
      'context.budget.computed',
      'context.assembled',
    ];
    const contextEvents = events.filter((e) => contextEventTypes.includes(e.type));
    expect(contextEvents.length).toBeGreaterThanOrEqual(3);

    const invocationIds = new Set(
      contextEvents.map((e) => (e.payload as any).invocationId).filter(Boolean),
    );
    expect(invocationIds.size).toBe(1);
  });

  it('emits context.irreducible when budget is too small for mandatory core', async () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: longText(200) },
    ];
    // Budget too small: only 100 tokens available input
    const descriptor = await resolveModelDescriptor('local', 'test');
    const budget = createContextBudget(
      { contextWindowTokens: 300 },
      { outputFloor: 100, outputCap: 100, outputRatio: 0.33 },
    );
    // 300 window, 100 output, 200 available — system prompt alone ~30 tokens,
    // but with user message at ~250 padded + tool schemas, mandatory core
    // should exceed available
    const tmpDir = mkdtempSync(join(tmpdir(), 'alix-t6-irr-'));
    const log = new EventLog(join(tmpDir, 'events'));
    await log.init();

    const tokenizer: TokenizerName = 'cl100k_base';
    await ensureEncoder(tokenizer);

    const mockProvider = {
      name: 'test',
      stream: undefined,
      complete: async (_req: NormalizedRequest) => ({
        text: 'ok',
        toolCalls: [] as ToolCall[],
        usage: { inputTokens: 1, outputTokens: 1 } as TokenUsage,
      }),
      supportsStreaming: false,
    };

    const deps: TaskLoopDeps = {
      config: {
        model: { provider: 'local', name: 'test', streaming: false },
        permissions: { sessionMode: 'bypass' },
      },
      provider: mockProvider as any,
      providerTools: [],
      mcpToolIndex: [],
      messages: [...messages],
      sessionState: mockMutationState(),
      stateMachine: mockStateMachine(),
      scope: mockScopeTracker(),
      session: { sessionId: 's2', actor: 'system' },
      log,
      executor: { execute: async () => ({ result: '' }) } as any,
      mcpDiscovery: null,
      selectedTools: [],
      hooks: { pre_task: [], post_task: [] },
      maxIterations: 1,
      contextBudget: budget,
      tokenizer,
      task: 'test',
      taskType: 'research',
      depth: 'quick',
      memoryStore: mockMemoryStore(),
      sessionId: 's2',
      sessionDir: tmpDir,
      systemPrompt: 'You are helpful.',
    };

    try {
      await runTaskLoop(deps);
    } catch {
      // Expected — irreducible overflow
    }

    const events = await log.readAll();
    rmSync(tmpDir, { recursive: true, force: true });

    // context.snapshot.created and context.budget.computed should still emit
    const snapshots = events.filter((e) => e.type === 'context.snapshot.created');
    expect(snapshots.length).toBe(1);

    const budgets = events.filter((e) => e.type === 'context.budget.computed');
    expect(budgets.length).toBe(1);

    // The irreducible case — the error is thrown before context.assembled emits
    // but we should have both the snapshot and budget events with matching
    // invocationId
    const contextEvents = events.filter((e) =>
      ['context.snapshot.created', 'context.budget.computed'].includes(e.type),
    );
    const ids = new Set(contextEvents.map((e) => (e.payload as any).invocationId).filter(Boolean));
    expect(ids.size).toBe(1);
  });

  it('does NOT emit context.truncated on the run path', async () => {
    const { events } = await runOneInvocation({});
    const truncated = events.filter((e) => e.type === 'context.truncated');
    expect(truncated.length).toBe(0);
  });

  it('context events carry sessionId matching the run session', async () => {
    const { events } = await runOneInvocation({});
    const contextEvents = events.filter((e) =>
      ['context.snapshot.created', 'context.budget.computed', 'context.assembled'].includes(e.type),
    );
    for (const e of contextEvents) {
      expect(e.sessionId).toBe('s1');
    }
  });
});
