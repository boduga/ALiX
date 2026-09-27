/**
 * Coordination completion-evidence defect: a FAILED last-attempt
 * `coordination.run` must block completed-status outcomes (task.done /
 * graph.completed / workflow.completed / session.ended:completed) even when
 * the objective text does NOT match the coordination-evidence regex.
 *
 * Covers:
 * 1. objectiveEvidenceGaps unit contract for the optional
 *    `{ coordinationRunFailed }` flag (last-attempt semantics).
 * 2. Path A (no tools + prose done): bounded re-prompt, then
 *    completed_unverified — never completed.
 * 3. Recovery: a later successful coordination.run clears the gate.
 * 4. trackCompleted (`done` tool in the same batch): gate applies before
 *    completion is accepted.
 * 5. Path B (mutations + verification passed + prose done): explicit
 *    coordination_failed gate, then completed_unverified.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { runTaskLoop, type TaskLoopDeps } from '../../src/run/task-loop.js';
import {
  COORDINATION_EVIDENCE_GAP,
  VERIFICATION_EVIDENCE_GAP,
  isToolResultEcho,
  objectiveEvidenceGaps,
  objectiveEvidenceRequirements,
} from '../../src/run/task-loop/predicates.js';
import { createContextBudget } from '../../src/config/context-budget.js';
import { ensureEncoder } from '../../src/utils/tokens.js';
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedMessage,
  ToolCall,
  ToolDef,
} from '../../src/providers/types.js';
import { TaskStateMachine, RunLimiter } from '../../src/autonomy/state-machine.js';
import { ScopeTracker } from '../../src/autonomy/scope-tracker.js';
import { MemoryStore } from '../../src/utils/memory/store.js';
import type { MutationSessionState } from '../../src/run.js';

type RecordedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
};

type ScriptedTurn = { text?: string; toolCalls?: ToolCall[] };

function createScriptedProvider(turns: ScriptedTurn[]): ModelAdapter & { requests: RecordedRequest[] } {
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
      requests.push({ systemPrompt: req.systemPrompt, messages: [...req.messages] });
      const turn = turns[Math.min(iter, turns.length - 1)] ?? {};
      iter++;
      return {
        text: turn.text ?? '',
        toolCalls: turn.toolCalls ?? [],
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: (turn.toolCalls?.length ?? 0) > 0 ? 'tool_use' : 'stop',
      };
    },
    requests,
  };
}

const coordinationTool: ToolDef = {
  name: 'alix_coordination_run',
  description: 'Coordinate parallel workers toward a goal',
  input_schema: { type: 'object', properties: {} },
};
const doneTool: ToolDef = {
  name: 'alix_done',
  description: 'Signal completion',
  input_schema: { type: 'object', properties: {} },
};

/** Executor whose coordination.run outcomes follow the given script (last repeats). */
function makeExecutor(coordinationOutcomes: Array<'error' | 'success'>): TaskLoopDeps['executor'] {
  let coordCall = 0;
  return {
    execute: async ({ name }: { name: string }) => {
      if (name === 'coordination.run') {
        const outcome = coordinationOutcomes[Math.min(coordCall, coordinationOutcomes.length - 1)] ?? 'error';
        coordCall++;
        if (outcome === 'error') {
          return { kind: 'error' as const, message: 'worker pool failed', retryable: false };
        }
        return { kind: 'success' as const, output: '{"runId":"run_test","status":"completed"}' };
      }
      if (name === 'done') {
        return { kind: 'success' as const, output: 'Task complete.', completed: true };
      }
      return { kind: 'success' as const, output: 'ok' };
    },
  } as unknown as TaskLoopDeps['executor'];
}

