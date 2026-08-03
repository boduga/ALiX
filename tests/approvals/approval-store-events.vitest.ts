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

/** Read the log AFTER awaiting the store's fire-and-forget appends — the
 *  appends are intentionally non-fatal (Option-3), so a test must flush before
 *  asserting emitted events, or it races the async append. */
async function flushAndRead(store: ApprovalStore, eventLog: EventLog) {
  await store.flushEvents();
  return eventLog.readAll();
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
    const events = await flushAndRead(store, eventLog);
    const ce = createdEvent(events, (events[0]!.payload as { approvalId: string }).approvalId)!;
    expect(ce.payload).toMatchObject({ reason: 'Modify config', toolId: 'fs', requestId: 'req-1', sessionId: 's1' });
  });

  it('expireDue emits approval.expired exactly once per newly-expired record', async () => {
    const { eventLog, store } = await fresh();
    await store.request({ reason: 'old', capability: 'x' });
    const expired = await store.expireDue(new Date(Date.now() + 60 * 60_000));
    expect(expired.length).toBeGreaterThan(0);
    const events = await flushAndRead(store, eventLog);
    const expiredEvents = events.filter(e => e.type === 'approval.expired');
    expect(expiredEvents).toHaveLength(expired.length);
  });

  it('revoke emits approval.revoked after successful mutation', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    const revoked = await store.revoke(rec.id, { actor: 'user', reason: 'no' });
    expect(revoked).not.toBeNull();
    const events = await flushAndRead(store, eventLog);
    expect(events.filter(e => e.type === 'approval.revoked')).toHaveLength(1);
  });

  it('consumeApproved emits approval.consumed on success', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const result = await store.consumeApproved(rec.id, rec.bindingKey, {});
    expect(result.consumed).toBe(true);
    const events = await flushAndRead(store, eventLog);
    expect(events.filter(e => e.type === 'approval.consumed')).toHaveLength(1);
  });

  it('invalidateByPolicyRevision emits approval.invalidated per record', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const invalidated = await store.invalidateByPolicyRevision('new-rev');
    expect(invalidated.length).toBeGreaterThan(0);
    const events = await flushAndRead(store, eventLog);
    expect(events.filter(e => e.type === 'approval.invalidated')).toHaveLength(invalidated.length);
  });

  it('resolveGroup emits per-member approval.resolved (not approval.group.resolved)', async () => {
    const { eventLog, store } = await fresh();
    const a = await store.request({ reason: 'a', capability: 'x' });
    const b = await store.request({ reason: 'b', capability: 'y' });
    await store.createGroup({ approvalIds: [a.id, b.id], policyRevision: 'r1' });
    const g = store.list().find(x => x.groupId)!.groupId!;
    await store.resolveGroup(g, 'approved', { actor: 'user' });
    const events = await flushAndRead(store, eventLog);
    expect(events.filter(e => e.type === 'approval.resolved')).toHaveLength(2);
    expect(events.filter(e => e.type === 'approval.group.resolved')).toHaveLength(0);
  });

  it('requestFresh emits enriched approval.created (reason, toolId, requestId, sessionId)', async () => {
    const { eventLog, store } = await fresh();
    await store.requestFresh({
      reason: 'fresh reason',
      bindingKey: 'bk-fresh',
      requestFingerprint: 'fp',
      policyRevision: 'r1',
      capabilities: ['filesystem.read'],
      toolId: 'fsr',
      requestId: 'req-fresh',
      sessionId: 's2',
    });
    const events = await flushAndRead(store, eventLog);
    const ce = createdEvent(events, (events[0]!.payload as { approvalId: string }).approvalId)!;
    expect(ce.payload).toMatchObject({ reason: 'fresh reason', toolId: 'fsr', requestId: 'req-fresh', sessionId: 's2' });
  });

  it('requestOrReusePending emits enriched approval.created (reason, toolId, requestId, sessionId)', async () => {
    const { eventLog, store } = await fresh();
    await store.requestOrReusePending({
      reason: 'reuse reason',
      bindingKey: 'bk-reuse',
      requestFingerprint: 'fp',
      policyRevision: 'r1',
      capabilities: ['filesystem.write'],
      toolId: 'fsr2',
      requestId: 'req-reuse',
      sessionId: 's3',
    });
    const events = await flushAndRead(store, eventLog);
    const ce = createdEvent(events, (events[0]!.payload as { approvalId: string }).approvalId)!;
    expect(ce.payload).toMatchObject({ reason: 'reuse reason', toolId: 'fsr2', requestId: 'req-reuse', sessionId: 's3' });
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

  it('consumeApproved with a wrong binding key is a no-op → emits no approval.consumed', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const before = (await eventLog.readAll()).length;
    const result = await store.consumeApproved(rec.id, 'wrong-binding-key', {});
    expect(result.consumed).toBe(false);
    const after = (await eventLog.readAll()).length;
    expect(after).toBe(before);
  });

  it('revoke on a terminal (consumed) record is a no-op → emits no approval.revoked', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    await store.consumeApproved(rec.id, rec.bindingKey, {});
    const before = (await eventLog.readAll()).length;
    const revoked = await store.revoke(rec.id, { actor: 'user', reason: 'no' });
    expect(revoked).toBeNull();  // consumed is a dead-end; revoke refuses
    const after = (await eventLog.readAll()).length;
    expect(after).toBe(before);
  });
});
