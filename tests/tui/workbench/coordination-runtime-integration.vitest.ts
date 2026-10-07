import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sessionState from '../../../src/agent/session/state.js';
import { AgentSessionBuilder } from '../../../src/agent/session/main.js';
import { EventLog } from '../../../src/events/event-log.js';
import { CoordinationStore } from '../../../src/kernel/coordination-store.js';
import { createCoordinationHandlers } from '../../../src/kernel/coordination-tools.js';
import { createCoordinationRun, createWorkerAssignment, deriveCoordinationCompletion, matchesAttachedAggregateEvent } from '../../../src/kernel/coordination-types.js';
import { computeAggregationSourceFingerprint } from '../../../src/kernel/coordination-aggregation-fingerprint.js';
import { reclaimDeadOwnerWorkers } from '../../../src/kernel/coordination-resume.js';
import { createCoordinationScheduler } from '../../../src/kernel/coordination-scheduler.js';
import { visibleArtifacts } from '../../../src/tui/workbench/model/selection.js';
import { OwnershipRegistry } from '../../../src/ownership/ownership-registry.js';
import { ToolExecutor } from '../../../src/tools/executor.js';
import { MemoryStore } from '../../../src/utils/memory/store.js';
import { ScopeTracker } from '../../../src/autonomy/scope-tracker.js';
import { MinimalMetrics } from '../../../src/kernel/minimal-metrics.js';
import { createContextBudget } from '../../../src/config/context-budget.js';
import { ensureEncoder } from '../../../src/utils/tokens.js';
import { AgentRosterProjection } from '../../../src/tui/workbench/projections/agent-roster-projection.js';
import { TaskProjection } from '../../../src/tui/workbench/projections/task-projection.js';
import { ArtifactProjection } from '../../../src/tui/workbench/projections/artifact-projection.js';
import { buildExecutionTrace } from '../../../src/tui/runtime/execution-trace-builder.js';
import type { AlixConfig } from '../../../src/config/schema.js';
import type { AggregateCompletedEventLike } from '../../../src/kernel/coordination-types.js';
import type { CoordinationPlanner } from '../../../src/kernel/coordination-planner.js';
import type { CoordinationWorkerExecutor } from '../../../src/kernel/worker-executor.js';
import type { ModelAdapter } from '../../../src/providers/types.js';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cwd of roots.splice(0)) rmSync(cwd, { recursive: true, force: true }); });

