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
import { explicitMutationTargets, objectiveEvidenceRequirements, runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
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
      parallelToolCalls: false,
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
  taskType?: TaskLoopDeps['taskType'];
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
      models: { default: { provider: 'mock', name: 'mock', streaming: false } },
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
    taskType: overrides.taskType ?? 'docs',
    depth: 'quick',
    memoryStore,
    sessionId,
    sessionDir,
    systemPrompt: overrides.systemPrompt ?? 'You are a test assistant.',
  };

  return { deps, log, sessionDir, cleanup: () => { /* cleanup */ } };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('explicit mutation target extraction', () => {
  it('recognizes strict named and absolute-path file tasks', () => {
    expect(explicitMutationTargets('Create a file named note.md.')).toEqual(['note.md']);
    expect(explicitMutationTargets('Create /tmp/outside.txt containing "blocked".')).toEqual(['/tmp/outside.txt']);
    expect(explicitMutationTargets('Create `/tmp/quoted.txt` containing "blocked".')).toEqual(['/tmp/quoted.txt']);
  });

  it('does not constrain broad repository tasks', () => {
    expect(explicitMutationTargets('Inspect this repository and improve its documentation.')).toEqual([]);
  });
});

describe('Task 8: shed-tool reintroduce-on-call', () => {
  it('reintroduces a shed tool when the model calls it, retries once, and logs it', async () => {
    // providerTools contains all known tools; core is derived by scopeToolsByTask
    // based on task text. We include a non-core tool that DOES match the task
    // (so fallbackFull stays false and shed-tool scoping actually applies),
    // plus `langfuse_trace_export` which does NOT match and therefore ends up
    // in `scopedOutNames`. Model then calls the shed tool to trigger the path.
    const coreTool: ToolDef = { name: 'alix_shell_run', description: 'Run a shell command', input_schema: { type: 'object', properties: {} } };
    const coreTool2: ToolDef = { name: 'alix_file_read', description: 'Read a file', input_schema: { type: 'object', properties: {} } };
    const coreTool4: ToolDef = { name: 'alix_patch_apply', description: 'Apply a patch', input_schema: { type: 'object', properties: {} } };
    const coreTool5: ToolDef = { name: 'alix_patch_create', description: 'Create a patch', input_schema: { type: 'object', properties: {} } };
    const coreTool6: ToolDef = { name: 'alix_done', description: 'Signal completion', input_schema: { type: 'object', properties: {} } };
    const matchingExtended: ToolDef = { name: 'alix_docs_search', description: 'Search docs and findings', input_schema: { type: 'object', properties: {} } };
    const shedTool: ToolDef = { name: 'langfuse_trace_export', description: 'Export trace to Langfuse', input_schema: { type: 'object', properties: {} } };

    const providerTools = [coreTool, coreTool2, coreTool4, coreTool5, coreTool6, matchingExtended, shedTool];

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

    // 2b. Final-review fix: the systemPrompt MUST advertise the SAME set as the
    // wire tools. Pre-fix, the manifest was rendered from the unscoped
    // providerTools while the wire was scoped, so the model saw "you may call
    // these N tools" in the prompt but only the scoped set on the wire. This
    // regression-guards the invariant. The shed tool's name MUST appear in the
    // final system prompt's manifest (via renderToolManifest's "- <name>: <desc>" line).
    const lastSystemPrompt = lastRequest!.systemPrompt;
    expect(lastSystemPrompt).toContain('langfuse_trace_export');
    // Sanity: ALL wire tools must appear in the manifest, not just the shed one.
    for (const t of lastRequest!.tools!) {
      expect(lastSystemPrompt).toContain(t.name);
    }

    // 3. retry-once guardrail: no unbounded loop (run terminates normally)
    expect(['completed', 'completed_unverified', 'max_iterations'].includes(result.reason ?? 'completed')).toBe(true);
  });

  it('retry-once guardrail: second call to same shed tool falls through to invalid-tool path', async () => {
    const coreTool: ToolDef = { name: 'alix_shell_run', description: 'Run a shell command', input_schema: { type: 'object', properties: {} } };
    const coreTool2: ToolDef = { name: 'alix_file_read', description: 'Read a file', input_schema: { type: 'object', properties: {} } };
    const coreTool4: ToolDef = { name: 'alix_patch_apply', description: 'Apply a patch', input_schema: { type: 'object', properties: {} } };
    const coreTool5: ToolDef = { name: 'alix_patch_create', description: 'Create a patch', input_schema: { type: 'object', properties: {} } };
    const coreTool6: ToolDef = { name: 'alix_done', description: 'Signal completion', input_schema: { type: 'object', properties: {} } };
    const matchingExtended: ToolDef = { name: 'alix_docs_search', description: 'Search docs and findings', input_schema: { type: 'object', properties: {} } };
    const shedTool: ToolDef = { name: 'langfuse_trace_export', description: 'Export trace to Langfuse', input_schema: { type: 'object', properties: {} } };

    const providerTools = [coreTool, coreTool2, coreTool4, coreTool5, coreTool6, matchingExtended, shedTool];

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

describe('task-loop completion termination', () => {
  const readTool: ToolDef = {
    name: 'alix_file_read',
    description: 'Read a file',
    input_schema: { type: 'object', properties: {} },
  };
  const doneTool: ToolDef = {
    name: 'alix_done',
    description: 'Signal completion',
    input_schema: { type: 'object', properties: {} },
  };
  const shellTool: ToolDef = {
    name: 'alix_shell_run',
    description: 'Run a shell command',
    input_schema: { type: 'object', properties: {} },
  };
  const createTool: ToolDef = {
    name: 'alix_file_create',
    description: 'Create a file',
    input_schema: { type: 'object', properties: {} },
  };

  it('classifies explicit code-change objectives without treating read-only requests as mutations', () => {
    expect(objectiveEvidenceRequirements('fix all', 'bugfix')).toEqual({ mutation: true, verification: false });
    expect(objectiveEvidenceRequirements('review the code and do not modify anything', 'docs')).toEqual({ mutation: false, verification: false });
    expect(objectiveEvidenceRequirements(
      'Make one harmless improvement to README.md, then run an appropriate verification command.',
      'docs',
    )).toEqual({ mutation: true, verification: true });
  });

  it('terminates immediately when done is the only tool called', async () => {
    const provider = createMockProvider({
      toolCalls0: [{ name: 'alix_done', id: 'done-1', args: {} }],
      responseText1: 'This response must never be requested.',
    });
    const executor = {
      execute: async ({ name }: { name: string }) =>
        name === 'done'
          ? { kind: 'success' as const, output: 'Task complete.', completed: true }
          : { kind: 'success' as const, output: 'ok' },
    };
    const { deps } = await makeTestDeps({
      provider,
      providerTools: [doneTool],
      executor: executor as any,
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(provider.requests).toHaveLength(1);
    expect(result.reason).toBe('completed');
  });

  it('requests at most one synthesis after real work and ignores a redundant done attached to the summary', async () => {
    const requests: RecordedRequest[] = [];
    let iteration = 0;
    const finalSummary =
      'I read README.md successfully and confirmed that it documents the ALiX agent operating system. ' +
      'The requested read completed without modifying the workspace, and the result came directly from the file tool output. ' +
      'No additional files were accessed or changed.';
    const provider: ModelAdapter & { requests: RecordedRequest[] } = {
      id: 'mock',
      capabilities: {
        provider: 'mock', model: 'mock', inputTokenLimit: 100_000,
        outputTokenLimit: 16_384, supportsTools: true, supportsStreaming: false,
        supportsStructuredOutput: false, supportsVision: false, parallelToolCalls: false,
      },
      editFormatPreference: 'search_replace',
      longContextStrategy: 'trimmed_context',
      requests,
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages], tools: req.tools ? [...req.tools] : undefined });
        iteration++;
        if (iteration === 1) return { text: '', toolCalls: [{ name: 'alix_file_read', id: 'read-1', args: { path: 'README.md' } }] };
        if (iteration === 2) return { text: '', toolCalls: [{ name: 'alix_done', id: 'done-2', args: {} }] };
        if (iteration === 3) return { text: finalSummary, toolCalls: [{ name: 'alix_done', id: 'redundant-done-3', args: {} }] };
        throw new Error('completion loop requested redundant model synthesis');
      },
    };
    const executedTools: string[] = [];
    const executor = {
      execute: async ({ name }: { name: string }) => {
        executedTools.push(name);
        return name === 'done'
          ? { kind: 'success' as const, output: 'Task complete.', completed: true }
          : { kind: 'success' as const, output: '# ALiX' };
      },
    };
    const { deps } = await makeTestDeps({
      provider,
      task: 'read README.md and summarize it',
      providerTools: [readTool, doneTool],
      executor: executor as any,
      maxIterations: 5,
    });

    const result = await runTaskLoop(deps);

    expect(provider.requests).toHaveLength(3);
    expect(result.summary).toBe(finalSummary);
    expect(result.reason).toBe('completed');
    const events = await deps.log.readAll();
    expect(executedTools.filter((name) => name === 'done')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'completion.redundant_done_ignored')).toHaveLength(1);
    expect(provider.requests[0]!.systemPrompt).toContain('CURRENT TURN BOUNDARY');
    expect(provider.requests[0]!.systemPrompt).toContain('Earlier completed turns are context only');
  });

  it('accepts a concise synthesis after an action tool without forcing done', async () => {
    const requests: RecordedRequest[] = [];
    let iteration = 0;
    const provider: ModelAdapter & { requests: RecordedRequest[] } = {
      id: 'mock',
      capabilities: {
        provider: 'mock', model: 'mock', inputTokenLimit: 100_000,
        outputTokenLimit: 16_384, supportsTools: true, supportsStreaming: false,
        supportsStructuredOutput: false, supportsVision: false, parallelToolCalls: false,
      },
      editFormatPreference: 'search_replace',
      longContextStrategy: 'trimmed_context',
      requests,
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages], tools: req.tools ? [...req.tools] : undefined });
        iteration++;
        if (iteration === 1) return { text: '', toolCalls: [{ name: 'alix_file_read', id: 'read-1', args: { path: 'README.md' } }] };
        if (iteration === 2) return { text: 'The exact first heading is `# ALiX`.', toolCalls: [] };
        throw new Error('concise synthesis was not accepted');
      },
    };
    const { deps } = await makeTestDeps({
      provider,
      task: 'read the first README heading',
      providerTools: [readTool, doneTool],
      executor: { execute: async () => ({ kind: 'success' as const, output: '# ALiX' }) } as any,
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(provider.requests).toHaveLength(2);
    expect(result.summary).toBe('The exact first heading is `# ALiX`.');
    expect(result.reason).toBe('completed');
  });

  it('surfaces the latest tool denial when done has no prose summary', async () => {
    const requests: RecordedRequest[] = [];
    let iteration = 0;
    const provider: ModelAdapter & { requests: RecordedRequest[] } = {
      id: 'mock',
      capabilities: {
        provider: 'mock', model: 'mock', inputTokenLimit: 100_000,
        outputTokenLimit: 16_384, supportsTools: true, supportsStreaming: false,
        supportsStructuredOutput: false, supportsVision: false, parallelToolCalls: false,
      },
      editFormatPreference: 'search_replace',
      longContextStrategy: 'trimmed_context',
      requests,
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages], tools: req.tools ? [...req.tools] : undefined });
        iteration++;
        if (iteration === 1) return { text: '', toolCalls: [{ name: 'alix_file_read', id: 'read-outside', args: { path: '../package.json' } }] };
        if (iteration === 2) return { text: '', toolCalls: [{ name: 'alix_done', id: 'done-after-denial', args: {} }] };
        throw new Error('denied outcome requested an unnecessary extra synthesis');
      },
    };
    const { deps } = await makeTestDeps({
      provider,
      task: 'try to read ../package.json and report the result',
      providerTools: [readTool, doneTool],
      executor: {
        execute: async ({ name }: { name: string }) => name === 'done'
          ? { kind: 'success' as const, output: 'Task complete.', completed: true }
          : { kind: 'error' as const, message: 'Access denied: path is outside workspace (/tmp/package.json)', retryable: false },
      } as any,
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(provider.requests).toHaveLength(2);
    expect(result.summary).toContain('Task could not complete: Access denied: path is outside workspace (/tmp/package.json)');
    expect(result.reason).toBe('completed_unverified');
  });

  it('does not let a progress checkpoint preempt an explicit done call', async () => {
    const requests: RecordedRequest[] = [];
    let iteration = 0;
    const provider: ModelAdapter & { requests: RecordedRequest[] } = {
      id: 'mock',
      capabilities: {
        provider: 'mock', model: 'mock', inputTokenLimit: 100_000,
        outputTokenLimit: 16_384, supportsTools: true, supportsStreaming: false,
        supportsStructuredOutput: false, supportsVision: false, parallelToolCalls: false,
      },
      editFormatPreference: 'search_replace',
      longContextStrategy: 'trimmed_context',
      requests,
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages], tools: req.tools ? [...req.tools] : undefined });
        iteration++;
        if (iteration === 1) {
          return {
            text: '',
            toolCalls: [
              ...Array.from({ length: 5 }, (_, index) => ({
                name: 'alix_file_read', id: `read-${index}`, args: { path: `file-${index}.txt` },
              })),
              { name: 'alix_done', id: 'done-after-five', args: {} },
            ],
          };
        }
        if (iteration === 2) {
          return { text: 'I read the five requested files and completed the task.', toolCalls: [] };
        }
        throw new Error('progress checkpoint preempted explicit completion');
      },
    };
    const executor = {
      execute: async ({ name }: { name: string }) =>
        name === 'done'
          ? { kind: 'success' as const, output: 'Task complete.', completed: true }
          : { kind: 'success' as const, output: 'file content' },
    };
    const { deps } = await makeTestDeps({
      provider,
      task: 'read five files',
      providerTools: [readTool, doneTool],
      executor: executor as any,
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(provider.requests).toHaveLength(2);
    expect(result.summary).toBe('I read the five requested files and completed the task.');
  });

  it('does not mark a requested edit complete without mutation and verification evidence', async () => {
    const requests: RecordedRequest[] = [];
    let iteration = 0;
    const provider: ModelAdapter & { requests: RecordedRequest[] } = {
      id: 'mock',
      capabilities: {
        provider: 'mock', model: 'mock', inputTokenLimit: 100_000,
        outputTokenLimit: 16_384, supportsTools: true, supportsStreaming: false,
        supportsStructuredOutput: false, supportsVision: false, parallelToolCalls: false,
      },
      editFormatPreference: 'search_replace',
      longContextStrategy: 'trimmed_context',
      requests,
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages], tools: req.tools ? [...req.tools] : undefined });
        iteration++;
        if (iteration === 1) return { text: '', toolCalls: [{ name: 'alix_shell_run', id: 'list', args: { command: 'ls -la' } }] };
        if (iteration === 2) return { text: '', toolCalls: [{ name: 'alix_file_read', id: 'read', args: { path: 'README.md' } }] };
        return { text: "Now I'll make a harmless improvement to README.md.", toolCalls: [{ name: 'alix_done', id: 'premature-done', args: {} }] };
      },
    };
    const { deps } = await makeTestDeps({
      provider,
      task: 'Inspect this repository and make one harmless improvement to README.md. Apply the edit, run an appropriate verification command, and report the changed file.',
      providerTools: [shellTool, readTool, doneTool],
      selectedTools: [
        { name: 'alix_shell_run', execName: 'shell.run' },
        { name: 'alix_file_read', execName: 'file.read' },
        { name: 'alix_done', execName: 'done' },
      ],
      executor: {
        execute: async ({ name }: { name: string }) => name === 'done'
          ? { kind: 'success' as const, output: 'Task complete.', completed: true }
          : { kind: 'success' as const, output: name === 'shell.run' ? 'README.md' : '# ALiX' },
      } as any,
      maxIterations: 3,
    });

    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('completed_unverified');
    expect(result.summary).toContain('missing a successful workspace mutation');
    expect(result.summary).toContain('a successful verification command after the mutation');
  });

  it('accepts completion after successful mutation and post-mutation verification', async () => {
    const requests: RecordedRequest[] = [];
    let iteration = 0;
    const provider: ModelAdapter & { requests: RecordedRequest[] } = {
      id: 'mock',
      capabilities: {
        provider: 'mock', model: 'mock', inputTokenLimit: 100_000,
        outputTokenLimit: 16_384, supportsTools: true, supportsStreaming: false,
        supportsStructuredOutput: false, supportsVision: false, parallelToolCalls: false,
      },
      editFormatPreference: 'search_replace',
      longContextStrategy: 'trimmed_context',
      requests,
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages], tools: req.tools ? [...req.tools] : undefined });
        iteration++;
        if (iteration === 1) return { text: '', toolCalls: [{ name: 'alix_file_create', id: 'create', args: { path: 'note.md', content: 'safe' } }] };
        if (iteration === 2) return { text: '', toolCalls: [{ name: 'alix_shell_run', id: 'verify', args: { command: 'pnpm test' } }] };
        return { text: 'Created note.md and verified it with the test suite.', toolCalls: [{ name: 'alix_done', id: 'done', args: {} }] };
      },
    };
    const { deps } = await makeTestDeps({
      provider,
      task: 'Create a file named note.md and run tests to verify the change.',
      providerTools: [createTool, shellTool, doneTool],
      selectedTools: [
        { name: 'alix_file_create', execName: 'file.create' },
        { name: 'alix_shell_run', execName: 'shell.run' },
        { name: 'alix_done', execName: 'done' },
      ],
      executor: {
        execute: async ({ name }: { name: string }) => name === 'done'
          ? { kind: 'success' as const, output: 'Task complete.', completed: true }
          : { kind: 'success' as const, output: 'ok' },
      } as any,
      maxIterations: 3,
    });

    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('completed');
    expect(result.summary).toBe('Created note.md and verified it with the test suite.');
  });

  it('records provider tool aliases as mutation evidence when selectedTools omitted the scoped tool', async () => {
    let iteration = 0;
    const executions: Array<{ name: string; allowedMutationPaths?: readonly string[] }> = [];
    const provider = {
      ...createMockProvider(),
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        this.requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages], tools: req.tools ? [...req.tools] : undefined });
        iteration++;
        if (iteration === 1) {
          return { text: '', toolCalls: [{ name: 'alix_file_create', id: 'create', args: { path: 'note.md', content: 'safe' } }] };
        }
        return { text: 'Created note.md.', toolCalls: [{ name: 'alix_done', id: 'done', args: {} }] };
      },
    } as ModelAdapter & { requests: RecordedRequest[] };
    const { deps } = await makeTestDeps({
      provider,
      task: 'Create a file named note.md.',
      providerTools: [createTool, doneTool],
      selectedTools: [{ name: 'alix_done', execName: 'done' }],
      executor: {
        execute: async (request: { name: string; allowedMutationPaths?: readonly string[] }) => {
          executions.push(request);
          return request.name === 'done'
            ? { kind: 'success' as const, output: 'Task complete.', completed: true }
            : { kind: 'success' as const, output: 'ok' };
        },
      } as any,
      maxIterations: 2,
    });

    const result = await runTaskLoop(deps);
    expect(result.reason).toBe('completed');
    expect(result.summary).toBe('Created note.md.');
    expect(executions[0]?.allowedMutationPaths).toEqual(['note.md']);
  });

  it('does not run repository scripts after creating and reading back a text file', async () => {
    let iteration = 0;
    const provider = {
      ...createMockProvider(),
      async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
        this.requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages], tools: req.tools ? [...req.tools] : undefined });
        iteration++;
        if (iteration === 1) return { text: '', toolCalls: [{ name: 'alix_file_create', id: 'create', args: { path: 'alix-safety-test.txt', content: 'ALiX workspace write succeeded.' } }] };
        if (iteration === 2) return { text: '', toolCalls: [{ name: 'alix_file_read', id: 'read', args: { path: 'alix-safety-test.txt' } }] };
        if (iteration === 3) return { text: '', toolCalls: [{ name: 'alix_done', id: 'done', args: {} }] };
        return { text: 'Created and read back alix-safety-test.txt.', toolCalls: [{ name: 'alix_done', id: 'duplicate-done', args: {} }] };
      },
    } as ModelAdapter & { requests: RecordedRequest[] };
    const { deps, log } = await makeTestDeps({
      provider,
      task: 'Create a file named alix-safety-test.txt containing the requested text, then read it back.',
      taskType: 'command',
      providerTools: [createTool, readTool, doneTool],
      selectedTools: [
        { name: 'alix_file_create', execName: 'file.create' },
        { name: 'alix_file_read', execName: 'file.read' },
        { name: 'alix_done', execName: 'done' },
      ],
      executor: {
        execute: async ({ name }: { name: string }) => name === 'done'
          ? { kind: 'success' as const, output: 'Task complete.', completed: true }
          : { kind: 'success' as const, output: name === 'file.read' ? 'ALiX workspace write succeeded.' : 'ok' },
      } as any,
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);
    const events = await log.readAll();

    expect(result.reason).toBe('completed');
    expect(events.some((event) => event.type === 'verification.check_started')).toBe(false);
  });
});
