import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashArgs } from './hash-args.js';
import { isSafeShellCommand } from './safe-shell.js';
import { buildDefaultToolIndex } from './tool-registry.js';
import type { ToolCallRequest, ToolResult } from './types.js';
import { WorkspacePathResolver } from '../../runtime-state/runtime/workspace-path.js';
import { computeBindingKey } from '../../governance/approvals/approval-binding.js';
import type { ApprovalStore } from '../../governance/approvals/approval-store.js';
import { ApprovalStoreLock } from '../../governance/approvals/approval-store-lock.js';
import { ExecutionCancelledError, signalReason } from '../../runtime-state/runtime/cancellation-token.js';

export type EffectJournalState =
  | 'claimed'
  | 'started_unknown'
  | 'terminal_success'
  | 'terminal_failure'
  | 'reconciled_success'
  | 'reconciled_not_applied';

export type EffectJournalFaultPoint =
  | 'before_claim'
  | 'after_claim'
  | 'before_adapter'
  | 'after_adapter'
  | 'after_terminal';

export type EffectJournalHooks = {
  /** Test/qualification-only crash injection. Production executor supplies none. */
  onPoint?: (point: EffectJournalFaultPoint) => void;
};

export type EffectJournalRecord = {
  schemaVersion: 1;
  effectKey: string;
  generationId: string;
  toolName: string;
  canonicalArgsHash: string;
  workspaceHash: string;
  state: EffectJournalState;
  claimedAt: string;
  updatedAt: string;
};

export type EffectReconciliationOutcome = 'applied' | 'not_applied';

export type EffectReconciliationInput = {
  approvalId: string;
  actorId: string;
  policyRevision: string;
  outcome: EffectReconciliationOutcome;
  evidenceHash: string;
  evidenceRef: string;
};

export type EffectReconciliationAuthority = {
  capability: 'effect.reconcile';
  effectKey: string;
  generationId: string;
  requestFingerprint: string;
  bindingKey: string;
};

export type EffectReconciliationEvent = {
  schemaVersion: 1;
  eventId: string;
  effectKey: string;
  generationId: string;
  toolName: string;
  canonicalArgsHash: string;
  workspaceHash: string;
  previousState: EffectJournalState;
  outcome: EffectReconciliationOutcome;
  targetState: 'reconciled_success' | 'reconciled_not_applied';
  actorId: string;
  approvalId: string;
  policyRevision: string;
  evidenceHash: string;
  evidenceRef: string;
  recordedAt: string;
};

export type EffectReconciliationFaultPoint =
  | 'after_authority'
  | 'after_history'
  | 'after_reconciled_state'
  | 'after_archive';

export type EffectReconciliationHooks = {
  /** Test/qualification-only crash injection. Production callers supply none. */
  onPoint?: (point: EffectReconciliationFaultPoint) => void;
  /** Test-only bounded contention probe; production uses the lock default. */
  lockTimeoutMs?: number;
};

type EffectIdentity = {
  workspace: string;
  directory: string;
  path: string;
  effectKey: string;
  canonicalArgsHash: string;
  workspaceHash: string;
};

const registry = buildDefaultToolIndex().registry;

function validateJournalNamespace(identity: EffectIdentity, create: boolean): boolean {
  const chain = [
    join(identity.workspace, '.alix'),
    join(identity.workspace, '.alix', 'effect-journal'),
    identity.directory,
  ];
  const resolver = new WorkspacePathResolver(identity.workspace);
  for (const dir of chain) {
    if (create) {
      try { mkdirSync(dir, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } else if (!existsSync(dir)) {
      return false;
    }
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`effect journal namespace is not a real directory: ${dir}`);
    }
    const canonical = realpathSync.native(dir);
    if (!resolver.isCanonicalInWorkspace(canonical)) {
      throw new Error(`effect journal namespace escapes workspace: ${dir}`);
    }
  }
  return true;
}

function syncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function canonicalShellCwd(root: string, request: ToolCallRequest): string {
  const resolver = new WorkspacePathResolver(root);
  const raw = typeof request.args.cwd === 'string' && request.args.cwd.length > 0 ? request.args.cwd : '.';
  const checked = resolver.check(raw);
  if (!checked.insideWorkspace || !resolver.isCanonicalInWorkspace(checked.absolute)) {
    throw new Error(`effect journal shell cwd is outside workspace: ${checked.absolute}`);
  }
  return realpathSync.native(checked.absolute);
}

