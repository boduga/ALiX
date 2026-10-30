import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import {
  effectReconciliationAuthority,
  executeWithEffectJournal,
  readEffectRecord,
  readEffectReconciliationHistory,
  reconcileEffectRecord,
  type EffectReconciliationInput,
} from '../../src/capabilities/tools/effect-journal.js';
import type { ToolCallRequest } from '../../src/capabilities/tools/types.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'alix-effect-reconcile-'));
  roots.push(root);
  const approvals = new ApprovalStore(root);
  await approvals.load();
  return { root, approvals };
}

function request(command = 'printf applied > effect.txt'): ToolCallRequest {
  return { toolCallId: 'effect-call', name: 'shell.run', args: { command } };
}

async function seedUnknown(root: string, req: ToolCallRequest): Promise<void> {
  const result = await executeWithEffectJournal(root, req, async () => ({
    kind: 'error', message: 'response lost after possible effect', outcomeUnknown: true,
  }));
  expect(result).toMatchObject({ kind: 'error', outcomeUnknown: true, retryable: false });
  expect(readEffectRecord(root, req)?.state).toBe('started_unknown');
}

async function authorize(
  root: string,
  approvals: ApprovalStore,
  req: ToolCallRequest,
  overrides: Partial<Omit<EffectReconciliationInput, 'approvalId'>> = {},
) {
  const input = {
    actorId: 'reconciler-agent',
    policyRevision: 'policy-r1',
    outcome: 'applied' as const,
    evidenceHash: 'a'.repeat(64),
    evidenceRef: 'evidence://probe/1',
    ...overrides,
  };
  const authority = effectReconciliationAuthority(root, req, input);
  const approval = await approvals.requestBound({
    reason: 'D9 effect reconciliation',
    bindingKey: authority.bindingKey,
    requestFingerprint: authority.requestFingerprint,
    policyRevision: input.policyRevision,
    capabilities: [authority.capability],
    agentId: input.actorId,
    riskLevel: 'critical',
    toolId: 'effect.reconcile',
  });
  await approvals.resolve(approval.id, 'approved', 'delegated reconciliation authority');
  return { input: { ...input, approvalId: approval.id } satisfies EffectReconciliationInput, approval };
}

