/** Actual production refusal: unlike historical-loop suites, the guard is real. */
import {describe, it, expect, vi, beforeEach} from 'vitest';
const calls = vi.hoisted(() => ({load: vi.fn(), run: vi.fn(), provider: vi.fn()}));
vi.mock('../../src/operations/config/loader.js', () => ({loadConfig: calls.load}));
vi.mock('../../src/run.js', () => ({runTask: calls.run, buildToolsForProvider: vi.fn()}));
vi.mock('../../src/models/providers/registry.js', () => ({createProvider: calls.provider}));
import {SubagentCLI} from '../../src/agents/subagent-cli.js';
import {DefaultWorkerExecutor} from '../../src/coordination/kernel/worker-executor.js';
beforeEach(() => vi.clearAllMocks());
describe('GE-04 real entry refusal before credential/model execution', () => {
  it('direct SubagentCLI rejects before argument/config/provider work', async () => {
    await expect(SubagentCLI.main(['--subagent', 'worker', '--credential-fd', '3', '--ge04-startup-fd', '4'])).rejects.toThrow(/SECURITY HOLD/);
    expect(calls.load).not.toHaveBeenCalled();
    expect(calls.run).not.toHaveBeenCalled();
    expect(calls.provider).not.toHaveBeenCalled();
  });
  it.each([false, true])('in-process default cannot bypass refusal with approval store present=%s', async withStore => {
    const store = withStore ? {get() {throw new Error('Approval store must not be accessed');}} as never : undefined;
    const result = await new DefaultWorkerExecutor(store).execute({} as never, {} as never, new AbortController().signal);
    expect(result.outcome).toBe('failure');
    expect(result.failureKind).toBe('authorization_denied');
    expect(result.error).toMatch(/SECURITY HOLD/);
    expect(calls.load).not.toHaveBeenCalled();
    expect(calls.run).not.toHaveBeenCalled();
    expect(calls.provider).not.toHaveBeenCalled();
  });
  it('already-aborted default stays cancelled without execution', async () => {
    const controller = new AbortController(); controller.abort();
    const result = await new DefaultWorkerExecutor().execute({} as never, {} as never, controller.signal);
    expect(result.failureKind).toBe('cancelled');
    expect(calls.run).not.toHaveBeenCalled();
  });
});


import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GraphExecutor, loadGraph} from '../../src/coordination/kernel/graph-executor.js';
import {closeSharedLedger} from '../../src/runtime-state/storage/runtime-ledger.js';

async function withGraph(status: 'pending' | 'failed' | 'done', work: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), 'ge04-graph-refusal-'));
  try {
    await mkdir(join(cwd, '.alix', 'graphs'), {recursive: true});
    const node = {id: 'first', graphId: 'guard', title: 'First', goal: 'must not execute',
      domain: 'general', status, dependencies: [], requiredCapabilities: [],
      riskLevel: 'low', approvalMode: 'auto', inputs: {}, artifacts: [], memoryRefs: [],
      timeoutMs: 1, createdAt: '', updatedAt: ''};
    await writeFile(join(cwd, '.alix', 'graphs', 'guard.json'), JSON.stringify({
      id: 'guard', schemaVersion: '1.0', workflowId: 'test', rootGoal: 'test', status: 'ready',
      strategy: 'sequential', nodes: [node, {...node, id: 'later', dependencies: ['first']}],
      edges: [], createdAt: '', updatedAt: '',
    }));
    await work(cwd);
  } finally {closeSharedLedger(cwd); await rm(cwd, {recursive: true, force: true});}
}

describe('GE-04 graph CLI and SOP real refusal', () => {
  it.each([false, true])('execute refuses and stops before later nodes with enforcement=%s', async enforcement => {
    await withGraph('pending', async cwd => {
      let tick = 100;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => tick += 10);
      try {
        const executor = new GraphExecutor(cwd, {enforceCapabilities: enforcement,
          policyGate: {evaluateCapability: vi.fn()} as never, config: {} as never});
        const result = await executor.execute('guard');
        expect(result.graphStatus).toBe('failed');
        expect(result.completedNodes).toBe(0);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].status).toBe('failed');
        // The elapsed legacy node timeout must not replace the refusal reason.
        expect(result.results[0].reason).toMatch(/SECURITY HOLD/);
        expect(calls.load).not.toHaveBeenCalled();
        expect(calls.run).not.toHaveBeenCalled();
        expect(calls.provider).not.toHaveBeenCalled();
      } finally {clock.mockRestore();}
    });
  });
  it.each(['failed', 'done'] as const)('rerun persists refusal even for forced %s node', async status => {
    await withGraph(status, async cwd => {
      const result = await new GraphExecutor(cwd, {enforceCapabilities: false})
        .rerunNode('guard', 'first', {force: status === 'done'});
      expect(result.status).toBe('failed');
      expect(result.reason).toMatch(/SECURITY HOLD/);
      const graph = await loadGraph('guard', cwd);
      expect(graph.status).toBe('failed');
      expect(graph.nodes[0].status).toBe('failed');
      const attempts = JSON.parse(await readFile(join(cwd, '.alix', 'graphs', 'guard.runs.json'), 'utf8'));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({status: 'failed', nodeId: 'first'});
      expect(attempts[0].error).toMatch(/SECURITY HOLD/);
      expect(calls.load).not.toHaveBeenCalled();
      expect(calls.run).not.toHaveBeenCalled();
      expect(calls.provider).not.toHaveBeenCalled();
    });
  });
});