function snapshotExecutionRequest(request: ToolCallRequest): ToolCallRequest {
  // Model/tool arguments are structured data. Snapshot them before the first
  // await so caller mutation of nested objects cannot make the adapter execute
  // a different effect than the identity durably claimed by the journal. The
  // AbortSignal intentionally remains live so later cancellation is observed.
  return { ...request, args: structuredClone(request.args) };
}

function bindExecutionRequest(root: string, request: ToolCallRequest): ToolCallRequest {
  if (request.name !== 'shell.run') return request;
  const command = typeof request.args.command === 'string' ? request.args.command : '';
  if (isSafeShellCommand(command)) return request;
  const cwd = canonicalShellCwd(root, request);
  return { ...request, args: { ...request.args, cwd } };
}

function canonicalArgs(root: string, request: ToolCallRequest): Record<string, unknown> {
  if (request.name !== 'shell.run') return request.args;
  const command = typeof request.args.command === 'string' ? request.args.command : '';
  const cwd = isSafeShellCommand(command) ? realpathSync.native(root) : canonicalShellCwd(root, request);
  // Timeout/persistent transport controls do not change the external effect identity.
  return { command, cwd };
}

export function effectIdentity(root: string, request: ToolCallRequest): EffectIdentity {
  const workspace = realpathSync.native(root);
  const args = canonicalArgs(workspace, request);
  const canonicalArgsHash = hashArgs(args);
  const workspaceHash = hashArgs({ workspace });
  const effectKey = hashArgs({ schemaVersion: 1, workspace, toolName: request.name, canonicalArgsHash });
  const directory = join(workspace, '.alix', 'effect-journal', 'v1');
  return { workspace, directory, path: join(directory, `${effectKey}.json`), effectKey, canonicalArgsHash, workspaceHash };
}

function validateEvidenceRef(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1024 || /[\r\n\0]/.test(trimmed)) {
    throw new Error(`invalid ${field}`);
  }
  return trimmed;
}

function validateEvidenceHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('invalid evidenceHash; expected SHA-256 hex');
  return normalized;
}

function reconciliationAuthorityForIdentity(
  identity: EffectIdentity,
  generationId: string,
  input: Omit<EffectReconciliationInput, 'approvalId'>,
): EffectReconciliationAuthority {
  if (input.outcome !== 'applied' && input.outcome !== 'not_applied') throw new Error('invalid reconciliation outcome');
  const actorId = validateEvidenceRef(input.actorId, 'actorId');
  const policyRevision = validateEvidenceRef(input.policyRevision, 'policyRevision');
  const evidenceHash = validateEvidenceHash(input.evidenceHash);
  const evidenceRef = validateEvidenceRef(input.evidenceRef, 'evidenceRef');
  const requestFingerprint = hashArgs({
    schemaVersion: 1, capability: 'effect.reconcile', effectKey: identity.effectKey, generationId,
    outcome: input.outcome, evidenceHash, evidenceRef, actorId,
  });
  const bindingKey = computeBindingKey({ capabilities: ['effect.reconcile'], requestFingerprint, policyRevision });
  return { capability: 'effect.reconcile', effectKey: identity.effectKey, generationId, requestFingerprint, bindingKey };
}

export function effectReconciliationAuthority(
  root: string,
  request: ToolCallRequest,
  input: Omit<EffectReconciliationInput, 'approvalId'>,
): EffectReconciliationAuthority {
  const identity = effectIdentity(root, request);
  const record = readEffectRecordIdentity(identity);
  if (!record) throw new Error('effect journal record not found');
  return reconciliationAuthorityForIdentity(identity, record.generationId, input);
}

function historyPath(identity: EffectIdentity): string {
  return join(identity.directory, `${identity.effectKey}.reconciliation.jsonl`);
}

function archiveDirectory(identity: EffectIdentity): string {
  return join(identity.directory, 'archive');
}

function effectLockPath(identity: EffectIdentity): string {
  return join(identity.directory, `.${identity.effectKey}.lock`);
}

async function acquireEffectLock(identity: EffectIdentity, timeoutMs?: number): Promise<ApprovalStoreLock> {
  validateJournalNamespace(identity, true);
  const path = effectLockPath(identity);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new Error('effect journal lock path is not a regular lock target');
    }
  }
  const lock = new ApprovalStoreLock(identity.workspace, { lockPath: path });
  if (!await lock.acquire(timeoutMs)) throw new Error(`effect journal lock unavailable: ${identity.effectKey}`);
  return lock;
}