(process.platform === 'linux' ? describe : describe.skip)('D9 Slice F effect reconciliation authority', () => {
  it('rejects a self-asserted actor that does not match the approved subject', async () => {
    const { root, approvals } = await setup();
    const req = request();
    await seedUnknown(root, req);
    const { input, approval } = await authorize(root, approvals, req);
    await expect(reconcileEffectRecord(root, req, { ...input, actorId: 'different-agent' }, approvals))
      .rejects.toThrow(/actor.*approved authority/i);
    expect((await approvals.loadFresh(approval.id))?.status).toBe('approved');
    expect(readEffectRecord(root, req)?.state).toBe('started_unknown');
    expect(readEffectReconciliationHistory(root, req)).toEqual([]);
  });

  it('rejects invalid runtime outcomes before authority can be consumed', async () => {
    const { root, approvals } = await setup();
    const req = request('touch invalid-outcome');
    await seedUnknown(root, req);
    const { input, approval } = await authorize(root, approvals, req);
    await expect(reconcileEffectRecord(root, req, { ...input, outcome: 'invented' as any }, approvals))
      .rejects.toThrow(/invalid reconciliation outcome/i);
    expect((await approvals.loadFresh(approval.id))?.status).toBe('approved');
    expect(readEffectRecord(root, req)?.state).toBe('started_unknown');
  });

  it('snapshots authority-bound input before any await so later mutation cannot change the decision', async () => {
    const { root, approvals } = await setup();
    const req = request('touch snapshot-input');
    await seedUnknown(root, req);
    const { input } = await authorize(root, approvals, req, { outcome: 'applied', evidenceHash: '2'.repeat(64) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = approvals.loadFresh.bind(approvals);
    const loadFresh = approvals.loadFresh.bind(approvals);
    approvals.loadFresh = async (id: string) => { await gate; return loadFresh(id); };
    const pending = reconcileEffectRecord(root, req, input, approvals);
    input.outcome = 'not_applied';
    input.evidenceHash = '3'.repeat(64);
    release();
    const result = await pending;
    approvals.loadFresh = original;
    expect(result.state).toBe('reconciled_success');
    expect(readEffectRecord(root, req)?.state).toBe('reconciled_success');
    expect(readEffectReconciliationHistory(root, req)[0]).toMatchObject({ outcome: 'applied', evidenceHash: '2'.repeat(64) });
  });

  it('binds reconciliation to the synchronous request identity even if the caller mutates the request across awaits', async () => {
    const { root, approvals } = await setup();
    const req = request('touch request-original');
    await seedUnknown(root, req);
    const { input } = await authorize(root, approvals, req, { outcome: 'applied', evidenceHash: '7'.repeat(64) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loadFresh = approvals.loadFresh.bind(approvals);
    approvals.loadFresh = async (id: string) => { await gate; return loadFresh(id); };
    const pending = reconcileEffectRecord(root, req, input, approvals);
    req.args.command = 'touch request-mutated';
    release();
    const result = await pending;
    expect(result.state).toBe('reconciled_success');
    const original = request('touch request-original');
    expect(readEffectRecord(root, original)?.state).toBe('reconciled_success');
    expect(readEffectRecord(root, request('touch request-mutated'))).toBeUndefined();
  });

  it('does not let an unused approval from an older journal generation reconcile a later generation', async () => {
    const { root, approvals } = await setup();
    const req = request('touch generation-bound');
    await seedUnknown(root, req);
    const oldAuthority = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceHash: '8'.repeat(64), evidenceRef: 'evidence://old-generation' });
    const releasing = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceHash: '9'.repeat(64), evidenceRef: 'evidence://release-generation-1' });
    await reconcileEffectRecord(root, req, releasing.input, approvals);
    await seedUnknown(root, { ...req, toolCallId: 'generation-two' });
    await expect(reconcileEffectRecord(root, req, oldAuthority.input, approvals)).rejects.toThrow(/binding mismatch/i);
    expect((await approvals.loadFresh(oldAuthority.approval.id))?.status).toBe('approved');
    expect(readEffectRecord(root, req)?.state).toBe('started_unknown');
  });

  it('rejects changed evidence/outcome/operation identity instead of reusing authority', async () => {
    const { root, approvals } = await setup();
    const first = request('touch first');
    const second = request('touch second');
    await seedUnknown(root, first);
    await seedUnknown(root, second);
    const { input, approval } = await authorize(root, approvals, first);

    await expect(reconcileEffectRecord(root, first, { ...input, evidenceHash: 'b'.repeat(64) }, approvals))
      .rejects.toThrow(/binding mismatch/i);
    await expect(reconcileEffectRecord(root, second, input, approvals)).rejects.toThrow(/binding mismatch/i);
    expect((await approvals.loadFresh(approval.id))?.status).toBe('approved');
    expect(readEffectRecord(root, first)?.state).toBe('started_unknown');
    expect(readEffectRecord(root, second)?.state).toBe('started_unknown');
  });
});

