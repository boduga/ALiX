import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashArgs } from './hash-args.js';
import { isSafeShellCommand } from './safe-shell.js';
import { buildDefaultToolIndex } from './tool-registry.js';
import type { ToolCallRequest, ToolResult } from './types.js';
import { WorkspacePathResolver } from '../../runtime-state/runtime/workspace-path.js';
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
  toolName: string;
  canonicalArgsHash: string;
  workspaceHash: string;
  state: EffectJournalState;
  claimedAt: string;
  updatedAt: string;
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

function persistInitial(identity: EffectIdentity, toolName: string): EffectJournalRecord {
  validateJournalNamespace(identity, true);
  const now = new Date().toISOString();
  const record: EffectJournalRecord = {
    schemaVersion: 1,
    effectKey: identity.effectKey,
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

export function readEffectRecord(root: string, request: ToolCallRequest): EffectJournalRecord | undefined {
  const identity = effectIdentity(root, request);
  if (!validateJournalNamespace(identity, false)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(identity.path, 'utf8')) as EffectJournalRecord;
    if (parsed.schemaVersion !== 1 || parsed.effectKey !== identity.effectKey || parsed.canonicalArgsHash !== identity.canonicalArgsHash) {
      throw new Error('effect journal identity mismatch');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
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
  if (request.signal?.aborted) {
    throw new ExecutionCancelledError(signalReason(request.signal) ?? 'tool cancelled');
  }

  // Fault hooks deliberately sit OUTSIDE storage error handlers. A synthetic
  // qualification crash must behave like host death, not like a persistence
  // error returned to the caller.
  hooks.onPoint?.('before_claim');

  let identity: EffectIdentity;
  let record: EffectJournalRecord;
  let boundRequest: ToolCallRequest;
  try {
    boundRequest = bindExecutionRequest(root, request);
    identity = effectIdentity(root, boundRequest);
    const existing = readEffectRecord(root, boundRequest);
    if (existing) return blocked(existing);
    record = persistInitial(identity, request.name);
  } catch (error) {
    return {
      kind: 'error',
      retryable: false,
      message: `Effect journal unavailable or already claimed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  hooks.onPoint?.('after_claim');

  try {
    // This transition is durable before adapter entry. A crash after `claimed`
    // is distinguishable from a crash after the adapter may have started.
    record = persistTransition(identity, record, 'started_unknown');
  } catch (error) {
    return {
      kind: 'error',
      retryable: false,
      message: `Effect journal could not record adapter-entry uncertainty: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  hooks.onPoint?.('before_adapter');
  if (request.signal?.aborted) {
    throw new ExecutionCancelledError(signalReason(request.signal) ?? 'tool cancelled');
  }

  let result: ToolResult;
  try {
    result = await execute(boundRequest);
  } catch (error) {
    // `started_unknown` is intentionally retained. The caller may additionally
    // preserve approval uncertainty, but cannot make the effect retryable.
    throw error;
  }

  hooks.onPoint?.('after_adapter');

  // An abort observed after adapter return cannot become durable success: the
  // effect may already have happened, so retain started_unknown and fail closed.
  if (request.signal?.aborted) {
    throw new ExecutionCancelledError(signalReason(request.signal) ?? 'tool cancelled after adapter execution');
  }

  if (result.kind === 'error' && result.outcomeUnknown === true) {
    return { ...result, retryable: false };
  }

  const terminalState: EffectJournalState = result.kind === 'success' ? 'terminal_success' : 'terminal_failure';
  try {
    record = persistTransition(identity, record, terminalState);
  } catch (error) {
    return {
      kind: 'error',
      retryable: false,
      outcomeUnknown: true,
      message: `Effect completed but terminal journal persistence failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  hooks.onPoint?.('after_terminal');
  return result.kind === 'error' ? { ...result, retryable: false } : result;
}
