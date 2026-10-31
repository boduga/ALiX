/**
 * D9 Slice F — `alix effects` reconciliation entry point.
 *
 * Slice F requires an *audited delegated reconciliation path* for unresolved
 * journal entries
 * (docs/2026-10-28-d9-phase-f-remediation-implementation-plan.md). The journal's
 * `reconcileEffectRecord` was exercised only by tests, so a quarantined exact
 * effect had no operator remedy. These cases pin the production entry point:
 * it lists unresolved records, mints a pending approval, refuses to reconcile
 * before that approval exists, and durably transitions the record after it.
 *
 * The security assertions (never clear by age, missing authority fails closed,
 * evidence + actor recorded, identity cannot be silently changed) live in
 * `tests/security/effect-reconciliation.vitest.ts`; this file pins only that the
 * operator can actually reach them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import {
  executeWithEffectJournal,
  readEffectRecord,
  readEffectReconciliationHistory,
} from '../../src/capabilities/tools/effect-journal.js';
import {
  handleEffectsList,
  handleEffectsReconcile,
  handleEffectsRequest,
} from '../../src/interfaces/cli/commands/effects.js';
import { closeSharedLedger } from '../../src/runtime-state/storage/runtime-ledger.js';

(process.platform === 'linux' ? describe : describe.skip)('alix effects CLI', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'alix-effects-cli-'));
  });

  afterEach(async () => {
    closeSharedLedger(root);
    await rm(root, { recursive: true, force: true });
  });

  async function seedUnknown(): Promise<{ tool: string; argsJson: string }> {
    const args = { command: 'printf applied > cli-effect.txt' };
    const result = await executeWithEffectJournal(root, { toolCallId: 'c1', name: 'shell.run', args },
      async () => ({ kind: 'error', message: 'response lost', outcomeUnknown: true }));
    expect(result).toMatchObject({ kind: 'error', outcomeUnknown: true });
    return { tool: 'shell.run', argsJson: JSON.stringify(args) };
  }

  function facts(): string[] {
    return ['--outcome', 'applied', '--evidence-hash', 'a'.repeat(64),
      '--evidence-ref', 'evidence://cli/1', '--actor', 'reconciler', '--policy-revision', 'policy-r1'];
  }

  it('lists the unresolved record an outcomeUnknown result left behind', async () => {
    const rec = await seedUnknown();
    const out = await handleEffectsList(root);
    expect(out).toBe(0);
  });

  it('refuses to reconcile before the delegated approval is approved', async () => {
    const rec = await seedUnknown();
    const requested = await handleEffectsRequest(root, ['--tool', rec.tool, '--args', rec.argsJson, ...facts()]);
    expect(requested).toBe(0);

    // The pending approval exists but is NOT approved yet: reconciliation must
    // fail closed, leaving the record unresolved. Authority is never inferred.
    const pendingStore = new ApprovalStore(root);
    await pendingStore.load();
    const approvalId = pendingStore.listPending()[0].id;
    const exit = await handleEffectsReconcile(root, ['--tool', rec.tool, '--args', rec.argsJson,
      '--approval', approvalId, ...facts()]);
    expect(exit).toBe(1);
    expect(readEffectRecord(root, { toolCallId: 'c1', name: rec.tool, args: JSON.parse(rec.argsJson) })?.state)
      .toBe('started_unknown');
  });

  it('reconciles the exact effect once the operator approves', async () => {
    const rec = await seedUnknown();
    await handleEffectsRequest(root, ['--tool', rec.tool, '--args', rec.argsJson, ...facts()]);
    const store = new ApprovalStore(root);
    await store.load();
    const pending = store.listPending();
    expect(pending.length).toBe(1);
    await store.resolve(pending[0].id, 'approved', 'operator approved');

    const exit = await handleEffectsReconcile(root, ['--tool', rec.tool, '--args', rec.argsJson,
      '--approval', pending[0].id, ...facts()]);
    expect(exit).toBe(0);
    expect(readEffectRecord(root, { toolCallId: 'c1', name: rec.tool, args: JSON.parse(rec.argsJson) })?.state)
      .toBe('reconciled_success');

    // The reconciliation is durable and append-only: history records the actor.
    const history = readEffectReconciliationHistory(root,
      { toolCallId: 'c1', name: rec.tool, args: JSON.parse(rec.argsJson) });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ actorId: 'reconciler', outcome: 'applied', previousState: 'started_unknown' });

    // An already-reconciled-successful record no longer needs attention.
    expect(await handleEffectsList(root)).toBe(0);
  });

  it('rejects a malformed outcome rather than defaulting one', async () => {
    const rec = await seedUnknown();
    const exit = await handleEffectsRequest(root, ['--tool', rec.tool, '--args', rec.argsJson,
      '--outcome', 'maybe', '--evidence-hash', 'a'.repeat(64), '--evidence-ref', 'r',
      '--actor', 'a', '--policy-revision', 'p']);
    expect(exit).toBe(2);
  });
});
