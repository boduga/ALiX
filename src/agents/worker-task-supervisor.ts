/** Canonical task handoff for GE-04. No production implementation is enabled.
 * Internal injection is a trusted composition seam, never a runtime config flag.
 * Interface conformance and the validators below do not qualify OS containment.
 */
import type {SessionMode, SubagentTask, SubagentRole, SubagentResult} from '../operations/config/schema.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';
import {WorkerSupervisorUnavailableError} from './worker-supervisor.js';
import type {WorkerSupervisor, SupervisedWorkerRequest, SupervisedWorkerEvidence, SupervisedWorkerHandle} from './worker-supervisor.js';

export type SupervisorTask = Readonly<{
  identity: WorkerGrantIdentity;
  workspaceRoot: string;
  role: SubagentRole;
  mode: 'read_only' | 'write';
  prompt: string;
  model: Readonly<{provider: string; name: string}>;
  sessionMode: SessionMode;
  ownedPaths?: readonly string[];
  inputPaths?: readonly string[];
  expectedOutput?: string;
  contextBundle?: string;
  assignedObjective?: string;
  coordinationOwnershipClaims?: readonly Readonly<{path: string; recursive: boolean; sourcePattern?: string}>[];
}>;
export type TaskCompletion = Readonly<{protocolVersion: 1; evidence: SupervisedWorkerEvidence; result: SubagentResult}>;
export interface TaskWorkerHandle extends SupervisedWorkerHandle {
  /** Settles only after the bounded terminal channel is sealed. Not native exit. */
  completion(): Promise<TaskCompletion>;
}
export interface TaskWorkerSupervisor extends WorkerSupervisor {
  /** Owns immutable specification custody; no worker-supplied configuration IDs. */
  prepareTask(task: SupervisorTask): Promise<SupervisedWorkerRequest>;
  launch(request: SupervisedWorkerRequest): Promise<TaskWorkerHandle>;
}
export const WORKER_TASK_LIMITS = Object.freeze({taskBytes: 1024 * 1024, resultBytes: 256 * 1024,
  findings: 128, events: 200, eventBytes: 64 * 1024, refs: 16, textBytes: 64 * 1024,
  identifierBytes: 512, pathBytes: 4096, errorBytes: 16 * 1024});