async function makeTestDeps(overrides: {
  provider: ModelAdapter & { requests: RecordedRequest[] };
  task?: string;
  providerTools?: TaskLoopDeps['providerTools'];
  maxIterations?: number;
  taskType?: TaskLoopDeps['taskType'];
  executor?: TaskLoopDeps['executor'];
}): Promise<{ deps: TaskLoopDeps; log: EventLog }> {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'alix-coord-'));
  const sessionId = 'coord-gate-test';
  const sessionDir = join(tmpRoot, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const memoryStore = new MemoryStore(join(tmpRoot, 'memory'));
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
    maxIterations: overrides.maxIterations ?? 4,
    maxRepairs: 3,
    maxFileChanges: 100,
    maxShellCommands: 50,
    maxRuntimeMs: 60_000,
  }));

  await ensureEncoder('cl100k_base');

  const contextBudget = createContextBudget(
    { contextWindowTokens: 100_000 },
    { outputRatio: 0.1, outputFloor: 1_000, outputCap: 16_384 },
  );

  const deps: TaskLoopDeps = {
    config: {
      models: { default: { provider: 'mock', name: 'mock', streaming: false } },
      permissions: {},
    },
    provider: overrides.provider,
    providerTools: overrides.providerTools ?? [],
    mcpToolIndex: [],
    messages: [{ role: 'user', content: overrides.task ?? 'test task' }],
    sessionState,
    stateMachine,
    scope,
    session: { sessionId, actor: 'system' as const },
    log,
    executor: overrides.executor ?? ({} as TaskLoopDeps['executor']),
    mcpDiscovery: null,
    selectedTools: [],
    hooks: {},
    maxIterations: overrides.maxIterations ?? 4,
    contextBudget,
    tokenizer: 'cl100k_base',
    task: overrides.task ?? 'test task',
    taskType: overrides.taskType ?? 'docs',
    depth: 'quick',
    memoryStore,
    sessionId,
    sessionDir,
    systemPrompt: 'You are a test assistant.',
  };

  return { deps, log };
}

const NO_COORD_TASK = 'Prepare the release notes summary.';

describe('objectiveEvidenceGaps accepts delegated workspace mutation', () => {
  const DELEGATED_TASK = 'Create the file .tmp/out/project.md with four coordinated workers.';

  it('accepts a coordination run that reported worker-written files as the mutation', () => {
    const gaps = objectiveEvidenceGaps(DELEGATED_TASK, 'feature', [
      { name: 'coordination.run', args: { goal: 'write files' }, ordinal: 0, mutated: true },
    ]);
    expect(gaps).not.toContain('a successful workspace mutation');
  });

  it('still requires a mutation when the coordination call changed nothing', () => {
    const gaps = objectiveEvidenceGaps(DELEGATED_TASK, 'feature', [
      { name: 'coordination.run', args: { goal: 'inspect only' }, ordinal: 0 },
    ]);
    expect(gaps).toContain('a successful workspace mutation');
  });

  it('keeps a parent-side mutation sufficient on its own', () => {
    const gaps = objectiveEvidenceGaps(DELEGATED_TASK, 'feature', [
      { name: 'file.create', args: { path: '.tmp/out/project.md' }, ordinal: 0 },
    ]);
    expect(gaps).not.toContain('a successful workspace mutation');
  });
});

/**
 * Live failure (session 1790494937761): a 16-step probe named its tools in
 * exact model-facing form ("alix_coordination_run, exactly two workers",
 * "alix_verify_claim"). The detectors scanned with \b, which cannot match
 * across the underscore, so one file.create satisfied every detected
 * requirement and the turn closed "completed" with a tool-output echo.
 */
describe('requirement detection reads exact tool names', () => {
  const PROBE_TASK = [
    'Naming-cutover probe. Work entirely inside `.tmp/name-cutover-probe/`.',
    '1. alix_file_create → `.tmp/name-cutover-probe/notes.md` with a 3-line summary.',
    '7. alix_patch_apply → search_replace in notes.md: "summary" → "overview".',
    'PART 3 — coordination through exact worker names:',
    '11. alix_coordination_run, exactly two workers, both under `.tmp/name-cutover-probe/`.',
    '16. alix_verify_claim claim="notes.md exists in .tmp/name-cutover-probe/".',
  ].join('\n');

  it('sees coordination and verification behind underscore-joined tool names', () => {
    const required = objectiveEvidenceRequirements(PROBE_TASK, 'feature');
    expect(required.mutation).toBe(true);
    expect(required.coordination).toBe(true);
    expect(required.verification).toBe(true);
  });

  it('reports the missing coordination run and verification for that objective', () => {
    const gaps = objectiveEvidenceGaps(PROBE_TASK, 'feature', [
      { name: 'file.create', args: { path: '.tmp/name-cutover-probe/notes.md' }, ordinal: 0 },
    ]);
    expect(gaps).toContain(COORDINATION_EVIDENCE_GAP);
    expect(gaps).toContain(VERIFICATION_EVIDENCE_GAP);
  });

  it('accepts a verification tool call as verification evidence', () => {
    const task = 'Create the file .tmp/out/report.md and verify the file exists.';
    const withTool = objectiveEvidenceGaps(task, 'feature', [
      { name: 'file.create', args: { path: '.tmp/out/report.md' }, ordinal: 0 },
      { name: 'verify.claim', args: { claim: 'report.md exists' }, ordinal: 1 },
    ]);
    expect(withTool).not.toContain(VERIFICATION_EVIDENCE_GAP);
    const withoutTool = objectiveEvidenceGaps(task, 'feature', [
      { name: 'file.create', args: { path: '.tmp/out/report.md' }, ordinal: 0 },
    ]);
    expect(withoutTool).toContain(VERIFICATION_EVIDENCE_GAP);
  });

  it('does not invent requirements for ordinary prose objectives', () => {
    const required = objectiveEvidenceRequirements('Prepare the release notes summary.', 'docs');
    expect(required.coordination).toBe(false);
    expect(required.verification).toBe(false);
  });
});

