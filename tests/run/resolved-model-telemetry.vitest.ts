import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
import { createContextBudget } from '../../src/config/context-budget.js';
import type { ContextBudget } from '../../src/config/context-budget.js';
import type { ModelAdapter, NormalizedRequest, NormalizedResponse, NormalizedMessage, TokenUsage } from '../../src/providers/types.js';
import { TaskStateMachine, RunLimiter } from '../../src/autonomy/state-machine.js';
import { ScopeTracker } from '../../src/autonomy/scope-tracker.js';
import { MemoryStore } from '../../src/utils/memory/store.js';
import type { MutationSessionState } from '../../src/run.js';

function createResolvedModelProvider(opts: { resolvedModel?: string; usage?: TokenUsage; streaming?: boolean }): ModelAdapter {
  const usage = opts.usage ?? { inputTokens: 100, outputTokens: 50 };
  const complete = async (): Promise<NormalizedResponse> => ({
    text: 'done. Task completed.',
    toolCalls: [],
    usage,
    finishReason: 'stop',
    ...(opts.resolvedModel ? { resolvedModel: opts.resolvedModel } : {}),
  });
  return {
    id: 'mock',
    capabilities: {
      provider: 'mock', model: 'mock', inputTokenLimit: 100_000, outputTokenLimit: 16_384,
      supportsTools: true, supportsStreaming: !!opts.streaming, supportsStructuredOutput: false, supportsVision: false,
    },
    editFormatPreference: 'search_replace',
    longContextStrategy: 'trimmed_context',
    complete,
    ...(opts.streaming ? {
      async *stream(_req: NormalizedRequest): AsyncGenerator<import('../../src/providers/types.js').StreamChunk> {
        yield { type: 'text_delta', text: 'done. Task completed.' };
        yield { type: 'usage', usage };
        if (opts.resolvedModel) yield { type: 'done', resolvedModel: opts.resolvedModel };
        else yield { type: 'done' };
      },
    } : {}),
  };
}

async function makeTestDeps(overrides: { provider: ModelAdapter; contextBudget: ContextBudget; messages: NormalizedMessage[]; streaming?: boolean }): Promise<{ deps: TaskLoopDeps; log: EventLog }> {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'alix-tel-'));
  const sessionId = 'tel-test';
  const sessionDir = join(tmpRoot, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const memoryStore = new MemoryStore(join(tmpRoot, 'memory'));
  await memoryStore.init();
  const log = new EventLog(join(tmpRoot, 'events'));
  await log.init();
  const sessionState: MutationSessionState = {
    created: new Set(), deleted: new Set(), changed: new Set(),
    fatalErrors: [], pendingScopeExpansion: false,
  };
  const scope = new ScopeTracker();
  const stateMachine = new TaskStateMachine(new RunLimiter({
    maxIterations: 1, maxRepairs: 3, maxFileChanges: 100, maxShellCommands: 50, maxRuntimeMs: 60_000,
  }));
  const deps: TaskLoopDeps = {
    config: { models: { default: { provider: 'mock', name: 'mock', streaming: overrides.streaming ?? false } }, permissions: {}, context: {} },
    provider: overrides.provider,
    providerTools: [],
    mcpToolIndex: [],
    messages: overrides.messages,
    sessionState,
    stateMachine,
    scope,
    session: { sessionId, actor: 'system' as const },
    log,
    executor: {} as any,
    mcpDiscovery: null,
    selectedTools: [],
    hooks: {},
    maxIterations: 1,
    contextBudget: overrides.contextBudget,
    tokenizer: 'cl100k_base',
    task: 'test task',
    taskType: 'docs',
    depth: 'quick',
    memoryStore,
    sessionId,
    sessionDir,
    systemPrompt: 'You are a test assistant.',
  };
  return { deps, log };
}

const budget = () => createContextBudget({ contextWindowTokens: 100_000 }, { outputRatio: 0.2, outputFloor: 4096, outputCap: 32768 });

describe('resolved-model telemetry in the task loop', () => {
  it('populates model.usage.resolvedModel and the resolved_model metric label (complete path)', async () => {
    const provider = createResolvedModelProvider({ resolvedModel: 'qwen/qwen3-14b:free' });
    const { deps, log } = await makeTestDeps({ provider, contextBudget: budget(), messages: [{ role: 'user', content: 'go' }] });

    await runTaskLoop(deps);

    const { events } = await log.readSince(log.beginningCursor());
    const usageEvents = events.filter((e) => e.type === 'model.usage');
    expect(usageEvents.length).toBeGreaterThan(0);
    expect((usageEvents[0]!.payload as { resolvedModel: string }).resolvedModel).toBe('qwen/qwen3-14b:free');

    const metrics = events.filter((e) => e.type === 'm09.metric');
    const calls = metrics.map((m) => m.payload as { name: string; labels?: Record<string, string> }).filter((p) => p.name === 'model_calls_total');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.labels?.resolved_model).toBe('qwen/qwen3-14b:free');
  });

  it('omits resolvedModel fields when absent (unchanged events)', async () => {
    const provider = createResolvedModelProvider({});
    const { deps, log } = await makeTestDeps({ provider, contextBudget: budget(), messages: [{ role: 'user', content: 'go' }] });

    await runTaskLoop(deps);

    const { events } = await log.readSince(log.beginningCursor());
    const usageEvents = events.filter((e) => e.type === 'model.usage');
    expect(usageEvents.length).toBeGreaterThan(0);
    expect('resolvedModel' in (usageEvents[0]!.payload as Record<string, unknown>)).toBe(false);

    const metrics = events.filter((e) => e.type === 'm09.metric');
    const calls = metrics.map((m) => m.payload as { name: string; labels?: Record<string, string> }).filter((p) => p.name === 'model_calls_total');
    expect(calls.length).toBeGreaterThan(0);
    expect('resolved_model' in (calls[0]!.labels ?? {})).toBe(false);
  });

  it('threads resolvedModel through the streaming path', async () => {
    const provider = createResolvedModelProvider({ resolvedModel: 'qwen/qwen3-14b:free', streaming: true });
    const { deps, log } = await makeTestDeps({ provider, contextBudget: budget(), messages: [{ role: 'user', content: 'go' }], streaming: true });

    await runTaskLoop(deps);

    const { events } = await log.readSince(log.beginningCursor());
    const usageEvents = events.filter((e) => e.type === 'model.usage');
    expect(usageEvents.length).toBeGreaterThan(0);
    expect((usageEvents[0]!.payload as { resolvedModel: string }).resolvedModel).toBe('qwen/qwen3-14b:free');
  });
});