function fail(): never { throw new Error('Invalid or oversized supervised worker payload'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) fail();
  return result;
}
function string(value: unknown, max: number, nonempty = true): string {
  if (typeof value !== 'string' || (nonempty && !value.trim()) || Buffer.byteLength(value, 'utf8') > max) fail();
  return value;
}
function strings(value: unknown, maxCount: number, maxBytes: number): string[] {
  if (!Array.isArray(value) || value.length > maxCount) fail();
  return value.map(item => string(item, maxBytes, false));
}
function bounded(value: unknown, max: number): void {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { fail(); }
  if (!json || Buffer.byteLength(json, 'utf8') > max) fail();
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
export function snapshotWorkerIdentity(value: unknown): WorkerGrantIdentity {
  const v = record(value, ['coordinationRunId', 'workerId', 'attempt']);
  if (!Number.isSafeInteger(v.attempt) || (v.attempt as number) < 1) fail();
  return Object.freeze({coordinationRunId: string(v.coordinationRunId, 512), workerId: string(v.workerId, 512), attempt: v.attempt as number});
}
export function sameWorkerIdentity(a: WorkerGrantIdentity, b: WorkerGrantIdentity): boolean {
  return a.coordinationRunId === b.coordinationRunId && a.workerId === b.workerId && a.attempt === b.attempt;
}
export function snapshotWorkerEvidence(value: unknown, identity: WorkerGrantIdentity): SupervisedWorkerEvidence {
  const v = record(value, ['identity', 'pid', 'uid', 'startTimeTicks', 'registrationId']);
  const id = snapshotWorkerIdentity(v.identity);
  if (!sameWorkerIdentity(id, identity) || !Number.isSafeInteger(v.pid) || (v.pid as number) < 1 ||
      !Number.isSafeInteger(v.uid) || (v.uid as number) < 0 || v.uid === process.getuid?.()) fail();
  const startTimeTicks = string(v.startTimeTicks, 512);
  if (!/^[1-9][0-9]*$/.test(startTimeTicks)) fail();
  return Object.freeze({identity: id, pid: v.pid as number, uid: v.uid as number, startTimeTicks,
    registrationId: string(v.registrationId, 512)});
}
export function sameWorkerEvidence(a: SupervisedWorkerEvidence, b: SupervisedWorkerEvidence): boolean {
  return sameWorkerIdentity(a.identity, b.identity) && a.pid === b.pid && a.uid === b.uid &&
    a.startTimeTicks === b.startTimeTicks && a.registrationId === b.registrationId;
}
export function requireTaskWorkerSupervisor(value: TaskWorkerSupervisor | undefined): TaskWorkerSupervisor {
  if (!value || typeof value.prepareTask !== 'function' || typeof value.launch !== 'function' ||
      typeof value.revoke !== 'function' || typeof value.reconcile !== 'function') throw new WorkerSupervisorUnavailableError();
  return value;
}
export function snapshotPreparedRequest(value: unknown, task: SupervisorTask): SupervisedWorkerRequest {
  const v = record(value, ['identity', 'configurationId', 'workspaceRoot']);
  const identity = snapshotWorkerIdentity(v.identity);
  if (!sameWorkerIdentity(identity, task.identity) || v.workspaceRoot !== task.workspaceRoot) fail();
  return Object.freeze({identity, configurationId: string(v.configurationId, 512), workspaceRoot: task.workspaceRoot});
}
const roles: readonly string[] = ['auto', 'explorer', 'reviewer', 'test_investigator', 'docs_researcher', 'worker', 'researcher'];
export function projectSupervisorTask(task: SubagentTask, identity: WorkerGrantIdentity,
  workspaceRoot: string, model: Readonly<{provider: string; name: string}>, sessionMode: SessionMode): SupervisorTask {
  if (!roles.includes(task.role) || !['read_only', 'write'].includes(task.mode) ||
      !['auto', 'ask', 'bypass'].includes(sessionMode) || task.scriptedScenarioJson !== undefined) fail();
  const claims = task.coordinationOwnershipClaims?.map(item => {
    const v = record(item, ['path', 'recursive', 'sourcePattern']);
    if (typeof v.recursive !== 'boolean') fail();
    return {path: string(v.path, 4096), recursive: v.recursive,
      ...(v.sourcePattern === undefined ? {} : {sourcePattern: string(v.sourcePattern, 4096)})};
  });
  if (claims && claims.length > 1024) fail();
  const result: SupervisorTask = {
    identity: snapshotWorkerIdentity(identity), workspaceRoot: string(workspaceRoot, 4096),
    role: task.role, mode: task.mode, prompt: string(task.prompt, 768 * 1024, false),
    model: {provider: string(model.provider, 4096), name: string(model.name, 4096)}, sessionMode,
    ...(task.ownedPaths === undefined ? {} : {ownedPaths: strings(task.ownedPaths, 1024, 4096)}),
    ...(task.inputPaths === undefined ? {} : {inputPaths: strings(task.inputPaths, 1024, 4096)}),
    ...(task.contextBundle === undefined ? {} : {contextBundle: string(task.contextBundle, 512 * 1024, false)}),
    ...(task.expectedOutput === undefined ? {} : {expectedOutput: string(task.expectedOutput, 512 * 1024, false)}),
    ...(task.assignedObjective === undefined ? {} : {assignedObjective: string(task.assignedObjective, 768 * 1024, false)}),
    ...(claims === undefined ? {} : {coordinationOwnershipClaims: claims}),
  };
  bounded(result, WORKER_TASK_LIMITS.taskBytes);
  return freeze(result);
}
/** Validate an already-bounded transport object and detach it from backend mutation.
 * The transport must enforce wire bounds before allocating/decoding this object.
 */
export function validateTaskCompletion(value: unknown, evidence: SupervisedWorkerEvidence, role: SubagentRole): SubagentResult {
  bounded(value, WORKER_TASK_LIMITS.resultBytes);
  const envelope = record(value, ['protocolVersion', 'evidence', 'result']);
  if (envelope.protocolVersion !== 1) fail();
  const observed = snapshotWorkerEvidence(envelope.evidence, evidence.identity);
  if (!sameWorkerEvidence(observed, evidence)) fail();
  const v = record(envelope.result, ['id', 'role', 'status', 'findings', 'events', 'error']);
  if (v.id !== evidence.identity.workerId || v.role !== role ||
      !['success', 'failed', 'partial', 'rejected'].includes(v.status as string) ||
      !Array.isArray(v.findings) || v.findings.length > WORKER_TASK_LIMITS.findings) fail();
  const findings = v.findings.map(item => {
    const f = record(item, ['type', 'content', 'confidence', 'refs']);
    if (!['file_ref', 'code_location', 'summary', 'risk_flag', 'web_source', 'synthesis'].includes(f.type as string) ||
        !['high', 'medium', 'low'].includes(f.confidence as string)) fail();
    return {type: f.type as SubagentResult['findings'][number]['type'], content: string(f.content, 64 * 1024, false),
      confidence: f.confidence as 'high' | 'medium' | 'low',
      ...(f.refs === undefined ? {} : {refs: strings(f.refs, 16, 4096)})};
  });
  const events = strings(v.events, 200, 64 * 1024);
  if (events.reduce((sum, event) => sum + Buffer.byteLength(event, 'utf8'), 0) > 64 * 1024) fail();
  return freeze({id: v.id as string, role, status: v.status as SubagentResult['status'], findings, events,
    ...(v.error === undefined ? {} : {error: string(v.error, 16 * 1024, false)})});
}
