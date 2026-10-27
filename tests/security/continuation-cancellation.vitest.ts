import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createToolExecutor } from '../../src/capabilities/tools/tool-executor-factory.js';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { isCancellationError } from '../../src/runtime-state/runtime/cancellation-token.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); closeAllSharedLedgers();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

for (const phase of ['already-aborted', 'tool.requested', 'after-claim', 'tool.started', 'active', 'no-signal'] as const) {
  it(`continuation cancellation at ${phase} preserves authority and prevents effects`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'alix-d9-cancel-')); dirs.push(root);
    const log = new EventLog(join(root, '.alix/sessions/cancel-test')); await log.init();
    const store = new ApprovalStore(root); await store.load();
    const config = structuredClone(DEFAULT_CONFIG);
    config.permissions.sessionMode = 'ask'; config.permissions.tools = { 'file.create': 'ask' };
    const executor = createToolExecutor({ config, root, log, approvalStore: store });
    const request = { toolCallId: 'cancel-call', name: 'file.create', args: { path: 'effect.txt', content: 'effect' }, agentId: 'original-agent' };
    expect((await executor.execute(request)).kind).toBe('denied');
    const approval = store.findByRequestId(request.toolCallId)!;
    await store.resolve(approval.id, 'approved');
    const identity = structuredClone(store.get(approval.id)!);
    const controller = new AbortController();
    const append = log.append.bind(log);
    vi.spyOn(log, 'append').mockImplementation(async event => {
      const result = await append(event);
      if (event.type === phase) controller.abort('worker context lost');
      return result;
    });
    const consume = store.consumeApproved.bind(store);
    const claim = vi.spyOn(store, 'consumeApproved').mockImplementation(async (...args) => {
      const result = await consume(...args);
      if (phase === 'after-claim') controller.abort('worker context lost');
      return result;
    });
    if (phase === 'already-aborted') controller.abort('worker context lost');
    const execution = executor.execute({ ...request, source: 'continuation-resume', approvalId: approval.id,
      ...(phase === 'no-signal' ? {} : { signal: controller.signal }) });
    if (phase === 'active' || phase === 'no-signal') {
      expect((await execution).kind).toBe('success');
      expect(await readFile(join(root, 'effect.txt'), 'utf8')).toBe('effect');
      expect(store.get(approval.id)).toMatchObject({ status: 'consumed', executionOutcome: 'succeeded' });
    } else {
      await expect(execution).rejects.toSatisfy(isCancellationError);
      await expect(access(join(root, 'effect.txt'))).rejects.toThrow();
      if (phase === 'already-aborted' || phase === 'tool.requested') {
        expect(claim).not.toHaveBeenCalled();
        expect(await store.loadFresh(approval.id)).toEqual(identity);
      } else {
        expect(claim).toHaveBeenCalledTimes(1);
        expect(await store.loadFresh(approval.id)).toMatchObject({ status: 'consumed', executionOutcome: 'cancelled',
          invocationFingerprint: identity.invocationFingerprint, agentId: identity.agentId });
        // Cancellation after claim never restores or reuses the authority.
        expect((await executor.execute({ ...request, source: 'continuation-resume', approvalId: approval.id })).kind).toBe('denied');
        await expect(access(join(root, 'effect.txt'))).rejects.toThrow();
      }
    }
    await log.close();
  });
}
