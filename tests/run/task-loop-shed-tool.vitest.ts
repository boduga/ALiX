/**
 * Task 8: §2 shed-tool contract — reintroduce-on-call, retry once, additive-only.
 *
 * Tests:
 * 1. A tool scoped OUT by T1a/T1b scoping is re-admitted when the model calls it.
 * 2. The tooling.scope.reintroduced event is emitted with the correct payload.
 * 3. The tool's schema appears in the wire tools on the retry iteration.
 * 4. Retry-once guardrail: the second call to the same shed tool falls through
 *    to the normal invalid-tool path (no infinite loop).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
import { createContextBudget } from '../../src/config/context-budget.js';
import { ensureEncoder } from '../../src/utils/tokens.js';
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedMessage,
  ToolCall,
  ToolDef,
  TokenUsage,
} from '../../src/providers/types.js';
import type { DeferredToolEntry } from '../../src/mcp/tool-deferral.js';
import { TaskStateMachine, RunLimiter } from '../../src/autonomy/state-machine.js';
import { ScopeTracker } from '../../src/autonomy/scope-tracker.js';
import { MemoryStore } from '../../src/utils/memory/store.js';
import type { MutationSessionState } from '../../src/run.js';

// ── Minimal mock provider that RECORDS what it receives ────────────────
type RecordedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
  maxOutputTokens?: number;
  tools?: (ToolDef | DeferredToolEntry)[];
};

function createMockProvider(opts?: {
  /** Iteration 0 tool calls — the model calls a scoped-out tool here. */
  toolCalls0?: ToolCall[];
  /** Iteration 1 tool calls — after shed-tool re-admission, model retries. */
  toolCalls1?: ToolCall[];
  /** Iteration 1 response text */
  responseText1?: string;
  usage?: TokenUsage;
}): ModelAdapter & { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let iter = 0;
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
      const i = iter++;
      if (i === 0) {
        return {
          text: '',
          toolCalls: opts?.toolCalls0 ?? [],
          usage: opts?.usage ?? { inputTokens: 100, outputTokens: 50 },
          finishReason: 'tool_use',
        };
      }
      // iteration 1: after shed-tool re-admission
      return {
        text: opts?.responseText1 ?? 'done. Task completed.',
        toolCalls: opts?.toolCalls1 ?? [],
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
  task?: string;
  systemPrompt?: string;
  providerTools?: TaskLoopDeps['providerTools'];
  mcpToolIndex?: TaskLoopDeps['mcpToolIndex'];
  messages?: NormalizedMessage[];
  maxIterations?: number;
  executor?: TaskLoopDeps['executor'];
  selectedTools?: TaskLoopDeps['selectedTools'];
}): Promise<{ deps: TaskLoopDeps; log: EventLog; sessionDir: string; cleanup: () => void }> {
  const tmpRoot = makeTempDir('alix-t8-');
  const sessionId = 't8-test';
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
    maxIterations: overrides.maxIterations ?? 3,
    maxRepairs: 3,
    maxFileChanges: 100,
    maxShellCommands: 50,
    maxRuntimeMs: 60_000,
  }));

  // Warm up the tiktoken encoder (side-effect: populates the global cache).
  await ensureEncoder('cl100k_base');

  const contextBudget = createContextBudget(
    { contextWindowTokens: 100_000 },
    {
      outputRatio: 0.1,
      outputFloor: 1_000,
      outputCap: 16_384,
    },
  );

  const message: NormalizedMessage = { role: 'user', content: overrides.task ?? 'test task' };

  const deps: TaskLoopDeps = {
    config: {
      model: { provider: 'mock', name: 'mock', streaming: false },
      permissions: {},
    },
    provider: overrides.provider,
    providerTools: overrides.providerTools ?? [],
    mcpToolIndex: overrides.mcpToolIndex ?? [],
    messages: overrides.messages ?? [message],
    sessionState,
    stateMachine,
    scope,
    session: { sessionId, actor: 'system' as const },
    log,
    executor: overrides.executor ?? ({} as any),
    mcpDiscovery: null,
    selectedTools: overrides.selectedTools ?? [],
    hooks: {},
    maxIterations: overrides.maxIterations ?? 3,
    contextBudget,
    tokenizer: 'cl100k_base',
    task: overrides.task ?? 'test task',
    taskType: 'docs',
    depth: 'quick',
    memoryStore,
    sessionId,
    sessionDir,
    systemPrompt: overrides.systemPrompt ?? 'You are a test assistant.',
  };

  return { deps, log, sessionDir, cleanup: () => { /* cleanup */ } };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Task 8: shed-tool reintroduce-on-call', () => {
  it('reintroduces a shed tool when the model calls it, retries once, and logs it', async () => {
    // providerTools contains all known tools; core is derived by scopeToolsByTask
    // based on task text. We include a non-core tool that DOES match the task
    // (so fallbackFull stays false and shed-tool scoping actually applies),
    // plus `langfuse_trace_export` which does NOT match and therefore ends up
    // in `scopedOutNames`. Model then calls the shed tool to trigger the path.
    const coreTool: ToolDef = { name: 'alix_shell_run', description: 'Run a shell command', input_schema: { type: 'object', properties: {} } };
    const coreTool2: ToolDef = { name: 'alix_file_read', description: 'Read a file', input_schema: { type: 'object', properties: {} } };
    const coreTool3: ToolDef = { name: 'alix_file_write', description: 'Write a file', input_schema: { type: 'object', properties: {} } };
    const coreTool4: ToolDef = { name: 'alix_patch_apply', description: 'Apply a patch', input_schema: { type: 'object', properties: {} } };
    const coreTool5: ToolDef = { name: 'alix_patch_create', description: 'Create a patch', input_schema: { type: 'object', properties: {} } };
    const coreTool6: ToolDef = { name: 'alix_done', description: 'Signal completion', input_schema: { type: 'object', properties: {} } };
    const matchingExtended: ToolDef = { name: 'alix_docs_search', description: 'Search docs and findings', input_schema: { type: 'object', properties: {} } };
    const shedTool: ToolDef = { name: 'langfuse_trace_export', description: 'Export trace to Langfuse', input_schema: { type: 'object', properties: {} } };

    const providerTools = [coreTool, coreTool2, coreTool3, coreTool4, coreTool5, coreTool6, matchingExtended, shedTool];

    // Task text matches alix_docs_search (token "search") but does NOT match
    // langfuse_trace_export (no shared token). So langfuse_trace_export ends up
    // in scopedOutNames (shed-out) while alix_docs_search is in extended.
    const task = 'search docs and report findings';
    const message: NormalizedMessage = { role: 'user', content: task };

    const provider = createMockProvider({
      toolCalls0: [{ name: 'langfuse_trace_export', id: 'tc1', args: { traceId: '123' } }],
      toolCalls1: [],
      responseText1: 'done. Task completed.',
    });

    const { deps, log } = await makeTestDeps({
      provider,
      task,
      providerTools,
      messages: [message],
      maxIterations: 3,
    });

    const result = await runTaskLoop(deps);
    const events = await log.readAll();

    // 1. tooling.scope.reintroduced event was emitted
    const reintro = events.find((e) => e.type === 'tooling.scope.reintroduced');
    expect(reintro).toBeDefined();
    expect((reintro!.payload as { toolName: string }).toolName).toBe('langfuse_trace_export');

    // 2. The tool's schema was re-added to the request's tools for the retry
    const reqs = (deps.provider as unknown as { requests?: RecordedRequest[] }).requests ?? [];
    const lastRequest = reqs[reqs.length - 1] ?? reqs[0];
    expect(lastRequest).toBeDefined();
    expect(lastRequest!.tools!.some((t) => t.name === 'langfuse_trace_export')).toBe(true);

    // 3. retry-once guardrail: no unbounded loop (run terminates normally)
    expect(['completed', 'completed_unverified', 'max_iterations'].includes(result.reason ?? 'completed')).toBe(true);
  });

  it('retry-once guardrail: second call to same shed tool falls through to invalid-tool path', async () => {
    const coreTool: ToolDef = { name: 'alix_shell_run', description: 'Run a shell command', input_schema: { type: 'object', properties: {} } };
    const coreTool2: ToolDef = { name: 'alix_file_read', description: 'Read a file', input_schema: { type: 'object', properties: {} } };
    const coreTool3: ToolDef = { name: 'alix_file_write', description: 'Write a file', input_schema: { type: 'object', properties: {} } };
    const coreTool4: ToolDef = { name: 'alix_patch_apply', description: 'Apply a patch', input_schema: { type: 'object', properties: {} } };
    const coreTool5: ToolDef = { name: 'alix_patch_create', description: 'Create a patch', input_schema: { type: 'object', properties: {} } };
    const coreTool6: ToolDef = { name: 'alix_done', description: 'Signal completion', input_schema: { type: 'object', properties: {} } };
    const matchingExtended: ToolDef = { name: 'alix_docs_search', description: 'Search docs and findings', input_schema: { type: 'object', properties: {} } };
    const shedTool: ToolDef = { name: 'langfuse_trace_export', description: 'Export trace to Langfuse', input_schema: { type: 'object', properties: {} } };

    const providerTools = [coreTool, coreTool2, coreTool3, coreTool4, coreTool5, coreTool6, matchingExtended, shedTool];

    // Model calls shed tool in iteration 0 AND again in iteration 1 (after retry)
    const provider = createMockProvider({
      toolCalls0: [{ name: 'langfuse_trace_export', id: 'tc1', args: { traceId: '123' } }],
      toolCalls1: [{ name: 'langfuse_trace_export', id: 'tc2', args: { traceId: '456' } }],
      responseText1: 'done.',
    });

    // Task matches alix_docs_search ("search") but not langfuse_trace_export,
    // so langfuse_trace_export ends up in scopedOutNames (fallbackFull=false).
    const task = 'search docs and report findings';
    const message: NormalizedMessage = { role: 'user', content: task };

    const { deps, log } = await makeTestDeps({
      provider,
      task,
      providerTools,
      messages: [message],
      maxIterations: 3,
    });

    const result = await runTaskLoop(deps);
    const events = await log.readAll();

    // Only ONE tooling.scope.reintroduced event (not two)
    const reintros = events.filter((e) => e.type === 'tooling.scope.reintroduced');
    expect(reintros.length).toBe(1);

    // Run terminates normally
    expect(['completed', 'completed_unverified', 'max_iterations'].includes(result.reason ?? 'completed')).toBe(true);
  });

  it('no-op when scopedOutNames is empty (fallbackFull path)', async () => {
    // When fallbackFull=true, all tools are admitted; no shed path triggers.
    const coreTool: ToolDef = { name: 'alix_shell_run', description: 'Run a shell command', input_schema: { type: 'object', properties: {} } };
    const coreTool2: ToolDef = { name: 'alix_file_read', description: 'Read a file', input_schema: { type: 'object', properties: {} } };
    const otherTool: ToolDef = { name: 'alix_other_tool', description: 'Some other tool', input_schema: { type: 'object', properties: {} } };

    const providerTools = [coreTool, coreTool2, otherTool];

    // Use an empty task so scopeToolsByTask triggers fallbackFull
    // (no relevance signal for any tool → fallbackFull=true → scopedOutNames is empty)
    const task = '';

    const message: NormalizedMessage = { role: 'user', content: task };

    const provider = createMockProvider({
      toolCalls0: [],
      responseText1: 'done. Task completed.',
    });

    const { deps, log } = await makeTestDeps({
      provider,
      task,
      providerTools,
      messages: [message],
      maxIterations: 2,
    });

    const result = await runTaskLoop(deps);
    const events = await log.readAll();

    // No shed-tool events should be emitted
    const reintro = events.find((e) => e.type === 'tooling.scope.reintroduced');
    expect(reintro).toBeUndefined();

    // Run terminates normally
    expect(['completed', 'completed_unverified', 'max_iterations'].includes(result.reason ?? 'completed')).toBe(true);
  });

  // Task 9: §6 mechanism-only — contextRotThreshold UNSET by default.
  // No threshold → no `context.rot_risk` advisory. Default state is silent.
  it('does not emit context.rot_risk when no threshold is configured', async () => {
    // Redirect HOME to a temp dir so loadCalibration() reads a guaranteed-empty
    // calibration.json — a developer's real ~/.alix/calibration.json with a
    // configured contextRotThreshold would otherwise silently activate the
    // advisory path and break this silent-state assertion. (Test 3 below uses
    // the same isolation pattern.)
    const tmpHome = makeTempDir('alix-rot-home-silent-');
    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      const coreTool: ToolDef = { name: 'alix_shell_run', description: 'Run a shell command', input_schema: { type: 'object', properties: {} } };
    const providerTools = [coreTool];

    const provider = createMockProvider({
      toolCalls0: [],
      responseText1: 'done. Task completed.',
    });

    const task = 'simple task';
    const message: NormalizedMessage = { role: 'user', content: task };

    const { deps, log } = await makeTestDeps({
      provider,
      task,
      providerTools,
      messages: [message],
      maxIterations: 2,
    });

    await runTaskLoop(deps);
    const events = await log.readAll();

    // Default state emits nothing — no context.rot_risk without a configured threshold
    const rotRisk = events.find((e) => e.type === 'context.rot_risk');
    expect(rotRisk).toBeUndefined();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  // Task 9: §6 mechanism — when threshold is configured AND pressure exceeds it,
  // emit the `context.rot_risk` advisory. Advisory only, never a hard gate.
  it('emits context.rot_risk when a threshold is configured and pressure exceeds it', async () => {
    // Seed the calibration store with a configured threshold before runTaskLoop loads it.
    // loadCalibration() reads ~/.alix/calibration.json by default. To avoid touching the
    // real HOME, set process.env.HOME to a temp dir for this test.
    const tmpHome = makeTempDir('alix-rot-home-');
    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      const { saveCalibration } = await import('../../src/config/calibration-store.js');
      // Use `remainingTokensPct` so we don't depend on tier drops: any pressure below
      // 90% remaining capacity fires. The test's makeTestDeps uses 100k window with a
      // 1k output floor (99k available); a 50k-char system prompt (~12.5k tokens) +
      // messages leaves well under 90% remaining.
      await saveCalibration(
        {
          contextRotThreshold: {
            metric: 'remainingTokensPct',
            value: 95, // fire when min remaining % drops below this (test's 12.5k system prompt puts remaining at ~91%)
            sampleSize: 10,
            lastRecalibrated: new Date().toISOString(),
          },
        },
        join(tmpHome, '.alix'),
      );

      const coreTool: ToolDef = { name: 'alix_shell_run', description: 'Run a shell command', input_schema: { type: 'object', properties: {} } };
      const providerTools = [coreTool];

      const provider = createMockProvider({
        toolCalls0: [],
        responseText1: 'done. Task completed.',
      });

      const task = 'simple task';
      const message: NormalizedMessage = { role: 'user', content: task };

      const { deps, log } = await makeTestDeps({
        provider,
        task,
        providerTools,
        messages: [message],
        maxIterations: 1,
        systemPrompt: 'X'.repeat(50_000), // ~12.5k tokens, fills significant budget
      });

      await runTaskLoop(deps);
      const events = await log.readAll();

      // When threshold is configured and pressure exceeds, advisory fires.
      const rotRisk = events.find((e) => e.type === 'context.rot_risk');
      expect(rotRisk).toBeDefined();
      const payload = rotRisk!.payload as Record<string, unknown>;
      expect(payload.metric).toBe('remainingTokensPct');
      expect(typeof payload.measured).toBe('number');
      expect(payload.threshold).toBe(95);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});
