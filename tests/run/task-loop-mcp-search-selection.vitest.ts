/**
 * F4 Bypass A: `alix_mcp_search_tools` is a real member of the frozen candidate
 * set, so calling it is a real selection. It used to `continue` past
 * `handleToolResult`, which meant the observation was never emitted — cohort
 * `t3d-2026-09-28-c` recorded eight external tasks and ZERO selection scopes.
 *
 * The F4 spec requires: "a loop turn that calls `alix_mcp_search_tools` emits a
 * selection scope whose chosen candidate is `builtin:alix_mcp_search_tools`".
 * This drives the actual task loop rather than the builder, because the defect
 * was precisely that the builder worked while the loop never called it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { closeAllSharedLedgers } from '../../src/storage/runtime-ledger.js';
import { runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
import { extractToolSelectionScopes } from '../../src/decision/tool-selection-replay.js';
import { createContextBudget } from '../../src/config/context-budget.js';
import { ensureEncoder } from '../../src/utils/tokens.js';
import { TaskStateMachine, RunLimiter } from '../../src/autonomy/state-machine.js';
import { ScopeTracker } from '../../src/autonomy/scope-tracker.js';
import { MemoryStore } from '../../src/utils/memory/store.js';
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedMessage,
  ToolCall,
  ToolDef,
} from '../../src/providers/types.js';
import type { MutationSessionState } from '../../src/run.js';

const MCP_SEARCH_TOOL: ToolDef = {
  name: 'alix_mcp_search_tools',
  description: 'Search the available MCP tools',
  input_schema: { type: 'object', properties: { query: { type: 'string' } } },
};
const SHELL_TOOL: ToolDef = {
  name: 'alix_shell_run',
  description: 'Run a shell command in the workspace.',
  input_schema: { type: 'object', properties: { command: { type: 'string' } } },
};
const DONE_TOOL: ToolDef = {
  name: 'alix_done',
  description: 'Signal completion',
  input_schema: { type: 'object', properties: {} },
};

type ScriptedTurn = { text?: string; toolCalls?: ToolCall[] };

function createScriptedProvider(turns: ScriptedTurn[]): ModelAdapter {
  let iter = 0;
  return {
    id: 'mock',
    capabilities: {
      provider: 'mock', model: 'mock', inputTokenLimit: 100_000, outputTokenLimit: 16_384,
      supportsTools: true, supportsStreaming: false, supportsStructuredOutput: false,
      supportsVision: false, parallelToolCalls: false,
    },
    editFormatPreference: 'search_replace',
    longContextStrategy: 'trimmed_context',
    async complete(_req: NormalizedRequest): Promise<NormalizedResponse> {
      const turn = turns[Math.min(iter, turns.length - 1)] ?? {};
      iter++;
      return {
        text: turn.text ?? '',
        toolCalls: turn.toolCalls ?? [],
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: (turn.toolCalls?.length ?? 0) > 0 ? 'tool_use' : 'stop',
      };
    },
  } as unknown as ModelAdapter;
}

/**
 * `mcpDiscovery` non-null is what makes `handleMcpToolSearch` service the
 * call — that is the short-circuit under test.
 */
