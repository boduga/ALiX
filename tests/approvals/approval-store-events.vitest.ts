import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { ApprovalStore } from '../../src/approvals/approval-store.js';

async function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'approval-events-'));
  const eventLog = new EventLog(dir);
  await eventLog.init();
  const store = new ApprovalStore(dir, { eventLog });
  await store.load();
  return { dir, eventLog, store };
}

function createdEvent(events: Awaited<ReturnType<EventLog['readAll']>>, approvalId: string) {
  return events.find(e => e.type === 'approval.created' && (e.payload as any).approvalId === approvalId);
}

describe('ApprovalStore event completeness', () => {
  it('requestBound emits enriched approval.created (reason, toolName, requestId, sessionId)', async () => {
    const { eventLog, store } = await fresh();
    await store.requestBound({
      reason: 'Modify config',
      bindingKey: 'bk',
      requestFingerprint: 'fp',
      policyRevision: 'r1',
      capabilities: ['filesystem.write'],
      toolId: 'fs',
      requestId: 'req-1',
      sessionId: 's1',
    });
    const events = await eventLog.readAll();
    const ce = createdEvent(events, (events[0]!.payload as { approvalId: string }).approvalId)!;
    expect(ce.payload).toMatchObject({ reason: 'Modify config', toolId: 'fs', requestId: 'req-1', sessionId: 's1' });
  });

  it('expireDue emits approval.expired exactly once per newly-expired record', async () => {
    const { eventLog, store } = await fresh();
    await store.request({ reason: 'old', capability: 'x' });
    const expired = await store.expireDue(new Date(Date.now() + 60 * 60_000));
    expect(expired.length).toBeGreaterThan(0);
    const events = await eventLog.readAll();
    const expiredEvents = events.filter(e => e.type === 'approval.expired');
    expect(expiredEvents).toHaveLength(expired.length);
  });

  it('revoke emits approval.revoked after successful mutation', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    const revoked = await store.revoke(rec.id, { actor: 'user', reason: 'no' });
    expect(revoked).not.toBeNull();
    const events = await eventLog.readAll();
    expect(events.filter(e => e.type === 'approval.revoked')).toHaveLength(1);
  });

  it('consumeApproved emits approval.consumed on success', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const result = await store.consumeApproved(rec.id, rec.bindingKey, {});
    expect(result.consumed).toBe(true);
    const events = await eventLog.readAll();
    expect(events.filter(e => e.type === 'approval.consumed')).toHaveLength(1);
  });

  it('invalidateByPolicyRevision emits approval.invalidated per record', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const invalidated = await store.invalidateByPolicyRevision('new-rev');
    expect(invalidated.length).toBeGreaterThan(0);
    const events = await eventLog.readAll();
    expect(events.filter(e => e.type === 'approval.invalidated')).toHaveLength(invalidated.length);
  });

  it('resolveGroup emits per-member approval.resolved (not approval.group.resolved)', async () => {
    const { eventLog, store } = await fresh();
    const a = await store.request({ reason: 'a', capability: 'x' });
    const b = await store.request({ reason: 'b', capability: 'y' });
    await store.createGroup({ approvalIds: [a.id, b.id], policyRevision: 'r1' });
    const g = store.list().find(x => x.groupId)!.groupId!;
    await store.resolveGroup(g, 'approved', { actor: 'user' });
    const events = await eventLog.readAll();
    expect(events.filter(e => e.type === 'approval.resolved')).toHaveLength(2);
    expect(events.filter(e => e.type === 'approval.group.resolved')).toHaveLength(0);
  });

  it('failed mutation emits no lifecycle event', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const before = (await eventLog.readAll()).length;
    // revoke a non-existent record → no-op (revoked is null), no event
    const revoked = await store.revoke('does-not-exist', { actor: 'user', reason: 'x' });
    expect(revoked).toBeNull();
    const after = (await eventLog.readAll()).length;
    expect(after).toBe(before);
  });
});
