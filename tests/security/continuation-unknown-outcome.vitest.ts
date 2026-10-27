/**
 * continuation-unknown-outcome.vitest.ts — a resumed call that reaches no
 * provable terminal outcome must not write a `failed` execution receipt.
 *
 * `ToolExecutor.dispatch` already states the rule for the ordinary path: an
 * `outcomeUnknown` error is a claim whose success is unknown, so recording
 * either receipt would fabricate a verdict, and `pending` is the fail-closed
 * state a later replay classifies `unverified`. The continuation branch
 * returned before that block, so the same adapter result produced
 * `consumed`/`failed` through a resume — permanently retiring a single-use
 * approval that may in fact have applied its effect.
 *
 * The parity table covers BOTH continuation terminal shapes (success, plain
 * error, unknown error) and both routes (ordinary dispatch, continuation
 * resume), so a future change cannot fix one seam by breaking the other.
 */

import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createToolExecutor } from '../../src/capabilities/tools/tool-executor-factory.js';
import type { ToolExecutor } from '../../src/capabilities/tools/tool-executor-factory.js';
import { FileToolRouter } from '../../src/capabilities/tools/tool-router.js';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { ContinuationStore } from '../../src/runtime-state/runtime/continuation-store.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { hashArgs } from '../../src/capabilities/tools/hash-args.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  closeAllSharedLedgers();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Terminal shape the routed handler produces for this call. */
type Outcome = 'success' | 'error' | 'unknown';

const TERMINAL: Record<Outcome, { kind: 'success'; output: string } | { kind: 'error'; message: string; outcomeUnknown?: true }> = {
  success: { kind: 'success', output: 'handler completed' },
  error: { kind: 'error', message: 'handler failed' },
  unknown: { kind: 'error', message: 'handler outcome unknown', outcomeUnknown: true },
};

/** Expected durable receipt per route: `null` means "no receipt at all". */
const EXPECTED: Record<Outcome, { ordinary: string; resumed: string }> = {
  success: { ordinary: 'succeeded', resumed: 'succeeded' },
  error: { ordinary: 'failed', resumed: 'failed' },
  // The whole point: BOTH routes must leave the claim `pending`.
  unknown: { ordinary: 'pending', resumed: 'pending' },
};

async function fixture(outcome: Outcome) {
  const root = await mkdtemp(join(tmpdir(), `alix-cont-outcome-${outcome}-`));
  dirs.push(root);
  const log = new EventLog(join(root, '.alix', 'sessions', 'outcome-test'));
  await log.init();
  const store = new ApprovalStore(root);
  await store.load();
  const config = structuredClone(DEFAULT_CONFIG);
  config.permissions.sessionMode = 'ask';
  config.permissions.tools = { 'file.create': 'ask' };
  const executor = createToolExecutor({ config, log, root, approvalStore: store }) as ToolExecutor;

  // The adapter result observed after the file effect is applied. `file.create`
  // is owned by FileToolRouter in the composite, so wrap that router (the same
  // seam the daemon crash fixture uses) rather than an unreachable extraHandler.
  // It runs AFTER the real router, so the effect is applied in every case.
  const real = FileToolRouter.prototype.execute;
  const spy = vi.spyOn(FileToolRouter.prototype, 'execute').mockImplementation(async function (this: FileToolRouter, req) {
    const result = await real.call(this, req);
    if (req.name !== 'file.create') return result;
    const terminal = TERMINAL[outcome];
    // A plain success must keep the real success shape (the resume path reads
    // it); only the failure shapes are substituted.
    return terminal.kind === 'success' ? result : terminal;
  });
  return { root, log, store, config, executor, restore: () => spy.mockRestore() };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const request = (tag: string) => ({
  toolCallId: `call-${tag}`,
  name: 'file.create',
  args: { path: `${tag}.txt`, content: 'effect' },
  agentId: 'original-agent',
});

async function askAndApprove(f: Fixture, call: ReturnType<typeof request>): Promise<string> {
  const first = await f.executor.execute(call);
  expect(first.kind).toBe('denied');
  const approvalId = (first as { approvalId?: string }).approvalId!;
  await f.store.resolve(approvalId, 'approved');
  return approvalId;
}

async function persistContinuation(f: Fixture, approvalId: string, call: ReturnType<typeof request>): Promise<void> {
  const store = new ContinuationStore(f.root);
  await store.load();
  await store.persist({
    approvalId,
    kind: 'tool',
    sessionId: 'outcome-test',
    cwd: f.root,
    toolCall: {
      toolCallId: call.toolCallId,
      name: call.name,
      capability: 'file.create',
      args: call.args,
      argsHash: hashArgs(call.args),
      agentId: call.agentId,
    },
    createdAt: new Date().toISOString(),
  });
}

for (const outcome of ['success', 'error', 'unknown'] as const) {
  it(`ordinary dispatch records ${EXPECTED[outcome].ordinary} for a ${outcome} outcome`, async () => {
    const f = await fixture(outcome);
    const call = request(`ordinary-${outcome}`);
    const approvalId = await askAndApprove(f, call);
    await f.executor.execute(call);
    expect(await f.store.loadFresh(approvalId)).toMatchObject({
      status: 'consumed', executionOutcome: EXPECTED[outcome].ordinary,
    });
    await f.log.close();
  });

  it(`continuation resume records ${EXPECTED[outcome].resumed} for a ${outcome} outcome`, async () => {
    const f = await fixture(outcome);
    const call = request(`resumed-${outcome}`);
    const approvalId = await askAndApprove(f, call);
    await persistContinuation(f, approvalId, call);
    // The resume path always resolves a result (it does not throw on a plain
    // tool error), so the receipt it leaves is the only durable verdict.
    await f.executor.resumeApprovedContinuation(approvalId, new AbortController().signal);
    expect(await f.store.loadFresh(approvalId)).toMatchObject({
      status: 'consumed', executionOutcome: EXPECTED[outcome].resumed,
    });
    await f.log.close();
  });
}

it('an unknown resumed outcome stays pending and is refused on replay, never reissued', async () => {
  const f = await fixture('unknown');
  const call = request('resumed-unknown-replay');
  const approvalId = await askAndApprove(f, call);
  await persistContinuation(f, approvalId, call);
  await f.executor.resumeApprovedContinuation(approvalId, new AbortController().signal);

  const uncertain = await f.store.loadFresh(approvalId);
  expect(uncertain).toMatchObject({ status: 'consumed', executionOutcome: 'pending' });
  expect(f.store.listUncertainConsumptions().map(a => a.id)).toContain(approvalId);

  // A replay must deny rather than execute or promote. The continuation was
  // tombstoned by the resume, so this stops at the still-authorized check
  // (`consumed` is never `approved`); what matters is that it refuses and the
  // claim is unchanged.
  const replay = await f.executor.execute({ ...call, source: 'continuation-resume', approvalId });
  expect(replay.kind).toBe('denied');
  expect((replay as { reason: string }).reason).toMatch(/missing, not approved, or expired/i);
  expect(await f.store.loadFresh(approvalId)).toMatchObject({ status: 'consumed', executionOutcome: 'pending' });
  expect(await f.store.loadFresh(approvalId)).toEqual(uncertain);
  await f.log.close();
});
