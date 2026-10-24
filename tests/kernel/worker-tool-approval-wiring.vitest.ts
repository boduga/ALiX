import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { DefaultWorkerExecutor } from '../../src/coordination/kernel/worker-executor.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const mocks = vi.hoisted(() => ({ complete: vi.fn(), runTask: vi.fn() }));
vi.mock('../../src/models/providers/registry.js', () => ({ createProvider: async () => ({ complete: mocks.complete }) }));
vi.mock('../../src/governance/security/credentials/api-keys.js', () => ({ getApiKey: async () => undefined }));
vi.mock('../../src/run.js', () => ({ runTask: mocks.runTask }));

afterEach(() => vi.clearAllMocks());

/**
 * F8 — durable TOOL-level approval inside a coordination worker.
 *
 * Two authorization boundaries must both hold and neither may bypass the other:
 * the scheduler authorizes worker DISPATCH (and its declared capabilities),
 * while the worker's own ToolExecutor re-evaluates each concrete tool call. A
 * dispatch approval for `filesystem.write` is NOT permission to write any path
 * with any content.
 *
 * Before this integration `DefaultWorkerExecutor` called `runTask` with no
 * `approvalStore`, so every gated worker tool call failed closed with
 * "Approval required but no approval store configured" and could never pause for
 * an operator decision.
 */
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), '.alix-f8-'));
  const log = new EventLog(join(cwd, '.alix', 'sessions', 'session'));
  await log.init();
  const run = createCoordinationRun({ sessionId: 'session', rootGoal: 'write a file', coordinatorAgentId: 'parent' });
  const worker = createWorkerAssignment({
    coordinationRunId: run.id, agentId: 'writer', taskLabel: 'Write',
    goalPrompt: 'Write reports/a.md', requiredCapabilities: ['filesystem.write'],
    ownershipScopes: ['reports/a.md'], ownershipClaims: [{ path: 'reports/a.md', recursive: false }],
  });
  run.workers = [worker];
  const config = {
    ...DEFAULT_CONFIG,
    models: { default: { provider: 'mock', name: 'mock' } },
    permissions: { ...DEFAULT_CONFIG.permissions, sessionMode: 'ask' as const },
  };
  return { cwd, log, worker, context: { cwd, run, sessionId: run.sessionId, config } };
}

function fakeStore() {
  return { get: vi.fn(), loadFresh: vi.fn(), load: vi.fn() };
}