function appendReconciliationHistory(identity: EffectIdentity, event: EffectReconciliationEvent): void {
  validateJournalNamespace(identity, true);
  const path = historyPath(identity);
  let fd: number;
  try {
    fd = openSync(path, 'ax', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('effect reconciliation history is not a regular file');
    fd = openSync(path, 'a');
  }
  try {
    writeFileSync(fd, `${JSON.stringify(event)}\n`, 'utf8');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  syncDirectory(identity.directory);
}

export function readEffectReconciliationHistory(root: string, request: ToolCallRequest): EffectReconciliationEvent[] {
  const identity = effectIdentity(root, request);
  if (!validateJournalNamespace(identity, false)) return [];
  const path = historyPath(identity);
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('effect reconciliation history is not a regular file');
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const event = JSON.parse(line) as EffectReconciliationEvent;
    if (event.schemaVersion !== 1 || event.effectKey !== identity.effectKey || !event.generationId || event.canonicalArgsHash !== identity.canonicalArgsHash) {
      throw new Error('effect reconciliation history identity mismatch');
    }
    return event;
  });
}

function archiveReconciledNotApplied(identity: EffectIdentity, record: EffectJournalRecord): void {
  if (record.state !== 'reconciled_not_applied') throw new Error('only reconciled_not_applied may release quarantine');
  const dir = archiveDirectory(identity);
  try { mkdirSync(dir, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('effect journal archive namespace is not a real directory');
  const archiveKey = record.generationId;
  const destination = join(dir, `${record.effectKey}.${archiveKey}.json`);
  if (existsSync(destination)) {
    const existing = JSON.parse(readFileSync(destination, 'utf8')) as EffectJournalRecord;
    if (existing.effectKey !== record.effectKey || existing.state !== 'reconciled_not_applied') {
      throw new Error('effect journal archive identity mismatch');
    }
    if (existsSync(identity.path)) throw new Error('effect journal live record still exists beside prior archive');
    return;
  }
  renameSync(identity.path, destination);
  syncDirectory(dir);
  syncDirectory(identity.directory);
}

function persistInitial(identity: EffectIdentity, toolName: string): EffectJournalRecord {
  validateJournalNamespace(identity, true);
  const now = new Date().toISOString();
  const record: EffectJournalRecord = {
    schemaVersion: 1,
    effectKey: identity.effectKey,
    generationId: randomUUID(),
    toolName,
    canonicalArgsHash: identity.canonicalArgsHash,
    workspaceHash: identity.workspaceHash,
    state: 'claimed',
    claimedAt: now,
    updatedAt: now,
  };
  const fd = openSync(identity.path, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  // Persist the full newly-created directory chain, not only the leaf.
  // A leaf fsync does not by itself guarantee that its parent directory entry
  // survives a process/host crash. Linux x86-64/ARM64 are the required Q10
  // qualification targets for this phase.
  syncDirectory(identity.directory);
  syncDirectory(join(identity.workspace, '.alix', 'effect-journal'));
  syncDirectory(join(identity.workspace, '.alix'));
  syncDirectory(identity.workspace);
  return record;
}

function persistTransition(identity: EffectIdentity, record: EffectJournalRecord, state: EffectJournalState): EffectJournalRecord {
  const next: EffectJournalRecord = { ...record, state, updatedAt: new Date().toISOString() };
  const temp = join(identity.directory, `.${identity.effectKey}.${process.pid}.${randomUUID()}.tmp`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(next)}\n`, 'utf8');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  renameSync(temp, identity.path);
  syncDirectory(identity.directory);
  return next;
}

function readEffectRecordIdentity(identity: EffectIdentity): EffectJournalRecord | undefined {
  if (!validateJournalNamespace(identity, false)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(identity.path, 'utf8')) as EffectJournalRecord;
    if (parsed.schemaVersion !== 1 || parsed.effectKey !== identity.effectKey || !parsed.generationId ||
        parsed.canonicalArgsHash !== identity.canonicalArgsHash || parsed.workspaceHash !== identity.workspaceHash) {
      throw new Error('effect journal identity mismatch');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function readEffectRecord(root: string, request: ToolCallRequest): EffectJournalRecord | undefined {
  return readEffectRecordIdentity(effectIdentity(root, request));
}

export async function reconcileEffectRecord(
  root: string,
  request: ToolCallRequest,
  input: EffectReconciliationInput,
  approvalStore: ApprovalStore,
  hooks: EffectReconciliationHooks = {},
): Promise<EffectJournalRecord> {
  if (process.platform !== 'linux') throw new Error('Effect journal reconciliation requires qualified durable execution on Linux');
  // Snapshot and validate caller-controlled reconciliation facts BEFORE the
  // first await so a mutable object cannot change after authority binding.
  const snapshot = Object.freeze({
    approvalId: validateEvidenceRef(input.approvalId, 'approvalId'),
    actorId: validateEvidenceRef(input.actorId, 'actorId'),
    policyRevision: validateEvidenceRef(input.policyRevision, 'policyRevision'),
    outcome: input.outcome,
    evidenceHash: validateEvidenceHash(input.evidenceHash),
    evidenceRef: validateEvidenceRef(input.evidenceRef, 'evidenceRef'),
  });
  if (snapshot.outcome !== 'applied' && snapshot.outcome !== 'not_applied') throw new Error('invalid reconciliation outcome');

  const identity = effectIdentity(root, request);
  const lock = await acquireEffectLock(identity, hooks.lockTimeoutMs);
  try {
    // The execution path holds this same OS-managed lock across adapter entry.
    // Acquiring it proves no live ALiX holder for this exact effect remains.
    const current = readEffectRecordIdentity(identity);
    if (!current) throw new Error('effect journal record not found');
    if (current.state !== 'claimed' && current.state !== 'started_unknown' && current.state !== 'terminal_failure') {
      throw new Error(`effect journal state ${current.state} is not reconcilable`);
    }

    const authority = reconciliationAuthorityForIdentity(identity, current.generationId, {
      actorId: snapshot.actorId, policyRevision: snapshot.policyRevision, outcome: snapshot.outcome,
      evidenceHash: snapshot.evidenceHash, evidenceRef: snapshot.evidenceRef,
    });

    const approved = await approvalStore.loadFresh(snapshot.approvalId);
    if (!approved || approved.status !== 'approved') throw new Error('effect reconciliation authority is not approved');
    if (approved.agentId !== snapshot.actorId) throw new Error('effect reconciliation actor does not match approved authority');
    if (approved.policyRevision !== snapshot.policyRevision || approved.requestFingerprint !== authority.requestFingerprint ||
        approved.bindingKey !== authority.bindingKey || approved.capabilities.length !== 1 || approved.capabilities[0] !== authority.capability) {
      throw new Error('effect reconciliation authority binding mismatch');
    }

    const consumed = await approvalStore.consumeApproved(snapshot.approvalId, authority.bindingKey, {});
    if (!consumed.consumed) throw new Error(`effect reconciliation authority unavailable: ${consumed.reason}`);
    hooks.onPoint?.('after_authority');

    // Re-read under the effect lock after the approval-store await. This guards
    // against any future path that could mutate journal state outside this lock.
    const fresh = readEffectRecordIdentity(identity);
    if (!fresh || fresh.generationId !== current.generationId || fresh.state !== current.state || fresh.updatedAt !== current.updatedAt) {
      throw new Error('effect journal changed during reconciliation authority validation');
    }

    const targetState = snapshot.outcome === 'applied' ? 'reconciled_success' : 'reconciled_not_applied';
    const event: EffectReconciliationEvent = {
      schemaVersion: 1, eventId: randomUUID(), effectKey: identity.effectKey, generationId: current.generationId, toolName: current.toolName,
      canonicalArgsHash: identity.canonicalArgsHash, workspaceHash: identity.workspaceHash,
      previousState: current.state, outcome: snapshot.outcome, targetState,
      actorId: snapshot.actorId, approvalId: snapshot.approvalId, policyRevision: snapshot.policyRevision,
      evidenceHash: snapshot.evidenceHash, evidenceRef: snapshot.evidenceRef, recordedAt: new Date().toISOString(),
    };
    appendReconciliationHistory(identity, event);
    hooks.onPoint?.('after_history');

    const reconciled = persistTransition(identity, current, targetState);
    hooks.onPoint?.('after_reconciled_state');
    if (targetState === 'reconciled_not_applied') {
      archiveReconciledNotApplied(identity, reconciled);
      hooks.onPoint?.('after_archive');
    }

    await approvalStore.recordExecutionOutcome(snapshot.approvalId, 'succeeded').catch(() => false);
    return reconciled;
  } finally {
    lock.release();
  }
}

function requiresEffectJournal(request: ToolCallRequest): boolean {
  const metadata = registry.lookup(request.name.startsWith('mcp.') ? 'mcp.*' : request.name);
  if (!metadata?.mutates || (metadata.risk !== 'high' && metadata.risk !== 'critical')) return false;
  if (request.name === 'shell.run' && typeof request.args.command === 'string' && isSafeShellCommand(request.args.command)) return false;
  return true;
}

function blocked(record: EffectJournalRecord): ToolResult {
  const unknown = record.state === 'started_unknown';
  return {
    kind: 'error',
    retryable: false,
    ...(unknown ? { outcomeUnknown: true as const } : {}),
    message: `Effect journal blocked replay: ${record.effectKey} is ${record.state}. Reconciliation is required before this exact effect may run again.`,
  };
}

export async function executeWithEffectJournal(
  root: string,
  request: ToolCallRequest,
  execute: (boundRequest: ToolCallRequest) => Promise<ToolResult>,
  hooks: EffectJournalHooks = {},
): Promise<ToolResult> {
  if (!requiresEffectJournal(request)) return execute(request);
  // Directory fsync durability has only been qualified on Linux. On other
  // platforms reject high-risk effects before adapter entry or journal mutation.
  if (process.platform !== 'linux') {
    return { kind: 'error', retryable: false, message: 'Effect journal durable execution is unsupported on this platform' };
  }
  if (request.signal?.aborted) throw new ExecutionCancelledError(signalReason(request.signal) ?? 'tool cancelled');

  let snapshot: ToolCallRequest;
  try { snapshot = snapshotExecutionRequest(request); }
  catch (error) {
    return { kind: 'error', retryable: false, message: `Effect request snapshot failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  hooks.onPoint?.('before_claim');
  let identity: EffectIdentity;
  let boundRequest: ToolCallRequest;
  try {
    boundRequest = bindExecutionRequest(root, snapshot);
    identity = effectIdentity(root, boundRequest);
  } catch (error) {
    return { kind: 'error', retryable: false, message: `Effect journal unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }

  let lock: ApprovalStoreLock;
  try { lock = await acquireEffectLock(identity); }
  catch (error) {
    return { kind: 'error', retryable: false, message: `Effect journal unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    let record: EffectJournalRecord;
    try {
      let existing = readEffectRecordIdentity(identity);
      if (existing?.state === 'reconciled_not_applied') {
        archiveReconciledNotApplied(identity, existing);
        existing = undefined;
      }
      if (existing) return blocked(existing);
      record = persistInitial(identity, snapshot.name);
    } catch (error) {
      return { kind: 'error', retryable: false, message: `Effect journal unavailable or already claimed: ${error instanceof Error ? error.message : String(error)}` };
    }

    hooks.onPoint?.('after_claim');
    try { record = persistTransition(identity, record, 'started_unknown'); }
    catch (error) {
      return { kind: 'error', retryable: false, message: `Effect journal could not record adapter-entry uncertainty: ${error instanceof Error ? error.message : String(error)}` };
    }

    hooks.onPoint?.('before_adapter');
    if (snapshot.signal?.aborted) throw new ExecutionCancelledError(signalReason(snapshot.signal) ?? 'tool cancelled');

    const result: ToolResult = await execute(boundRequest);

    hooks.onPoint?.('after_adapter');
    if (snapshot.signal?.aborted) {
      throw new ExecutionCancelledError(signalReason(snapshot.signal) ?? 'tool cancelled after adapter execution');
    }
    if (result.kind === 'error' && result.outcomeUnknown === true) return { ...result, retryable: false };

    const terminalState: EffectJournalState = result.kind === 'success' ? 'terminal_success' : 'terminal_failure';
    try { record = persistTransition(identity, record, terminalState); }
    catch (error) {
      return { kind: 'error', retryable: false, outcomeUnknown: true, message: `Effect completed but terminal journal persistence failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    hooks.onPoint?.('after_terminal');
    return result.kind === 'error' ? { ...result, retryable: false } : result;
  } finally {
    lock.release();
  }
}