describe('tool-result echo detection', () => {
  it('flags a final answer that repeats the last tool result', () => {
    expect(isToolResultEcho(
      '310 .tmp/name-cutover-probe/notes.md',
      '<tool_result id="c1">310 .tmp/name-cutover-probe/notes.md</tool_result>',
    )).toBe(true);
  });

  it('flags an answer that embeds a short result verbatim', () => {
    expect(isToolResultEcho('Answer: 310 .tmp/out/notes.md', '310 .tmp/out/notes.md')).toBe(true);
  });

  it('does not flag real prose, short replies, or an empty result', () => {
    expect(isToolResultEcho('Created notes.md and verified all four steps ran.', 'file created')).toBe(false);
    expect(isToolResultEcho('ok', 'file created')).toBe(false);
    expect(isToolResultEcho('any answer', undefined)).toBe(false);
  });
});

describe('objectiveEvidenceGaps coordination-failure flag', () => {
  it('forces the coordination gap when the last coordination.run failed, regardless of objective text', () => {
    const gaps = objectiveEvidenceGaps(NO_COORD_TASK, 'docs', [], { coordinationRunFailed: true });
    expect(gaps).toContain(COORDINATION_EVIDENCE_GAP);
  });

  it('does not invent a coordination gap without the flag or a coordination-requiring objective', () => {
    const gaps = objectiveEvidenceGaps(NO_COORD_TASK, 'docs', []);
    expect(gaps).not.toContain(COORDINATION_EVIDENCE_GAP);
  });

  it('keeps the flag authoritative over an earlier successful coordination.run (last attempt wins)', () => {
    const gaps = objectiveEvidenceGaps(
      NO_COORD_TASK,
      'docs',
      [{ name: 'coordination.run', args: {}, ordinal: 0 }],
      { coordinationRunFailed: true },
    );
    expect(gaps).toContain(COORDINATION_EVIDENCE_GAP);
  });

  it('accepts completion after a successful run on a coordination-requiring objective', () => {
    const reqTask = 'Run four coordinated workers to draft the report.';
    const gaps = objectiveEvidenceGaps(
      reqTask,
      'docs',
      [{ name: 'coordination.run', args: {}, ordinal: 1 }],
      { coordinationRunFailed: false },
    );
    expect(gaps).not.toContain(COORDINATION_EVIDENCE_GAP);
  });

  it('still covers a text-required coordination objective with no run at all', () => {
    const reqTask = 'Run four coordinated workers to draft the report.';
    const gaps = objectiveEvidenceGaps(reqTask, 'docs', []);
    expect(gaps).toContain(COORDINATION_EVIDENCE_GAP);
  });
});