describe('worker tool-level approval store wiring (F8)', () => {
  it('passes the authoritative approvalStore into runTask', async () => {
    const { cwd, worker, context } = await fixture();
    const store = fakeStore();
    try {
      mocks.runTask.mockResolvedValue({ sessionId: 'session', summary: 'done', reason: 'completed' });
      mocks.complete.mockResolvedValue({ text: JSON.stringify({ satisfied: true, summary: 'done', gaps: [] }), toolCalls: [] });

      await new DefaultWorkerExecutor(store as never).execute(worker, context, new AbortController().signal);

      expect(mocks.runTask).toHaveBeenCalledTimes(1);
      const opts = mocks.runTask.mock.calls[0]![2];
      expect(opts.approvalStore).toBe(store);
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('omits approvalStore when the host has none, preserving fail-closed behaviour', async () => {
    const { cwd, worker, context } = await fixture();
    try {
      mocks.runTask.mockResolvedValue({ sessionId: 'session', summary: 'done', reason: 'completed' });
      mocks.complete.mockResolvedValue({ text: JSON.stringify({ satisfied: true, summary: 'done', gaps: [] }), toolCalls: [] });

      await new DefaultWorkerExecutor().execute(worker, context, new AbortController().signal);

      const opts = mocks.runTask.mock.calls[0]![2];
      expect('approvalStore' in opts ? opts.approvalStore : undefined).toBeUndefined();
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('uses the SAME store instance for every worker in the run (one approval authority)', async () => {
    const { cwd, context } = await fixture();
    const store = fakeStore();
    try {
      const second = createWorkerAssignment({
        coordinationRunId: context.run.id, agentId: 'writer2', taskLabel: 'Write2',
        goalPrompt: 'Write reports/b.md', requiredCapabilities: ['filesystem.write'],
        ownershipScopes: ['reports/b.md'], ownershipClaims: [{ path: 'reports/b.md', recursive: false }],
      });
      mocks.runTask.mockResolvedValue({ sessionId: 'session', summary: 'done', reason: 'completed' });
      mocks.complete.mockResolvedValue({ text: JSON.stringify({ satisfied: true, summary: 'done', gaps: [] }), toolCalls: [] });

      const executor = new DefaultWorkerExecutor(store as never);
      await executor.execute(context.run.workers[0]!, context, new AbortController().signal);
      await executor.execute(second, context, new AbortController().signal);

      const stores = mocks.runTask.mock.calls.map(c => c[2].approvalStore);
      expect(stores).toHaveLength(2);
      expect(stores[0]).toBe(store);
      expect(stores[1]).toBe(store);
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });
});

describe('authoritative approval wait (F8)', () => {
  it('loadApprovalForWait reads through the store instead of the in-memory map', async () => {
    const { ToolExecutor } = await import('../../src/capabilities/tools/executor.js');
    const store = {
      get: vi.fn(() => ({ status: 'pending' })),
      loadFresh: vi.fn(async () => ({ status: 'approved' })),
    };
    const { cwd, log } = await fixture();
    try {
      const executor = new ToolExecutor(
        { permissions: { sessionMode: 'ask', tools: {} } } as never,
        log,
        cwd,
        undefined,
        undefined,
        undefined,
        undefined,
        store as never,
      );

      // The wait must observe the durable decision, not the stale memory view.
      const record = await executor.loadApprovalForWait('approval_x');
      expect(store.loadFresh).toHaveBeenCalledWith('approval_x');
      expect(record).toEqual({ status: 'approved' });
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('returns null (keep waiting) when the durable read fails, never undefined (denied)', async () => {
    const { ToolExecutor } = await import('../../src/capabilities/tools/executor.js');
    const store = {
      get: vi.fn(() => ({ status: 'pending' })),
      loadFresh: vi.fn(async () => { throw new Error('ledger lock contention'); }),
    };
    const { cwd, log } = await fixture();
    try {
      const executor = new ToolExecutor(
        { permissions: { sessionMode: 'ask', tools: {} } } as never,
        log,
        cwd,
        undefined,
        undefined,
        undefined,
        undefined,
        store as never,
      );

      const record = await executor.loadApprovalForWait('approval_y');
      // `null` = transient failure, keep waiting. `undefined` would be read as
      // "record gone" and deny a legitimately pending approval.
      expect(record).toBeNull();
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('falls back to the in-memory read when the store cannot load fresh', async () => {
    const { ToolExecutor } = await import('../../src/capabilities/tools/executor.js');
    const store = { get: vi.fn(() => ({ status: 'approved' })) };
    const { cwd, log } = await fixture();
    try {
      const executor = new ToolExecutor(
        { permissions: { sessionMode: 'ask', tools: {} } } as never,
        log,
        cwd,
        undefined,
        undefined,
        undefined,
        undefined,
        store as never,
      );
      expect(await executor.loadApprovalForWait('approval_z')).toEqual({ status: 'approved' });
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('with no store at all, the wait sees nothing and cannot authorize', async () => {
    const { ToolExecutor } = await import('../../src/capabilities/tools/executor.js');
    const { cwd, log } = await fixture();
    try {
      // No approval store wired (the pre-fix worker shape): the wait has no
      // authority to consult, so the operation cannot be authorized.
      const executor = new ToolExecutor(
        { permissions: { sessionMode: 'ask', tools: {} } } as never,
        log,
        cwd,
      );
      expect(await executor.loadApprovalForWait('approval_none')).toBeUndefined();
      expect(executor.getApproval('approval_none')).toBeUndefined();
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });
});
