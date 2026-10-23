/** Four-worker real-kernel mechanics fixture. No models, credentials or network. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CoordinationPlanner } from '../../../dist/src/coordination/kernel/coordination-planner.js';
import { CoordinationStore } from '../../../dist/src/coordination/kernel/coordination-store.js';
import { createCoordinationHandlers } from '../../../dist/src/coordination/kernel/coordination-tools.js';
import { CoordinationResultStore } from '../../../dist/src/coordination/kernel/coordination-result-store.js';
import { deriveRunCompletion } from '../../../dist/src/coordination/kernel/coordination-view.js';
import { OwnershipRegistry } from '../../../dist/src/coordination/ownership/ownership-registry.js';
import { ApprovalStore } from '../../../dist/src/governance/approvals/approval-store.js';
import { ToolExecutor } from '../../../dist/src/capabilities/tools/executor.js';
import { EventLog } from '../../../dist/src/runtime-state/events/event-log.js';

export async function runFourWorkerScripted() {
  const cwd = mkdtempSync(join(tmpdir(), 'alix-four-worker-'));
  const sessionId = 'four-worker-scripted';
  const expected = Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [`docs/${id}.txt`, `${id.toUpperCase()}-MARKER\n`]));
  const observations = [];
  try {
    mkdirSync(join(cwd, 'docs'));
    const sessionDir = join(cwd, '.alix', 'sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const eventLog = new EventLog(sessionDir);
    await eventLog.init();
    const config = {
      version: 1,
      permissions: { default: 'allow', tools: { 'shell.run': 'deny', 'web.fetch': 'deny', 'web.search': 'deny' }, protectedPaths: [], allowNetworkDomains: [], denyCommands: [], sessionMode: 'ask' },
      context: { repoMap: false, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
      runtime: { provider: 'process', shell: '/bin/sh', commandTimeoutMs: 1000, envAllowlist: [] },
      ui: { enabled: false },
    };
    const store = new CoordinationStore(cwd);
    const approvalStore = new ApprovalStore(cwd);
    await approvalStore.load();
    const nodes = ['a', 'b', 'c', 'd'].map((id, index) => ({
      id, title: `worker-${id}`, goal: `Create docs/${id}.txt. Owns only docs/${id}.txt.`,
      domain: 'docs', requiredCapabilities: ['filesystem.write'],
      dependencies: index === 3 ? ['a', 'b', 'c'] : [], riskLevel: 'low',
    }));
    const planner = new CoordinationPlanner(cwd, { generate: async () => JSON.stringify({ nodes }) }, { store });
    const executor = {
      async execute(worker, context, signal) {
        const paths = worker.ownershipClaims.map(claim => claim.path);
        assert.equal(paths.length, 1);
        const path = paths[0];
        assert.ok(Object.hasOwn(expected, path));
        const liveLeases = await new OwnershipRegistry(cwd).listActive();
        const ownLeases = liveLeases.filter(lease => lease.agentId === worker.agentId || lease.agentId === worker.id);
        assert.ok(ownLeases.some(lease => lease.scope.root === join(cwd, path)), 'worker must hold a real lease for exact owned output');
        const toolExecutor = new ToolExecutor(context.config, eventLog, cwd, undefined, undefined, undefined, undefined, approvalStore, undefined, undefined, paths);
        const forbidden = await toolExecutor.execute({ toolCallId: `${worker.id}-outside`, name: 'file.create', args: { path: 'docs/outside.txt', content: 'forbidden' }, signal, agentId: worker.agentId, sessionId, ownedPaths: paths });
        assert.equal(forbidden.kind, 'denied', 'owned boundary must deny out-of-scope write');
        if (path === 'docs/d.txt') {
          assert.equal(context.dependencyResults.length, 3);
          assert.deepEqual(context.dependencyResults.map(item => item.workerId).sort(), [...worker.dependencies].sort());
          for (const item of context.dependencyResults) { assert.equal(item.warning, undefined); assert.equal(item.record?.outcome, 'success'); }
          for (const producer of ['a', 'b', 'c']) assert.equal(readFileSync(join(cwd, `docs/${producer}.txt`), 'utf8'), expected[`docs/${producer}.txt`]);
        }
        const written = await toolExecutor.execute({ toolCallId: `${worker.id}-write`, name: 'file.create', args: { path, content: expected[path] }, signal, agentId: worker.agentId, sessionId, ownedPaths: paths, coordinationRunId: context.run.id, taskId: worker.id });
        assert.equal(written.kind, 'success');
        assert.equal(readFileSync(join(cwd, path), 'utf8'), expected[path]);
        observations.push({ workerId: worker.id, agentId: worker.agentId, path, dependencies: [...worker.dependencies], dependencyResults: context.dependencyResults?.map(result => ({ workerId: result.workerId })), leaseIds: ownLeases.map(lease => lease.id), outsideDenied: true });
        return { outcome: 'success', summary: `Created ${path}; exact content independently checked.`, outputPath: path };
      },
    };
    const handlers = createCoordinationHandlers({ cwd, config, store, planner, executor, eventLog, approvalStore, sessionId });
    const outer = new ToolExecutor(config, eventLog, cwd, undefined, undefined, handlers, undefined, approvalStore);
    const result = await outer.execute({ toolCallId: 'four-worker-run', name: 'coordination.run', args: { goal: 'Use four workers to create docs/a.txt, docs/b.txt, docs/c.txt, docs/d.txt with distinct markers. Worker d depends on a, b, c.', maxConcurrency: 4 }, sessionId });
    assert.equal(result.kind, 'success', JSON.stringify(result));
    const runs = await store.list();
    assert.equal(runs.length, 1);
    const run = await store.load(runs[0].id);
    const derived = await deriveRunCompletion(cwd, run);
    assert.equal(run.status, 'completed');
    assert.equal(derived.completion.verification, 'verified');
    assert.equal(derived.completion.aggregation, 'generated');
    assert.equal(derived.completion.outcome, 'success');
    assert.equal(run.workers.length, 4);
    assert.equal(new Set(run.workers.map(worker => worker.id)).size, 4);
    assert.equal(new Set(run.workers.map(worker => worker.agentId)).size, 4);
    assert.equal(observations.length, 4);
    assert.equal(new Set(observations.map(row => row.path)).size, 4);
    const resultStore = new CoordinationResultStore(cwd);
    const outcomes = [];
    for (const worker of run.workers) {
      assert.equal(worker.status, 'completed'); assert.ok(worker.resultRef);
      const loaded = await resultStore.loadByRef(worker.resultRef);
      assert.equal(loaded.status, 'ok'); assert.equal(loaded.record.outcome, 'success');
      assert.equal(loaded.record.workerId, worker.id); assert.equal(loaded.record.runId, run.id);
      outcomes.push({ workerId: worker.id, outcome: loaded.record.outcome });
    }
    assert.equal(existsSync(join(cwd, 'docs/outside.txt')), false);
    const outputs = Object.entries(expected).map(([path, content]) => ({ path, content: readFileSync(join(cwd, path), 'utf8'), expected: content }));
    for (const output of outputs) assert.equal(output.content, output.expected);
    return { schemaVersion: 1, stratum: 6, evidenceClass: 'scripted-real-kernel-mechanics', scripted: true, model: null, costUSD: null, verifiedPaidBaselineSuccesses: 0, coordinationRunId: run.id, completion: derived.completion, workers: run.workers.map(worker => ({ id: worker.id, agentId: worker.agentId, status: worker.status, resultRef: worker.resultRef, dependencies: worker.dependencies, ownedPaths: worker.ownershipClaims.map(claim => claim.path) })), outcomes, observations, outputs };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(`${JSON.stringify(await runFourWorkerScripted(), null, 2)}\n`);