async function fixture(executor: CoordinationWorkerExecutor, count = 4) {
  const cwd = mkdtempSync(join(tmpdir(), 'workbench-phase9-')); roots.push(cwd);
  const id = 'phase9-parent';
  const sessionDir = join(cwd, '.alix', 'sessions', id); await mkdir(sessionDir, { recursive: true });
  await mkdir(join(cwd, 'reports'));
  const log = new EventLog(sessionDir); await log.init();
  const store = new CoordinationStore(cwd);
  const config = { version: 1,
    model: { provider: 'mock', name: 'mock' }, models: { default: { provider: 'mock', name: 'mock', streaming: false } },
    permissions: { default: 'allow', tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [], sessionMode: 'bypass' },
    context: { repoMap: false, repoMapMode: 'lite', maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: 'process', shell: 'bash', commandTimeoutMs: 1000, envAllowlist: [] },
    ui: { enabled: false, host: '127.0.0.1', port: 0, transport: 'sse' }, skills: {}, apiKeys: {},
  } as unknown as AlixConfig;
  const plan = vi.fn(async (goal: string, _agent: string, sessionId: string, options: any) => {
    const run = createCoordinationRun({ sessionId, rootGoal: goal, coordinatorAgentId: 'alix' });
    run.hostKind = 'cli'; run.sessionMode = options.sessionMode; run.maxConcurrency = options.maxConcurrency;
    await store.save(run);
    const workers = Array.from({ length: count }, (_, index) => createWorkerAssignment({
      id: `phase9-worker-${index}`, coordinationRunId: run.id, agentId: 'shared-role',
      taskLabel: `Report ${index}`, goalPrompt: `Create reports/${index}.md`,
      dependencies: index === 2 ? ['phase9-worker-0', 'phase9-worker-1'] : index === 3 ? ['phase9-worker-2'] : [],
      inputPaths: index === 2 ? ['reports/0.md', 'reports/1.md'] : index === 3 ? ['reports/2.md'] : [],
      ownershipScopes: [`reports/${index}.md`], ownershipClaims: [{ path: `reports/${index}.md`, recursive: false }],
      requiredCapabilities: ['filesystem.write'], maxAttempts: 2, planOrder: index,
    }));
    for (const worker of workers) await store.addWorker(run.id, worker);
    return { valid: true, errors: [], run: { ...run, workers } };
  });
  const handlers = createCoordinationHandlers({ cwd, config, store, eventLog: log, sessionId: id,
    planner: { plan } as unknown as CoordinationPlanner, executor });
  const toolExecutor = new ToolExecutor(config, log, cwd, undefined, undefined, handlers);
  const memoryStore = new MemoryStore(join(cwd, 'memory')); await memoryStore.init();
  const provider: ModelAdapter = {
    id: 'mock', capabilities: { provider: 'mock', model: 'mock', inputTokenLimit: 100000, outputTokenLimit: 16384,
      supportsTools: true, supportsStreaming: false, supportsStructuredOutput: false, supportsVision: false, parallelToolCalls: false },
    editFormatPreference: 'search_replace', longContextStrategy: 'trimmed_context',
    complete: async () => ({ text: 'The coordination runtime returned its worker outcomes and aggregate evidence.', toolCalls: [], finishReason: 'stop' }),
  };
  await ensureEncoder('cl100k_base');
  const state = sessionState.createSessionState({ cwd, task: '', sessionId: id, streaming: false, verbose: false, readOnly: false });
  state.initialized = true;
  state.ctx = { sessionId: id, sessionDir, log, provider, config, toolExecutor, memoryStore, scope: new ScopeTracker() } as any;
  state.session = { sessionId: id, actor: 'system' }; state.metrics = new MinimalMetrics();
  state.systemPrompt = 'Report only the observed outcomes.';
  state.contextBudget = createContextBudget({ contextWindowTokens: 100000 }, { outputRatio: .1, outputFloor: 1000, outputCap: 16384 });
  state.cappedIterations = 5;
  state.providerTools = [{ name: 'alix_coordination_run', description: 'Run coordinated workers', input_schema: {
    type: 'object', properties: { goal: { type: 'string' }, maxConcurrency: { type: 'number' } }, required: ['goal'] } }];
  vi.spyOn(sessionState, 'createSessionState').mockReturnValueOnce(state);
  const session = new AgentSessionBuilder(state.config).build();
  return { cwd, id, log, store, session, state, plan, config, executor };
}

