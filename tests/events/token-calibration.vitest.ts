/**
 * Task 3 (§1) integration test: `token.calibration` event emission.
 *
 * Verifies the model-facing request emits token.calibration keyed by
 * invocationId, comparing our estimatedRaw (unpadded base), estimatedPadded
 * (budget-admission), and the provider's actual usage.inputTokens.
 *
 * Seam: same mock-provider harness as task-loop-context-budget.vitest.ts
 * (mock provider RECORDS the request, real EventLog on tmpdir).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
import { createContextBudget } from '../../src/config/context-budget.js';
import type { ContextBudget } from '../../src/config/context-budget.js';
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
}): Promise<{ deps: TaskLoopDeps; log: EventLog; sessionId: string }> {
  const tmpRoot = makeTempDir('alix-cal-');
  const sessionId = 'cal-test';
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
      models: { default: { provider: 'mock', name: 'mock' } },
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
    executor: {} as any,
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

  return { deps, log, sessionId };
}

/** Run the task loop once through the mock provider (default actual usage
 *  inputTokens = 42) and return the log + recorded requests. */
async function runOnceWithProvider(opts?: { usage?: TokenUsage }): Promise<{
  log: EventLog;
  sessionId: string;
  mockProvider: ModelAdapter & { requests: RecordedRequest[] };
}> {
  const mockProvider = createMockProvider({
    responseText: 'done. Task completed.',
    usage: opts?.usage ?? { inputTokens: 42, outputTokens: 0 },
  });
  const budget = createContextBudget(
    { contextWindowTokens: 100_000 },
    { outputRatio: 0.2, outputFloor: 4096, outputCap: 32768 },
  );
  const { deps, log, sessionId } = await makeTestDeps({
    provider: mockProvider,
    contextBudget: budget,
    messages: [{ role: 'user', content: 'hello' }],
    maxIterations: 1,
  });
  await runTaskLoop(deps);
  return { log, sessionId, mockProvider };
}

// ── Tests ──────────────────────────────────────────────────────────────
describe('token.calibration — estimated vs actual per model-facing request', () => {
  it('emits token.calibration with estimated vs actual per request', async () => {
    const { log } = await runOnceWithProvider();
    const events = await log.readAll();
    const cal = events.find((e) => e.type === 'token.calibration');
    expect(cal).toBeDefined();
    const p = cal!.payload as Record<string, unknown>;
    expect(typeof p.estimatedRaw).toBe('number');
    expect(typeof p.estimatedPadded).toBe('number');
    expect(p.actual).toBe(42);
    expect(typeof p.invocationId).toBe('string');
    expect(p.provider).toBe('mock');
  });

  it('uses the same invocationId as context.snapshot.created', async () => {
    const { log } = await runOnceWithProvider();
    const events = await log.readAll();
    const snapshot = events.find((e) => e.type === 'context.snapshot.created');
    const cal = events.find((e) => e.type === 'token.calibration');
    expect(cal).toBeDefined();
    expect(snapshot).toBeDefined();
    const snapPayload = snapshot!.payload as Record<string, unknown>;
    const calPayload = cal!.payload as Record<string, unknown>;
    expect(calPayload.invocationId).toBe(snapPayload.invocationId);
  });
});