(process.platform === 'linux' ? describe : describe.skip)('D9 Slice F reconciliation outcomes', () => {
  it('applied evidence is append-audited, transitions to reconciled_success, and remains quarantined', async () => {
    const { root, approvals } = await setup();
    const req = request();
    await seedUnknown(root, req);
    const { input, approval } = await authorize(root, approvals, req, { outcome: 'applied' });
    const reconciled = await reconcileEffectRecord(root, req, input, approvals);
    expect(reconciled.state).toBe('reconciled_success');
    expect(readEffectRecord(root, req)?.state).toBe('reconciled_success');
    expect(readEffectReconciliationHistory(root, req)).toMatchObject([{
      effectKey: reconciled.effectKey,
      previousState: 'started_unknown',
      outcome: 'applied',
      targetState: 'reconciled_success',
      actorId: input.actorId,
      approvalId: approval.id,
      evidenceHash: input.evidenceHash,
      evidenceRef: input.evidenceRef,
    }]);
    expect((await approvals.loadFresh(approval.id))).toMatchObject({ status: 'consumed', executionOutcome: 'succeeded' });
    let calls = 0;
    const replay = await executeWithEffectJournal(root, { ...req, toolCallId: 'replay' }, async () => {
      calls++; return { kind: 'success', output: 'duplicate' };
    });
    expect(replay).toMatchObject({ kind: 'error', retryable: false });
    expect(calls).toBe(0);
  });

  it('not_applied evidence preserves history/archive and permits one fresh exact attempt', async () => {
    const { root, approvals } = await setup();
    const req = request('touch maybe');
    await seedUnknown(root, req);
    const { input, approval } = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceHash: 'c'.repeat(64) });
    const reconciled = await reconcileEffectRecord(root, req, input, approvals);
    expect(reconciled.state).toBe('reconciled_not_applied');
    expect(readEffectRecord(root, req)).toBeUndefined();
    expect(readEffectReconciliationHistory(root, req)).toHaveLength(1);
    expect((await approvals.loadFresh(approval.id))).toMatchObject({ status: 'consumed', executionOutcome: 'succeeded' });

    let calls = 0;
    const retry = await executeWithEffectJournal(root, { ...req, toolCallId: 'fresh-attempt' }, async () => {
      calls++; return { kind: 'success', output: 'now applied' };
    });
    expect(retry.kind).toBe('success');
    expect(calls).toBe(1);
    expect(readEffectRecord(root, req)?.state).toBe('terminal_success');
    expect(readEffectReconciliationHistory(root, req)).toHaveLength(1);
  });

  it('terminal_failure remains quarantined until evidence-bound not_applied reconciliation releases it', async () => {
    const { root, approvals } = await setup();
    const req = request('touch definite-failure');
    const first = await executeWithEffectJournal(root, req, async () => ({ kind: 'error', message: 'definite pre-effect adapter failure' }));
    expect(first).toMatchObject({ kind: 'error', retryable: false });
    expect(readEffectRecord(root, req)?.state).toBe('terminal_failure');
    const { input } = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceHash: '1'.repeat(64), evidenceRef: 'evidence://definite-failure' });
    await reconcileEffectRecord(root, req, input, approvals);
    expect(readEffectRecord(root, req)).toBeUndefined();
    let calls = 0;
    expect((await executeWithEffectJournal(root, { ...req, toolCallId: 'after-terminal-failure' }, async () => {
      calls++; return { kind: 'success', output: 'retry applied' };
    })).kind).toBe('success');
    expect(calls).toBe(1);
  });

  it('history remains append-only across a later unresolved generation of the same effect key', async () => {
    const { root, approvals } = await setup();
    const req = request('touch recurring');
    await seedUnknown(root, req);
    const first = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceHash: 'd'.repeat(64), evidenceRef: 'evidence://first' });
    await reconcileEffectRecord(root, req, first.input, approvals);

    await seedUnknown(root, { ...req, toolCallId: 'generation-2' });
    const second = await authorize(root, approvals, req, { outcome: 'applied', evidenceHash: 'e'.repeat(64), evidenceRef: 'evidence://second' });
    await reconcileEffectRecord(root, req, second.input, approvals);
    const history = readEffectReconciliationHistory(root, req);
    expect(history).toHaveLength(2);
    expect(history.map((event) => event.evidenceRef)).toEqual(['evidence://first', 'evidence://second']);
    expect(history.map((event) => event.outcome)).toEqual(['not_applied', 'applied']);
  });
});