describe('Phase9 public coordination port with real handlers and scheduler', () => {
  it('runs four dependent workers, retries identity safely, and verifies the actual aggregate', async () => {
    const attempts: string[] = [];
    const f = await fixture({ execute: async (worker, ctx) => {
      attempts.push(`${worker.id}:${worker.attempt}`);
      if (worker.id === 'phase9-worker-0' && worker.attempt === 1) return { outcome: 'failure', error: 'scripted transient', failureKind: 'transient_provider' };
      for (const path of worker.inputPaths ?? []) expect(await readFile(join(ctx.cwd, path), 'utf8')).toContain('Report');
      const path = worker.ownershipScopes[0]!;
      await writeFile(join(ctx.cwd, path), `${worker.taskLabel}\nworker=${worker.id}\nattempt=${worker.attempt}\n`);
      // Executor emits artifacts it actually produced; handler/scheduler own lifecycle.
      await f.log.append({ sessionId: f.id, actor: 'agent', type: 'artifact.created', payload: {
        artifactId: `${worker.id}-${worker.attempt}`, path, agentId: worker.id, taskId: worker.id, coordinationRunId: ctx.run.id,
      } });
      return { outcome: 'success', summary: `${worker.taskLabel} produced`, outputPath: path };
    } });
    const result = await f.session.runCoordination!({ goal: 'Create four dependent reports', maxConcurrency: 2 });
    expect(f.plan).toHaveBeenCalledTimes(1);
    const run = (await f.store.list())[0]!;
    expect(run).toMatchObject({ sessionId: f.id, status: 'completed', sessionMode: 'bypass', maxConcurrency: 2 });
    expect(run.workers.every(worker => worker.status === 'completed' && worker.resultRef)).toBe(true);
    expect(attempts.filter(entry => entry.startsWith('phase9-worker-0:'))).toEqual(['phase9-worker-0:1', 'phase9-worker-0:2']);
    const events = await f.log.readAll();
    expect(matchesAttachedAggregateEvent(run, events as AggregateCompletedEventLike[])).toBe(true);
    expect(deriveCoordinationCompletion(run, { aggregateEventMatches: true, currentFingerprint: computeAggregationSourceFingerprint(run) })).toMatchObject({ execution: 'completed', aggregation: 'generated', verification: 'verified' });
    expect(deriveCoordinationCompletion(run)).toMatchObject({ execution: 'completed', verification: 'unverified' });
    expect(events.some(event => event.type === 'tool.completed' && (event.payload as any)?.toolName === 'coordination.run')).toBe(true);
    // Actual files alone do not fake mutation/verification tool evidence.
    expect(result.reason).toBe('completed_unverified');
    const agents = new AgentRosterProjection(); agents.update(events);
    const tasks = new TaskProjection(); tasks.update(events);
    const artifacts = new ArtifactProjection(); artifacts.update(events);
    expect(agents.snapshot().agents.filter(agent => agent.coordinationRunId === run.id)).toHaveLength(4);
    expect(tasks.snapshot().tasks.filter(task => task.coordinationRunId === run.id)).toHaveLength(4);
    expect(artifacts.snapshot().items.filter(item => item.coordinationRunId === run.id && item.kind === 'artifact')).toHaveLength(4);
    expect(visibleArtifacts(artifacts.snapshot().items, { runId: run.id, agentId: 'phase9-worker-2' }).filter(item => item.kind === 'artifact')).toHaveLength(1);
    expect(matchesAttachedAggregateEvent({ ...run, aggregateSourceFingerprint: 'stale' }, events as AggregateCompletedEventLike[])).toBe(false);
    const timeline = new TimelineBuilder(f.id); timeline.update(events);
    const harness = createWorkbenchRenderHarness();
    const runtime = { ...harness.state.lastSnapshot!.runtime!, sessionId: f.id, totalEventCount: events.length,
      trace: buildExecutionTrace(events),
      timeline: timeline.snapshot(), agents: agents.snapshot(), tasks: tasks.snapshot(), artifacts: artifacts.snapshot() };
    harness.state.lastSnapshot = { ...harness.state.lastSnapshot!, cwd: f.cwd, runtime };
    const internal = harness.app as any; internal.agentRuntime = runtime;
    internal.workbenchStore.dispatch({ type: 'drawer.toggle', drawer: 'agents' });
    internal.workbenchStore.dispatch({ type: 'agent.select', agentId: 'phase9-worker-2', scrollOffset: 0 });
    const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    try {
      Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 200 });
      Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 44 });
      harness.paint();
      const frame = harness.output.writes.join('').replace(/\x1b\[[0-9;]*m/gu, '');
      expect(frame).toContain('AGENTS & TASKS'); expect(frame).toContain('LIVE TRANSCRIPT'); expect(frame).toContain('AGENT DETAILS');
      expect(frame).toContain('Report 2'); expect(frame).toContain('phase9-worker-2');
      expect(frame).toContain('coordination.run'); expect(frame).toContain('reports/2.md');
    } finally {
      if (columns) Object.defineProperty(process.stdout, 'columns', columns); else delete (process.stdout as any).columns;
      if (rows) Object.defineProperty(process.stdout, 'rows', rows); else delete (process.stdout as any).rows;
    }

  }, 30000);

  it('completes a read-only four-worker objective only after real aggregate verification', async () => {
    const attempts: string[] = [];
    const f = await fixture({ execute: async worker => {
      attempts.push(`${worker.id}:${worker.attempt}`);
      if (worker.id === 'phase9-worker-0' && worker.attempt === 1) return { outcome: 'failure', failureKind: 'transient_provider', error: 'retry research' };
      return { outcome: 'success', summary: `Observed findings for ${worker.taskLabel}` };
    } });
    const result = await f.session.runCoordination!({ goal: 'Coordinate four read-only research workers and report their findings without changing files.', maxConcurrency: 2 });
    expect(result.reason, result.summary).toBe('completed');
    const run = (await f.store.list())[0]!;
    const events = await f.log.readAll();
    expect(matchesAttachedAggregateEvent(run, events as AggregateCompletedEventLike[])).toBe(true);
    expect(deriveCoordinationCompletion(run, { aggregateEventMatches: true })).toMatchObject({ verification: 'verified', outcome: 'success' });
    expect(attempts.filter(entry => entry.startsWith('phase9-worker-0:'))).toEqual(['phase9-worker-0:1', 'phase9-worker-0:2']);
    expect(new Set(run.workers.map(worker => worker.id)).size).toBe(4);
    expect(run.workers[2]?.dependencies).toEqual(['phase9-worker-0', 'phase9-worker-1']);
    expect(run.workers.every(worker => worker.resultRef && worker.status === 'completed')).toBe(true);
    const agents = new AgentRosterProjection(); agents.update(events);
    expect(agents.snapshot().agents.filter(agent => agent.coordinationRunId === run.id)).toHaveLength(4);
  }, 30000);

  it('operator cancellation reaches the executing worker and releases persisted ownership', async () => {
    let started!: () => void; const start = new Promise<void>(resolve => { started = resolve; });
    let workerAborted = false;
    const f = await fixture({ execute: async (_worker, _ctx, signal) => {
      started(); await new Promise<void>(resolve => { signal.addEventListener('abort', () => { workerAborted = true; resolve(); }, { once: true }); });
      return { outcome: 'failure', error: 'cancelled', failureKind: 'cancelled' };
    } }, 1);
    const pending = f.session.runCoordination!({ goal: 'Create a report', maxConcurrency: 1 });
    const settled = pending.catch(error => error);
    await start;
    expect(f.session.cancelActiveTurn!('operator cancellation')).toBe(true);
    await settled;
    expect(workerAborted).toBe(true);
    const run = (await f.store.list())[0]!;
    expect(run.status).toBe('cancelled'); expect(run.workers.every(worker => worker.status === 'cancelled' && !worker.leaseIds?.length)).toBe(true);
    const ownership = new OwnershipRegistry(f.cwd); await ownership.prune();
    expect(ownership.list().filter(record => record.status === 'active')).toHaveLength(0);
  }, 30000);

  it('dead-owner reclaim preserves run identity, approval mode, concurrency and dependency inputs', async () => {
    const executed: string[] = [];
    const f = await fixture({ execute: async worker => { executed.push(`${worker.id}:${worker.attempt}`); return { outcome: 'success', summary: 'Recovered report' }; } }, 1);
    const planned = await f.plan('Resume existing report', 'alix', f.id, { sessionMode: 'ask', maxConcurrency: 1 });
    const worker = planned.run.workers[0]!;
    await f.store.patchWorker(planned.run.id, worker.id, { status: 'running', executionOwnerId: 'tool-99999999' });
    const reclaimed = await reclaimDeadOwnerWorkers(f.store, planned.run.id);
    expect(reclaimed.reclaimedWorkerIds).toEqual([worker.id]);
    const run = (await f.store.load(planned.run.id))!;
    expect(run).toMatchObject({ id: planned.run.id, sessionMode: 'ask', maxConcurrency: 1 });
    expect(run.workers[0]).toMatchObject({ id: worker.id, status: 'pending', attempt: 1, ownershipScopes: worker.ownershipScopes });
    const scheduler = createCoordinationScheduler({ cwd: f.cwd, daemonInstanceId: `tool-${process.pid}`, store: f.store, eventLog: f.log,
      configProvider: async () => f.config, ownershipRegistry: new OwnershipRegistry(f.cwd), executor: f.executor,
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
    }, { maxConcurrency: run.maxConcurrency });
    try {
      await scheduler.runUntilIdle(run.id, { pollIntervalMs: 5, timeoutMs: 5000 });
      expect(executed).toEqual([`${worker.id}:2`]);
      const resumed = (await f.store.load(run.id))!;
      expect(resumed).toMatchObject({ id: run.id, sessionId: f.id, sessionMode: 'ask', maxConcurrency: 1, status: 'completed' });
      await vi.waitFor(async () => {
        const current = (await f.store.load(run.id))!;
        expect(matchesAttachedAggregateEvent(current, await f.log.readAll() as AggregateCompletedEventLike[])).toBe(true);
      });
    } finally { await scheduler.shutdown(); }
  });
});
