/** Credential-free supervisor double. No process/model execution or OS qualification. */
import {randomUUID} from 'node:crypto';
import type {SubagentResult} from '../../src/operations/config/schema.js';
import type {SupervisorTask, TaskCompletion, TaskWorkerHandle, TaskWorkerSupervisor} from '../../src/agents/worker-task-supervisor.js';
import type {SupervisedWorkerEvidence, SupervisedWorkerRequest} from '../../src/agents/worker-supervisor.js';
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
export function taskResult(task: SupervisorTask, overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {id: task.identity.workerId, role: task.role, status: 'success',
    findings: [{type: 'summary', content: 'done', confidence: 'high'}], events: [], ...overrides};
}
export function fixtureSupervisor(options: {
  prepare?: (task: SupervisorTask) => Promise<void>;
  launch?: (task: SupervisorTask) => Promise<void>;
  result?: (task: SupervisorTask) => Promise<SubagentResult> | SubagentResult;
  wait?: (task: SupervisorTask) => Promise<{exitCode: number | null; signal: string | null}>;
  cancel?: () => Promise<void>;
  revoke?: () => Promise<void>;
  reconcile?: () => Promise<void>;
  evidence?: (value: SupervisedWorkerEvidence) => SupervisedWorkerEvidence;
} = {}) {
  const tasks: SupervisorTask[] = [];
  const launches: SupervisedWorkerRequest[] = [];
  const handles: TaskWorkerHandle[] = [];
  const cancellations: string[] = [];
  const specs = new Map<string, SupervisorTask>();
  let revocations = 0;
  const stops = new Map<string, ReturnType<typeof deferred<void>>>();
  const revoked = new Set<string>();
  const key = (identity: SupervisedWorkerRequest['identity']) => JSON.stringify([identity.coordinationRunId, identity.workerId, identity.attempt]);
  const supervisor: TaskWorkerSupervisor = {
    async prepareTask(task) {
      tasks.push(task);
      await options.prepare?.(task);
      const configurationId = randomUUID();
      specs.set(configurationId, task);
      return {identity: task.identity, configurationId, workspaceRoot: task.workspaceRoot};
    },
    async launch(request) {
      launches.push(request);
      const task = specs.get(request.configurationId);
      if (!task) throw new Error('Unknown fixture specification');
      specs.delete(request.configurationId);
      await options.launch?.(task);
      const stopped = deferred<void>();
      stops.set(key(request.identity), stopped);
      if (revoked.has(key(request.identity))) stopped.resolve();
      const evidence = options.evidence?.({identity: request.identity, pid: 10000 + launches.length,
        uid: (process.getuid?.() ?? 1000) + 1, startTimeTicks: String(100 + launches.length), registrationId: randomUUID()}) ??
        {identity: request.identity, pid: 10000 + launches.length, uid: (process.getuid?.() ?? 1000) + 1,
          startTimeTicks: String(100 + launches.length), registrationId: randomUUID()};
      const completion = Promise.race([
        Promise.resolve().then(() => options.result?.(task) ?? taskResult(task)).then(result => ({protocolVersion: 1 as const, evidence, result})),
        stopped.promise.then((): never => {throw new Error('Fixture task cancelled');}),
      ]);
      void completion.catch(() => {});
      const waiting = Promise.race([
        options.wait ? options.wait(task) : completion.then(() => ({exitCode: 0, signal: null})),
        stopped.promise.then(() => ({exitCode: null, signal: 'SIGKILL'})),
      ]);
      void waiting.catch(() => {});
      const handle: TaskWorkerHandle = {evidence,
        async cancel(reason) {cancellations.push(reason); await options.cancel?.(); stopped.resolve();},
        completion: () => completion as Promise<TaskCompletion>, wait: () => waiting};
      handles.push(handle);
      return handle;
    },
    async revoke(identity) {revocations++; await options.revoke?.(); revoked.add(key(identity)); stops.get(key(identity))?.resolve();},
    async reconcile() {await options.reconcile?.();},
  };
  return {supervisor, tasks, launches, handles, cancellations, get revocations() {return revocations;}};
}