(process.platform === 'linux' ? describe : describe.skip)('D9 Slice F reconciliation concurrency', () => {
  it('serializes contradictory reconcilers so a stale not_applied decision cannot overwrite an applied decision', async () => {
    const { root, approvals } = await setup();
    const req = request('touch reconcile-race');
    await seedUnknown(root, req);
    const applied = await authorize(root, approvals, req, { outcome: 'applied', evidenceHash: '4'.repeat(64), evidenceRef: 'evidence://applied' });
    const notApplied = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceHash: '5'.repeat(64), evidenceRef: 'evidence://not-applied' });
    const [a, b] = await Promise.allSettled([
      reconcileEffectRecord(root, req, applied.input, approvals),
      reconcileEffectRecord(root, req, notApplied.input, approvals),
    ]);
    const fulfilled = [a, b].filter((x) => x.status === 'fulfilled');
    const rejected = [a, b].filter((x) => x.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const live = readEffectRecord(root, req);
    const history = readEffectReconciliationHistory(root, req);
    expect(history).toHaveLength(1);
    if (history[0]!.outcome === 'applied') {
      expect(live?.state).toBe('reconciled_success');
    } else {
      expect(live).toBeUndefined();
    }
    // The losing authority was never consumed because state is rechecked under the same effect lock.
    const losingId = history[0]!.outcome === 'applied' ? notApplied.approval.id : applied.approval.id;
    expect((await approvals.loadFresh(losingId))?.status).toBe('approved');
  });

  it('cannot reconcile started_unknown while the original adapter still holds the exact-effect lock', async () => {
    const { root, approvals } = await setup();
    const req = request('touch live-adapter');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
    const active = executeWithEffectJournal(root, req, async () => { entered(); await gate; return { kind: 'success', output: 'applied' }; });
    await enteredGate;
    expect(readEffectRecord(root, req)?.state).toBe('started_unknown');
    const { input, approval } = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceHash: '6'.repeat(64) });
    await expect(reconcileEffectRecord(root, req, input, approvals, { lockTimeoutMs: 75 })).rejects.toThrow(/lock unavailable/i);
    expect((await approvals.loadFresh(approval.id))?.status).toBe('approved');
    expect(readEffectRecord(root, req)?.state).toBe('started_unknown');
    release();
    expect((await active).kind).toBe('success');
    expect(readEffectRecord(root, req)?.state).toBe('terminal_success');
  });
});

(process.platform === 'linux' ? describe : describe.skip)('D9 Slice F reconciliation crash ordering', () => {
  it('crash after authority/history leaves the live unknown record quarantined', async () => {
    for (const point of ['after_authority', 'after_history'] as const) {
      const { root, approvals } = await setup();
      const req = request(`touch ${point}`);
      await seedUnknown(root, req);
      const { input } = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceRef: `evidence://${point}` });
      await expect(reconcileEffectRecord(root, req, input, approvals, {
        onPoint: (seen) => { if (seen === point) throw new Error(`fault:${point}`); },
      })).rejects.toThrow(`fault:${point}`);
      expect(readEffectRecord(root, req)?.state).toBe('started_unknown');
      let calls = 0;
      expect((await executeWithEffectJournal(root, req, async () => { calls++; return { kind: 'success', output: 'bad' }; })).kind).toBe('error');
      expect(calls).toBe(0);
    }
  });

  it('crash after durable reconciled_not_applied state can only finish the already-authorized release', async () => {
    const { root, approvals } = await setup();
    const req = request('touch recover-release');
    await seedUnknown(root, req);
    const { input } = await authorize(root, approvals, req, { outcome: 'not_applied', evidenceHash: 'f'.repeat(64) });
    await expect(reconcileEffectRecord(root, req, input, approvals, {
      onPoint: (seen) => { if (seen === 'after_reconciled_state') throw new Error('fault:after_reconciled_state'); },
    })).rejects.toThrow('fault:after_reconciled_state');
    expect(readEffectRecord(root, req)?.state).toBe('reconciled_not_applied');
    expect(readEffectReconciliationHistory(root, req)).toHaveLength(1);

    let calls = 0;
    const retry = await executeWithEffectJournal(root, { ...req, toolCallId: 'post-crash-retry' }, async () => {
      calls++; return { kind: 'success', output: 'fresh effect' };
    });
    expect(retry.kind).toBe('success');
    expect(calls).toBe(1);
    expect(readEffectRecord(root, req)?.state).toBe('terminal_success');
    expect(readEffectReconciliationHistory(root, req)).toHaveLength(1);
  });
});