async function makeDeps(overrides: {
  provider: ModelAdapter;
  task: string;
}): Promise<{ deps: TaskLoopDeps; log: EventLog; cleanup: () => void }> {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'alix-bypass-a-'));
  const sessionId = 'bypass-a-test';
  const sessionDir = join(tmpRoot, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const memoryStore = new MemoryStore(join(tmpRoot, 'memory'));
  await memoryStore.init();
  const log = new EventLog(join(tmpRoot, 'events'));
  await log.init();
  await ensureEncoder('cl100k_base');

  const sessionState: MutationSessionState = {
    created: new Set<string>(),
    deleted: new Set<string>(),
    changed: new Set<string>(),
    fatalErrors: [],
    pendingScopeExpansion: false,
  };

  const deps: TaskLoopDeps = {
    config: {
      models: { default: { provider: 'mock', name: 'mock', streaming: false } },
      permissions: {},
    },
    provider: overrides.provider,
    providerTools: [MCP_SEARCH_TOOL, SHELL_TOOL, DONE_TOOL],
    mcpToolIndex: [],
    messages: [{ role: 'user', content: overrides.task } as NormalizedMessage],
    sessionState,
    stateMachine: new TaskStateMachine(new RunLimiter({
      maxIterations: 4, maxRepairs: 3, maxFileChanges: 100, maxShellCommands: 50, maxRuntimeMs: 60_000,
    })),
    scope: new ScopeTracker(),
    session: { sessionId, actor: 'system' as const },
    log,
    executor: {
      execute: async ({ name }: { name: string }) =>
        name === 'task.complete'
          ? { kind: 'success' as const, output: 'Task complete.', completed: true }
          : { kind: 'success' as const, output: 'ok' },
    } as unknown as TaskLoopDeps['executor'],
    mcpDiscovery: {
      search: async () => ({ matches: [{ name: 'mcp__abc', serverName: 'demo', toolName: 'echo' }] }),
    } as unknown as TaskLoopDeps['mcpDiscovery'],
    selectedTools: [],
    hooks: {},
    maxIterations: 4,
    contextBudget: createContextBudget(
      { contextWindowTokens: 100_000 },
      { outputRatio: 0.1, outputFloor: 1_000, outputCap: 16_384 },
    ),
    tokenizer: 'cl100k_base',
    task: overrides.task,
    taskType: 'feature',
    depth: 'quick',
    memoryStore,
    sessionId,
    sessionDir,
    systemPrompt: 'You are a test assistant.',
  };

  return { deps, log, cleanup: () => { closeAllSharedLedgers(); rmSync(tmpRoot, { recursive: true, force: true }); } };
}

// Every suite in this file asserts that scopes reach the log, and selection
// tracing is off by default. Opt in the way a cohort collection does, then
// restore so the default is not silently widened.
beforeAll(() => { process.env.ALIX_TOOL_SELECTION_TRACE = '1'; });
afterAll(() => { delete process.env.ALIX_TOOL_SELECTION_TRACE; });

describe('F4 Bypass A — the MCP search sentinel is a recorded selection', () => {
  /**
   * The gate exists on this path. It did not, and nothing caught it: the
   * telemetry gate added in 88a01489 gated only
   * `src/observability/tool-selection-observation.ts`, while the emitter this
   * file exercises is a SEPARATE wrapper in `task-loop/main.ts` that appends
   * directly. Every other assertion in this suite passed with the flag
   * deleted — which is how a suite ends up proving nothing.
   *
   * So this asserts the ABSENCE of the event with the flag off. That is the
   * direction that actually catches a missing gate.
   */
  it('writes nothing when selection tracing is off', async () => {
    delete process.env.ALIX_TOOL_SELECTION_TRACE;
    const offProvider = createScriptedProvider([
      { toolCalls: [{ name: 'alix_mcp_search_tools', id: 'm0', args: { query: 'echo' } }] },
      { text: 'Found the echo tool.' },
      { text: 'Found the echo tool.' },
    ]);
    const off = await makeDeps({ provider: offProvider, task: 'Find an MCP tool that echoes text.' });
    try {
      await runTaskLoop(off.deps);
      const events = await off.log.readAll();
      expect(events.filter(e => e.type === 'tool.selection.observed')).toHaveLength(0);
    } finally {
      off.cleanup();
      process.env.ALIX_TOOL_SELECTION_TRACE = '1';
    }
  });

  it('emits a scope whose chosen candidate is builtin:alix_mcp_search_tools', async () => {
    const provider = createScriptedProvider([
      { toolCalls: [{ name: 'alix_mcp_search_tools', id: 'm1', args: { query: 'echo' } }] },
      { text: 'Found the echo tool.' },
      { text: 'Found the echo tool.' },
    ]);
    const { deps, log, cleanup } = await makeDeps({
      provider,
      task: 'Find an MCP tool that echoes text.',
    });

    try {
      await runTaskLoop(deps);

      const events = await log.readAll();
      const observed = events.filter(event => event.type === 'tool.selection.observed');
      expect(observed.length).toBeGreaterThan(0);

      const payload = observed[0].payload as { chosen?: string; chosenCandidateId?: string };
      expect(payload.chosenCandidateId).toBe('builtin:alix_mcp_search_tools');
      expect(payload.chosen).toBe('alix_mcp_search_tools');

      // And the replay reader must see it as a real scope, not a dropped turn.
      const scopes = extractToolSelectionScopes(events);
      expect(scopes.some(scope =>
        scope.actualCandidateIds.includes('builtin:alix_mcp_search_tools'))).toBe(true);
    } finally {
      cleanup();
    }
  });
});

