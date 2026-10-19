import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';
import { TimelineBuilder } from '../../../src/interfaces/tui/runtime/timeline-builder.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sessionState from '../../../src/agents/agent/session/state.js';
import { AgentSessionBuilder } from '../../../src/agents/agent/session/main.js';
import { EventLog } from '../../../src/runtime-state/events/event-log.js';
import { CoordinationStore } from '../../../src/coordination/kernel/coordination-store.js';
import { createCoordinationHandlers, COORDINATION_RUN_TOOL } from '../../../src/coordination/kernel/coordination-tools.js';
import { createCoordinationRun, createWorkerAssignment, deriveCoordinationCompletion, matchesAttachedAggregateEvent } from '../../../src/coordination/kernel/coordination-types.js';
import { computeAggregationSourceFingerprint } from '../../../src/coordination/kernel/coordination-aggregation-fingerprint.js';
import { reclaimDeadOwnerWorkers } from '../../../src/coordination/kernel/coordination-resume.js';
import { createCoordinationScheduler } from '../../../src/coordination/kernel/coordination-scheduler.js';
import { visibleArtifacts } from '../../../src/interfaces/tui/workbench/model/selection.js';
import { OwnershipRegistry } from '../../../src/coordination/ownership/ownership-registry.js';
import { ToolExecutor } from '../../../src/capabilities/tools/executor.js';
import { MemoryStore } from '../../../src/operations/utils/memory/store.js';
import { ScopeTracker } from '../../../src/planning/autonomy/scope-tracker.js';
import { MinimalMetrics } from '../../../src/coordination/kernel/minimal-metrics.js';
import { createContextBudget } from '../../../src/operations/config/context-budget.js';
import { ensureEncoder } from '../../../src/operations/utils/tokens.js';
import { AgentRosterProjection } from '../../../src/interfaces/tui/workbench/projections/agent-roster-projection.js';
import { TaskProjection } from '../../../src/interfaces/tui/workbench/projections/task-projection.js';
import { ArtifactProjection } from '../../../src/interfaces/tui/workbench/projections/artifact-projection.js';
import { buildExecutionTrace } from '../../../src/interfaces/tui/runtime/execution-trace-builder.js';
import type { AlixConfig } from '../../../src/operations/config/schema.js';
import type { AggregateCompletedEventLike } from '../../../src/coordination/kernel/coordination-types.js';
import type { CoordinationPlanner } from '../../../src/coordination/kernel/coordination-planner.js';
import type { CoordinationWorkerExecutor } from '../../../src/coordination/kernel/worker-executor.js';
import { DefaultWorkerExecutor } from '../../../src/coordination/kernel/worker-executor.js';
import type { ModelAdapter } from '../../../src/models/providers/types.js';
import { clearScriptedScenario, scriptedMockCarrier, setScriptedScenario } from '../../../src/operations/evals/providers/scripted-mock-carrier.js';
import { installEvalConfig } from '../../../src/operations/evals/evals-runner.js';
import { closeAllSharedLedgers } from '../../../src/runtime-state/storage/runtime-ledger.js';
import { ApprovalStore } from '../../../src/governance/approvals/approval-store.js';
import { ApprovalManager } from '../../../src/interfaces/tui/approval-manager.js';
import { createApprovalResolver } from '../../../src/interfaces/tui/approval-resolver.js';
import { PolicyGate } from '../../../src/governance/policy/policy-gate.js';

const roots: string[] = [];
afterEach(() => { clearScriptedScenario(); vi.unstubAllEnvs(); vi.restoreAllMocks(); closeAllSharedLedgers(); for (const cwd of roots.splice(0)) rmSync(cwd, { recursive: true, force: true }); });

