import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createToolExecutor } from '../../src/capabilities/tools/tool-executor-factory.js';
import { ShellToolRouter } from '../../src/capabilities/tools/tool-router.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';
import { readEffectRecord } from '../../src/capabilities/tools/effect-journal.js';
import type { ToolCallRequest } from '../../src/capabilities/tools/types.js';

const roots: string[] = [];
const logs: EventLog[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const log of logs.splice(0)) await log.close();
  closeAllSharedLedgers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(mode: 'ask' | 'auto' | 'bypass') {
  const root = await mkdtemp(join(tmpdir(), 'alix-effect-executor-'));
  roots.push(root);
  const store = new ApprovalStore(root);
  await store.load();
  async function executor(session: string) {
    const log = new EventLog(join(root, '.alix', 'sessions', session));
    await log.init();
    logs.push(log);
    const config = structuredClone(DEFAULT_CONFIG);
    config.permissions.sessionMode = mode;
    config.permissions.tools = { 'shell.run': mode === 'ask' ? 'ask' : 'allow' };
    return createToolExecutor({ root, config, log, approvalStore: store });
  }
  return { root, store, executor, first: await executor('first') };
}

const shellCall = (): ToolCallRequest => ({
  name: 'shell.run',
  args: { command: "node -e 'externalEffect()'" },
  toolCallId: 'original',
  invocationId: 'original-invocation',
  agentId: 'original-agent',
});

for (const mode of (process.platform === 'linux' ? ['auto', 'bypass'] : []) as Array<'auto' | 'bypass'>) {
  for (const outcome of ['success', 'failure', 'unknown', 'throw'] as const) {
    it(`${mode}/${outcome}: exact effect enters the adapter once across fresh executor identities`, async () => {
      const f = await fixture(mode);
      let effects = 0;
      vi.spyOn(ShellToolRouter.prototype, 'execute').mockImplementation(async () => {
        effects++;
        if (outcome === 'throw') throw new Error('lost response after effect');
        if (outcome === 'success') return { kind: 'success', output: 'applied' };
        if (outcome === 'unknown') return { kind: 'error', message: 'lost response', outcomeUnknown: true };
        return { kind: 'error', message: 'definite failure' };
      });
      const call = shellCall();
      if (outcome === 'throw') await expect(f.first.execute(call)).rejects.toThrow('lost response after effect');
      else await f.first.execute(call);

      expect(readEffectRecord(f.root, call)?.state).toBe(
        outcome === 'success' ? 'terminal_success' : outcome === 'failure' ? 'terminal_failure' : 'started_unknown',
      );

      const fresh = await f.executor('fresh');
      const replay = await fresh.execute({ ...call, toolCallId: 'fresh-call', invocationId: 'fresh-inv', agentId: 'fresh-agent' });
      expect(replay).toMatchObject({ kind: 'error', retryable: false });
      if (outcome === 'unknown' || outcome === 'throw') expect(replay).toMatchObject({ outcomeUnknown: true });
      expect(effects).toBe(1);
    });
  }
}

(process.platform === 'linux' ? it : it.skip)('ask: a fresh approval cannot override an unresolved journal entry', async () => {
  const f = await fixture('ask');
  let effects = 0;
  vi.spyOn(ShellToolRouter.prototype, 'execute').mockImplementation(async () => {
    effects++;
    return { kind: 'error', message: 'provider response lost', outcomeUnknown: true };
  });
  const call = shellCall();
  const firstAsk = await f.first.execute(call);
  expect(firstAsk.kind).toBe('denied');
  if (firstAsk.kind !== 'denied' || !firstAsk.approvalId) throw new Error('missing approval');
  await f.store.resolve(firstAsk.approvalId, 'approved');
  await f.first.execute({ ...call, source: 'continuation-resume', approvalId: firstAsk.approvalId });
  expect(readEffectRecord(f.root, call)?.state).toBe('started_unknown');
  expect(effects).toBe(1);

  const fresh = await f.executor('fresh');
  const secondCall = { ...call, toolCallId: 'second-call', invocationId: 'second-inv', agentId: 'second-agent' };
  const secondAsk = await fresh.execute(secondCall);
  expect(secondAsk.kind).toBe('denied');
  if (secondAsk.kind !== 'denied' || !secondAsk.approvalId) throw new Error('missing second approval');
  await f.store.resolve(secondAsk.approvalId, 'approved');
  const replay = await fresh.execute({ ...secondCall, source: 'continuation-resume', approvalId: secondAsk.approvalId });
  expect(replay).toMatchObject({ kind: 'error', retryable: false, outcomeUnknown: true });
  expect(effects).toBe(1);
});

it('ask: conservatively safe shell reads remain repeatable and create no journal record', async () => {
  const f = await fixture('ask');
  const router = vi.spyOn(ShellToolRouter.prototype, 'execute').mockResolvedValue({ kind: 'success', output: f.root });
  const call = { ...shellCall(), args: { command: 'pwd' } };
  expect((await f.first.execute(call)).kind).toBe('success');
  expect((await f.first.execute({ ...call, toolCallId: 'again' })).kind).toBe('success');
  expect(router).toHaveBeenCalledTimes(2);
  expect(readEffectRecord(f.root, call)).toBeUndefined();
});