/**
 * T3 could not distinguish "the selector chose badly" from "the surface made
 * the objective impossible": a requirement tool stripped before the scoper ran
 * appears in neither `offered` nor `scoping.excluded`. This drives the real
 * loop with a coordination-shaped objective and NO coordination tool in the
 * surface, so the gap must be recorded end to end.
 */
describe('surface gaps are recorded end to end', () => {
  it('records an absent-upstream requirement tool the surface could not offer', async () => {
    const provider = createScriptedProvider([
      { toolCalls: [{ name: 'alix_shell_run', id: 's1', args: { command: 'ls' } }] },
      { text: 'No coordination tool is available.' },
      { text: 'No coordination tool is available.' },
    ]);
    const { deps, log, cleanup } = await makeDeps({
      provider,
      task: 'Plan a two-worker coordination run writing left.md and right.md.',
    });

    try {
      await runTaskLoop(deps);
      const events = await log.readAll();
      const observed = events.find(e => e.type === 'tool.selection.observed');
      expect(observed, 'the turn made a real choice among the offered tools').toBeDefined();

      const payload = observed!.payload as {
        surfaceGaps?: Array<{ toolName?: string; absence?: string; reasons?: string[] }>;
      };
      const gap = payload.surfaceGaps?.find(g => g.toolName === 'alix_coordination_run');
      expect(gap, 'the missing coordination tool must be named').toBeDefined();
      expect(gap!.absence).toBe('absent-upstream');
      expect(gap!.reasons).toContain('requirement:coordination');
    } finally {
      cleanup();
    }
  });
});

/**
 * `emitSelectionObservation` builds its argument field by field, so a context
 * field the emitter forgets is TYPE-accepted and silently DROPPED. That is not
 * hypothetical: `invalidSelection` and `surfaceGaps` were both lost exactly this
 * way, each with a green typecheck and a green build. The loop's own contract
 * lists the keys; this drives a real turn and asserts every one arrives.
 */
describe('selection context forwarding', () => {
  it('carries every declared context key onto the emitted observation', async () => {
    const provider = createScriptedProvider([
      { toolCalls: [{ name: 'alix_shell_run', id: 'f1', args: { command: 'ls' } }] },
      { text: 'done' },
      { text: 'done' },
    ]);
    const { deps, log, cleanup } = await makeDeps({
      provider,
      task: 'Plan a two-worker coordination run writing left.md and right.md.',
    });

    try {
      await runTaskLoop(deps);
      const observed = (await log.readAll()).find(e => e.type === 'tool.selection.observed');
      expect(observed).toBeDefined();
      const payload = observed!.payload as Record<string, unknown>;

      // Every optional key the emitter forwards conditionally, plus the
      // required ones. `candidates`/`requirementCandidates`/`scoping`/`ranking`
      // are always sent; `candidateBindings` and `surfaceGaps` only when present.
      const required = ['candidates', 'requirementCandidates', 'scoping', 'ranking'] as const;
      for (const key of required) {
        expect(payload, `${key} must reach the observation`).toHaveProperty(key);
      }
      // These are the two that have each been dropped at runtime before. The
      // surface carries an MCP tool, so bindings are always present here.
      expect(payload).toHaveProperty('candidateBindings');
      // The objective requires coordination, which this surface cannot offer.
      expect(payload).toHaveProperty('surfaceGaps');
    } finally {
      cleanup();
    }
  });
});
