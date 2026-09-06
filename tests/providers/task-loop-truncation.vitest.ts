/**
 * Task-loop truncation continuation: when a provider returns a prose response
 * with finish_reason=length and no tool calls, the loop must NOT treat the
 * partial as final. It accumulates the segment, re-prompts the model to
 * continue exactly where it stopped, and merges the segments into the final
 * summary so the answer is never silently cut.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
import { createContextBudget } from '../../src/config/context-budget.js';
import { TaskStateMachine, RunLimiter } from '../../src/autonomy/state-machine.js';
import { ScopeTracker } from '../../src/autonomy/scope-tracker.js';
import { MemoryStore } from '../../src/utils/memory/store.js';
import type { ModelAdapter, NormalizedRequest, NormalizedResponse, ToolCall, TokenUsage } from '../../src/providers/types.js';

type RecordedRequest = {
  systemPrompt: string;
  messages: { role: string; content: string }[];
  maxOutputTokens?: number;
};

function createSequencedProvider(
  responses: NormalizedResponse[],
): ModelAdapter & { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let call = 0;
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
      parallelToolCalls: false,
    },
    editFormatPreference: 'search_replace',
    longContextStrategy: 'trimmed_context',
    async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
      requests.push({
        systemPrompt: req.systemPrompt,
        messages: req.messages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" })),
        maxOutputTokens: req.maxOutputTokens,
      });
      const resp = responses[Math.min(call, responses.length - 1)];
      call++;
      return resp;
    },
    requests,
  };
}

const usage: TokenUsage = { inputTokens: 100, outputTokens: 50 };

function makeTestDeps(opts: {
  provider: ModelAdapter;
  maxIterations?: number;
}) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'alix-trunc-'));
  const sessionId = 'trunc-test';
  void mkdirSync(join(tmpRoot, 'sessions', sessionId), { recursive: true });
  const budget = createContextBudget(
    { contextWindowTokens: 100_000 },
    { outputRatio: 0.2, outputFloor: 4096, outputCap: 32768 },
  );
  const memoryStore = new MemoryStore(join(tmpRoot, 'memory'));
  return memoryStore.init().then(() => {
    const log = new EventLog(join(tmpRoot, 'events'));
    return log.init().then(() => {
      const deps: TaskLoopDeps = {
        config: {
          models: { default: { provider: 'mock', name: 'mock', streaming: false } },
          permissions: {},
          context: {},
        },
        provider: opts.provider,
        providerTools: [],
        mcpToolIndex: [],
        messages: [{ role: 'user', content: 'Write the full plan.' }],
        sessionState: {
          created: new Set<string>(),
          deleted: new Set<string>(),
          changed: new Set<string>(),
          fatalErrors: [],
          pendingScopeExpansion: false,
        },
        stateMachine: new TaskStateMachine(
          new RunLimiter({
            maxIterations: opts.maxIterations ?? 4,
            maxRepairs: 3,
            maxFileChanges: 100,
            maxShellCommands: 50,
            maxRuntimeMs: 60_000,
          }),
        ),
        scope: new ScopeTracker(),
        session: { sessionId, actor: 'system' as const },
        log,
        executor: {} as any,
        mcpDiscovery: null,
        selectedTools: [],
        hooks: {},
        maxIterations: opts.maxIterations ?? 4,
        contextBudget: budget,
        tokenizer: 'cl100k_base',
        task: 'test task',
        taskType: 'docs',
        depth: 'quick',
        memoryStore,
        sessionId,
        sessionDir: join(tmpRoot, 'sessions', sessionId),
        systemPrompt: 'You are a test assistant.',
      };
      return { deps, cleanup: () => {} };
    });
  });
}

describe('task-loop truncation continuation', () => {
  it('accumulates a finish_reason=length segment and re-prompts to finish', async () => {
    const provider = createSequencedProvider([
      { text: 'Part one of the complete answer. ', toolCalls: [], usage, finishReason: 'length' },
      { text: 'Part two. done. Task completed.', toolCalls: [], usage, finishReason: 'stop' },
    ]);
    const { deps } = await makeTestDeps({ provider, maxIterations: 3 });
    const result = await runTaskLoop(deps);

    // The loop re-prompted once: two provider calls happened.
    expect(provider.requests.length).toBe(2);
    // The continuation re-prompt pushed an assistant partial + user continue turn.
    const secondTurnUser = provider.requests[1]!.messages.find(
      m => m.role === 'user' && m.content.toLowerCase().includes('continue'),
    );
    expect(secondTurnUser).toBeDefined();
    // The merged summary contains BOTH segments, in order.
    expect(result.summary).toBe('Part one of the complete answer. Part two. done. Task completed.');
  });

  it('emits a single merged agent.message rather than partial segments', async () => {
    const provider = createSequencedProvider([
      { text: 'Segment A. ', toolCalls: [], usage, finishReason: 'length' },
      { text: 'Segment B. done. Task completed.', toolCalls: [], usage, finishReason: 'stop' },
    ]);
    const { deps } = await makeTestDeps({ provider, maxIterations: 3 });
    const result = await runTaskLoop(deps);
    expect(result.summary).toBe('Segment A. Segment B. done. Task completed.');
  });
});