import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeWithEffectJournal, reconcileEffectRecord, readEffectRecord } from '../../src/capabilities/tools/effect-journal.js';
import type { ToolCallRequest } from '../../src/capabilities/tools/types.js';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { closeSharedLedger } from '../../src/runtime-state/storage/runtime-ledger.js';

const roots: string[] = [];
afterEach(async () => {
  // The reconciliation case opens an ApprovalStore, which retains a shared
  // SQLite ledger connection for the workspace. Windows refuses to delete the
  // database while that handle is open, so close it BEFORE rm() — the same
  // cleanup order the stress fixtures use. POSIX unlinks silently, which is why
  // only Windows surfaces the leak.
  for (const root of roots.splice(0)) {
    closeSharedLedger(root);
    await rm(root, { recursive: true, force: true });
  }
});
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'alix-platform-durability-'));
  roots.push(root);
  return root;
}

describe('D9 unsupported-platform durability gate', () => {
  it.skipIf(process.platform === 'linux')('blocks high-risk effects before adapter entry and journal creation', async () => {
    const root = await workspace();
    const request: ToolCallRequest = { toolCallId: 'unsafe', name: 'shell.run', args: { command: 'printf effect > file.txt' } };
    let called = 0;
    const result = await executeWithEffectJournal(root, request, async () => {
      called++;
      return { kind: 'success', output: 'executed' };
    });
    expect(result).toMatchObject({ kind: 'error', retryable: false });
    if (result.kind === 'error') expect(result.message).toMatch(/unsupported on this platform/i);
    expect(called).toBe(0);
    expect(readEffectRecord(root, request)).toBeUndefined();
  });

  it.skipIf(process.platform === 'linux')('keeps read-only safe shell calls available', async () => {
    const root = await workspace();
    const request: ToolCallRequest = { toolCallId: 'safe', name: 'shell.run', args: { command: 'pwd' } };
    let called = 0;
    const result = await executeWithEffectJournal(root, request, async () => {
      called++;
      return { kind: 'success', output: 'ok' };
    });
    expect(result.kind).toBe('success');
    expect(called).toBe(1);
    expect(readEffectRecord(root, request)).toBeUndefined();
  });

  it.skipIf(process.platform === 'linux')('rejects reconciliation before consuming authority or writing history', async () => {
    const root = await workspace();
    const request: ToolCallRequest = { toolCallId: 'unsafe', name: 'shell.run', args: { command: 'printf effect > file.txt' } };
    const approvals = new ApprovalStore(root);
    await approvals.load();
    await expect(reconcileEffectRecord(root, request, {
      approvalId: 'not-consumed', actorId: 'agent', policyRevision: 'r1',
      outcome: 'applied', evidenceHash: 'a'.repeat(64), evidenceRef: 'evidence://test',
    }, approvals)).rejects.toThrow(/requires qualified durable execution/i);
    expect(readEffectRecord(root, request)).toBeUndefined();
  });
});