async function fixture(executor: CoordinationWorkerExecutor, count = 4) {
  const cwd = mkdtempSync(join(tmpdir(), 'workbench-phase9-')); roots.push(cwd);
  const id = 'phase9-parent';
  const sessionDir = join(cwd, '.alix', 'sessions', id); await mkdir(sessionDir, { recursive: true });
  await mkdir(join(cwd, 'reports'));
  const log = new EventLog(sessionDir); await log.init();
  const store = new CoordinationStore(cwd);
  const approvalStore = new ApprovalStore(cwd, { eventLog: log }); await approvalStore.load();
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
  const handlers = createCoordinationHandlers({ cwd, config, store, eventLog: log, approvalStore, sessionId: id,
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
  return { cwd, id, log, store, approvalStore, session, state, plan, config, executor, handlers };
}

describe('Phase9 public coordination port with real handlers and scheduler', () => {
  // Covers two durable approval waits, scripted model turns, worker tool dispatch, and review; allow for slow CI ledgers.
  it('resumes an approved worker through the configured provider and verifies its owned artifact', async () => {
    const f = await fixture(new DefaultWorkerExecutor(), 1);
    f.config.models!.default = { provider: 'scripted-mock', name: 'scripted-worker', streaming: false } as any;
    f.config.model = { provider: 'scripted-mock', name: 'scripted-worker' } as any;
    f.config.permissions.default = 'ask';
    f.config.permissions.tools = { 'filesystem.write': 'ask' };
    installEvalConfig(f.cwd, 'scripted-mock');
    const evalConfigPath = join(f.cwd, '.alix', 'config.json');
    const evalConfig = JSON.parse(await readFile(evalConfigPath, 'utf8'));
    evalConfig.permissions.tools = { 'filesystem.write': 'ask' };
    await writeFile(evalConfigPath, JSON.stringify(evalConfig));
    const isolatedHome = join(f.cwd, 'isolated-home');
    vi.stubEnv('HOME', isolatedHome);
    const isolatedConfigDir = join(isolatedHome, '.config', 'alix');
    await mkdir(isolatedConfigDir, { recursive: true });
    await writeFile(join(isolatedConfigDir, 'config.json'), JSON.stringify({ apiKeys: {} }));
    setScriptedScenario({ steps: [
      { kind: 'tool', tool: 'file.create', args: {
        path: 'reports/0.md', content: '# Scripted worker output\nprovider=scripted-mock\n',
      } },
      ...Array.from({ length: 8 }, () => ({
        kind: 'text' as const,
        text: '{"satisfied":true,"summary":"Created the requested report.","gaps":[]}',
      })),
    ] });

    const approvalManager = new ApprovalManager({
      listPendingApprovals: async () => {
        await f.approvalStore.load();
        return f.approvalStore.listPending().map(record => ({
          id: record.id, workerId: record.workerId, capabilities: record.capabilities, reason: record.reason, createdAt: record.createdAt,
        }));
      },
      resolveApproval: async (id, status) => {
        const record = await f.approvalStore.resolve(id, status, 'TUI provider integration');
        return { success: record?.status === status, message: record ? `Approval ${id} ${status}.` : `Approval ${id} missing.` };
      },
    });
    const approvalResolver = createApprovalResolver({
      views: () => ({} as any), activeTab: () => 'agent', syncTabs: ['agent'], approvalManager,
      emit: () => {}, refresh: async () => {},
    });
    const approvedIds = new Set<string>();
    const waitForPendingApproval = async () => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const pending = f.approvalStore.listPending().find(record => !approvedIds.has(record.id));
        if (pending) return pending;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const runs = await f.store.list();
      const events = await f.log.readAll();
      throw new Error(`Timed out waiting for the next durable approval (planner=${f.plan.mock.calls.length}, run=${runs.map(run => `${run.status}:${run.workers.map(worker => `${worker.id}:${worker.status}:${worker.blockReason ?? '-'}`).join(',')}`).join(';')}, pending=${f.approvalStore.listPending().length}, events=${events.map(event => event.type).join(',')})`);
    };

    let runSettled = false;
    const controller = new AbortController();
    const runArgs = { goal: 'Create one report', maxConcurrency: 1, sessionMode: 'ask' };
    const pendingRun = f.handlers[COORDINATION_RUN_TOOL](runArgs, {
      toolCallId: 'tui-approval-provider-integration', name: COORDINATION_RUN_TOOL,
      args: runArgs, signal: controller.signal,
    } as any);
    void pendingRun.then(() => { runSettled = true; }, () => { runSettled = true; });
    try {
      const dispatchApproval = await waitForPendingApproval();
      expect(dispatchApproval.workerId).toBe('phase9-worker-0');
      expect(await approvalResolver.resolve(dispatchApproval.id, 'approved')).toBe(true);
      approvedIds.add(dispatchApproval.id);
      await expect(f.approvalStore.loadFresh(dispatchApproval.id)).resolves.toMatchObject({ status: 'approved' });

      // The real worker then requests its owned file mutation; resolve that TUI-visible request too.
      const fileApproval = await waitForPendingApproval();
      expect(scriptedMockCarrier.calls).toBeGreaterThan(0);
      expect(fileApproval.id).not.toBe(dispatchApproval.id);
      expect(await approvalResolver.resolve(fileApproval.id, 'approved')).toBe(true);
      approvedIds.add(fileApproval.id);

      const result = await pendingRun;
      const run = (await f.store.list())[0]!;
      const events = await f.log.readAll();

      expect(run.status).toBe('completed');
      expect(scriptedMockCarrier.calls).toBeGreaterThan(0);
      const artifact = await readFile(join(f.cwd, 'reports/0.md'), 'utf8');
      expect(artifact).toContain('provider=scripted-mock');
      expect(run.workers[0]).toMatchObject({ status: 'completed' });
      expect(events.some(event => event.type === 'tool.completed' && (event.payload as any)?.toolName === 'file.create')).toBe(true);
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      expect(result.output).toContain('Status: completed');
      await f.approvalStore.load();
      expect(f.approvalStore.get(dispatchApproval.id)?.status).toBe('consumed');
      expect(f.approvalStore.get(fileApproval.id)?.status).toBe('consumed');
    } finally {
      if (!runSettled) {
        controller.abort();
        await Promise.race([pendingRun.catch(() => {}), new Promise(resolve => setTimeout(resolve, 2_000))]);
      }
    }
  }, 120_000);

  it('qualifies an in-process owned write and reviewer read under explicit test policy', async () => {
    const f = await fixture(new DefaultWorkerExecutor(), 1);
    const policyGateSpy = vi.spyOn(PolicyGate.prototype, 'evaluateToolCall');
    f.config.permissions.default = 'ask';
    f.config.permissions.tools = {
      'filesystem.write': 'allow',
      'file.write': 'allow',
      'file.read': 'allow',
    };
    f.config.permissions.protectedPaths = ['.git/**', '.env', '.env.*', 'secrets/**'];
    f.config.models!.default = { provider: 'scripted-mock', name: 'scripted-worker', streaming: false } as any;
    f.config.model = { provider: 'scripted-mock', name: 'scripted-worker' } as any;
    installEvalConfig(f.cwd, 'scripted-mock');
    const evalConfigPath = join(f.cwd, '.alix', 'config.json');
    const evalConfig = JSON.parse(await readFile(evalConfigPath, 'utf8'));
    evalConfig.permissions.default = 'ask';
    evalConfig.permissions.tools = { ...f.config.permissions.tools };
    evalConfig.permissions.protectedPaths = [...f.config.permissions.protectedPaths];
    await writeFile(evalConfigPath, JSON.stringify(evalConfig));
    const isolatedHome = join(f.cwd, 'isolated-home');
    vi.stubEnv('HOME', isolatedHome);
    const isolatedConfigDir = join(isolatedHome, '.config', 'alix');
    await mkdir(isolatedConfigDir, { recursive: true });
    await writeFile(join(isolatedConfigDir, 'config.json'), JSON.stringify({ apiKeys: {} }));
    setScriptedScenario({ steps: [
      { kind: 'tool', tool: 'file.create', args: {
        path: 'reports/0.md', content: '# Scripted worker output\nprovider=scripted-mock\n',
      } },
      ...Array.from({ length: 8 }, () => ({
        kind: 'text' as const,
        text: '{"satisfied":true,"summary":"Created the requested report.","gaps":[]}',
      })),
    ] });

    const runArgs = { goal: 'Create one report', maxConcurrency: 1, sessionMode: 'ask' };
    const result = await f.handlers[COORDINATION_RUN_TOOL](runArgs, {
      toolCallId: 'inprocess-owned-path-qualification', name: COORDINATION_RUN_TOOL,
      args: runArgs,
    } as any);
    const run = (await f.store.list())[0]!;
    const events = await f.log.readAll();

    expect(result.kind).toBe('success');
    expect(scriptedMockCarrier.calls).toBeGreaterThan(0);
    expect(run).toMatchObject({ status: 'completed' });
    expect(run.workers[0]).toMatchObject({ status: 'completed' });
    expect(run.workers[0]?.resultRef).toBeTruthy();
    expect(run.aggregateResultRef).toBeTruthy();
    expect(matchesAttachedAggregateEvent(run, events as AggregateCompletedEventLike[])).toBe(true);
    expect(deriveCoordinationCompletion(run, {
      aggregateEventMatches: true,
      currentFingerprint: computeAggregationSourceFingerprint(run),
    })).toMatchObject({ execution: 'completed', aggregation: 'generated', verification: 'verified' });

    const artifact = await readFile(join(f.cwd, 'reports/0.md'), 'utf8');
    expect(artifact).toContain('provider=scripted-mock');
    expect(events.some(event => event.type === 'tool.completed'
      && (event.payload as any)?.toolName === 'file.create')).toBe(true);
    expect(events.some(event => event.type === 'file.created'
      && (event.payload as any)?.path === 'reports/0.md')).toBe(true);

    const reviewReadIndex = policyGateSpy.mock.calls.findIndex(([request]) =>
      request.toolName === 'file.read' && request.args.path === 'reports/0.md');
    expect(reviewReadIndex).toBeGreaterThanOrEqual(0);
    const reviewReadRequest = policyGateSpy.mock.calls[reviewReadIndex]?.[0];
    const reviewReadDecision = await policyGateSpy.mock.results[reviewReadIndex]?.value;
    expect(reviewReadRequest).toMatchObject({
      toolName: 'file.read',
      capability: 'file.read',
      source: 'tool',
      cwd: f.cwd,
      sessionMode: 'ask',
    });
    expect(reviewReadDecision).toMatchObject({
      capability: 'file.read',
      decision: 'allow',
      matchedRuleId: 'tool-policy-file.read',
      reason: 'Allowed by tool policy (mode: ask)',
    });

    const protectedRead = await new ToolExecutor(
      f.config, f.log, f.cwd, undefined, undefined, undefined, undefined, f.approvalStore,
    ).execute({ toolCallId: 'protected-read-check', name: 'file.read', args: { path: '.env' } } as any);
    expect(protectedRead).toMatchObject({ kind: 'error', message: expect.stringMatching(/path is protected/i) });
    await f.approvalStore.load();
    expect(f.approvalStore.listPending()).toHaveLength(0);
  }, 120_000);

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
    const reclaimed = await reclaimDeadOwnerWorkers(f.store, planned.run.id, new OwnershipRegistry(f.cwd));
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