describe('runTaskLoop coordination-failure completion gate', () => {
  it('does not accept an echoed tool result as a completion summary', async () => {
    const ECHO = '310 .tmp/out/notes.md';
    const provider = createScriptedProvider([
      { toolCalls: [{ name: 'alix_file_create', id: 'c1', args: { path: '.tmp/out/notes.md', content: 'x' } }] },
      { text: ECHO },
      { text: ECHO },
    ]);
    const echoExecutor = {
      execute: async ({ name }: { name: string }) =>
        name === 'file.create'
          ? { kind: 'success' as const, output: ECHO, changed: true, changedFiles: ['.tmp/out/notes.md'] }
          : { kind: 'success' as const, output: 'ok', completed: name === 'done' },
    } as unknown as TaskLoopDeps['executor'];
    const { deps, log } = await makeTestDeps({
      provider,
      task: 'Create the file .tmp/out/notes.md and report its size.',
      taskType: 'feature',
      providerTools: [
        { name: 'alix_file_create', description: 'Create a file', input_schema: { type: 'object', properties: {} } },
        doneTool,
      ],
      executor: echoExecutor,
      maxIterations: 5,
    });

    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('completed_unverified');
    const events = await log.readAll();
    const rejections = events.filter((event) => event.type === 'completion.claim_rejected');
    expect(rejections.some((event) => (event.payload as { reason?: string })?.reason === 'tool_result_echo')).toBe(true);
    // The shadow selection observation rides along with every executed call.
    const observed = events.find((event) => event.type === 'tool.selection.observed');
    expect(observed).toBeDefined();
    expect((observed?.payload as { chosen?: string })?.chosen).toBe('alix_file_create');
    const payload = observed?.payload as {
      execution?: { status?: string };
      selection?: { outcome?: string };
      evidence?: { contribution?: string };
    };
    expect(payload.execution?.status).toBe('success');
    expect(payload.selection?.outcome).toBe('novel');
    expect(payload.evidence?.contribution).toBe('contributed');
    // Requirement candidates and scoping provenance ride along: this objective
    // asks for a file, so the mutation-closing tool must be identifiable.
    const provenance = observed?.payload as {
      requirementCandidates?: Array<{ tool: string; reasons: string[] }>;
      scoping?: { admitted?: Array<{ tool: string; reasons: string[] }>; fallbackFull?: boolean };
    };
    expect(provenance.requirementCandidates?.some(entry => entry.tool === 'alix_file_create')).toBe(true);
    expect((provenance.scoping?.admitted ?? []).length).toBeGreaterThan(0);
  });

  it('continues after a successful run when final prose promises another agent action', async () => {
    const provider = createScriptedProvider([
      { toolCalls: [{ name: 'alix_coordination_run', id: 'c1', args: { goal: 'draft report' } }] },
      { text: "The run completed. Next, I'm surfacing the files as artifacts, then I'll write the final summary." },
      { text: 'Run completed. Four files verified: project.md, tui.md, tests.md, final-report.md.' },
    ]);
    const { deps, log } = await makeTestDeps({
      provider,
      task: 'Run four coordinated workers to draft a report and surface the results.',
      taskType: 'docs',
      providerTools: [coordinationTool, doneTool],
      executor: makeExecutor(['success']),
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('completed');
    expect(result.summary).toContain('Four files verified');
    expect(result.summary).not.toContain("Next, I'm surfacing");
    expect(provider.requests).toHaveLength(3);
    const events = await log.readAll();
    expect(events.some((event) => event.type === 'completion.claim_rejected')).toBe(true);
  });

  it('accepts a completed report that merely offers future help', async () => {
    const provider = createScriptedProvider([
      { toolCalls: [{ name: 'alix_coordination_run', id: 'c1', args: { goal: 'draft report' } }] },
      { text: "Run completed. Four files verified. Next, I'm available if you need changes." },
    ]);
    const { deps } = await makeTestDeps({
      provider,
      task: 'Run four coordinated workers to draft a report and surface the results.',
      taskType: 'docs',
      providerTools: [coordinationTool, doneTool],
      executor: makeExecutor(['success']),
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('completed');
    expect(provider.requests).toHaveLength(2);
  });

  it('Path A: blocks completed after a failed coordination.run when objective text does not require coordination', async () => {
    const provider = createScriptedProvider([
      { text: '', toolCalls: [{ name: 'alix_coordination_run', id: 'c1', args: { goal: 'summarize' } }] },
      { text: 'Done. Everything is complete.' },
      { text: 'Done. Everything is complete.' },
      { text: 'Done. Everything is complete.' },
    ]);
    const { deps, log } = await makeTestDeps({
      provider,
      task: NO_COORD_TASK,
      taskType: 'docs',
      providerTools: [coordinationTool, doneTool],
      executor: makeExecutor(['error']),
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('completed_unverified');
    const events = await log.readAll();
    const ended = events.filter((e) => e.type === 'session.ended');
    expect(ended.length).toBeGreaterThan(0);
    expect(ended.every((e) => (e.payload as { reason?: string }).reason !== 'completed')).toBe(true);
    expect((ended.at(-1)!.payload as { reason?: string }).reason).toBe('completed_unverified');
    expect(events.some((e) => e.type === 'completion.claim_rejected')).toBe(true);
    const prompts = provider.requests.flatMap((r) => r.messages.map((m) => String(m.content)));
    expect(prompts.some((p) => p.includes(COORDINATION_EVIDENCE_GAP))).toBe(true);
  });

  it('recovery: a later successful coordination.run clears the gate and completion is accepted', async () => {
    const provider = createScriptedProvider([
      { text: '', toolCalls: [{ name: 'alix_coordination_run', id: 'c1', args: { goal: 'x' } }] },
      { text: '', toolCalls: [{ name: 'alix_coordination_run', id: 'c2', args: { goal: 'x' } }] },
      { text: 'Done. Summary ready.' },
    ]);
    const { deps, log } = await makeTestDeps({
      provider,
      task: NO_COORD_TASK,
      taskType: 'docs',
      providerTools: [coordinationTool, doneTool],
      executor: makeExecutor(['error', 'success']),
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('completed');
    const events = await log.readAll();
    const ended = events.filter((e) => e.type === 'session.ended');
    expect((ended.at(-1)!.payload as { reason?: string }).reason).toBe('completed');
  });

  it('trackCompleted: the done tool cannot complete while the coordination gate is set', async () => {
    const provider = createScriptedProvider([
      {
        text: 'All four workers reported their outcomes.',
        toolCalls: [
          { name: 'alix_coordination_run', id: 'c1', args: { goal: 'x' } },
          { name: 'alix_done', id: 'd1', args: {} },
        ],
      },
      { text: 'Done. Task complete.' },
      { text: 'Done. Task complete.' },
      { text: 'Done. Task complete.' },
    ]);
    const { deps, log } = await makeTestDeps({
      provider,
      task: NO_COORD_TASK,
      taskType: 'docs',
      providerTools: [coordinationTool, doneTool],
      executor: makeExecutor(['error']),
      maxIterations: 4,
    });

    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('completed_unverified');
    const events = await log.readAll();
    expect(
      events.some(
        (e) =>
          e.type === 'completion.claim_rejected' &&
          (e.payload as { source?: string }).source === 'trackCompleted',
      ),
    ).toBe(true);
    const ended = events.filter((e) => e.type === 'session.ended');
    expect(ended.every((e) => (e.payload as { reason?: string }).reason !== 'completed')).toBe(true);
  });

  // POSIX-only: the verifier spawns /bin/sh; on win32 discovery returns
  // not_run and Path B is unreachable (deterministic failure).
  it.skipIf(process.platform === 'win32')('Path B: verification passing cannot complete while the last coordination.run failed', async () => {
    const tmpCwd = mkdtempSync(join(tmpdir(), 'alix-coord-pathb-'));
    writeFileSync(
      join(tmpCwd, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { lint: 'node -e "process.exit(0)"' } }),
    );
    const prevCwd = process.cwd();
    process.chdir(tmpCwd);
    try {
      const provider = createScriptedProvider([
        { text: '', toolCalls: [{ name: 'alix_coordination_run', id: 'c1', args: { goal: 'x' } }] },
        { text: 'Done. Fix verified.' },
        { text: 'Done. Fix verified.' },
        { text: 'Done. Fix verified.' },
      ]);
      const { deps, log } = await makeTestDeps({
        provider,
        task: 'Fix the failing unit test.',
        taskType: 'bugfix',
        providerTools: [coordinationTool, doneTool],
        executor: makeExecutor(['error']),
        maxIterations: 4,
      });
      deps.sessionState.changed.add('src/app.ts');

      const result = await runTaskLoop(deps);

      expect(result.reason).toBe('completed_unverified');
      const events = await log.readAll();
      const ended = events.filter((e) => e.type === 'session.ended');
      expect(ended.length).toBeGreaterThan(0);
      expect(ended.every((e) => (e.payload as { reason?: string }).reason !== 'completed')).toBe(true);
      expect((ended.at(-1)!.payload as { reason?: string }).reason).toBe('completed_unverified');
      expect(
        events.some(
          (e) =>
            e.type === 'completion.claim_rejected' &&
            (e.payload as { source?: string }).source === 'coordination_failed',
        ),
      ).toBe(true);
    } finally {
      process.chdir(prevCwd);
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});
