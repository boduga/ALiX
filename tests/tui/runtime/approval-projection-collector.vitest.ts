import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../../src/events/event-log.js';
import { ApprovalStore } from '../../../src/approvals/approval-store.js';
import { ApprovalProjectionCollector } from '../../../src/tui/runtime/approval-projection-collector.js';
import { ApprovalProjection } from '../../../src/tui/runtime/approval-projection.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';
import { extractTarget } from '../../../src/approvals/extract-target.js';
import type { AlixEvent } from '../../../src/events/types.js';
import type { ApprovalCollector } from '../../../src/tui/snapshot-builder.js';
import type { ApprovalManager } from '../../../src/tui/approval-manager.js';

function evt(type: string, payload: Record<string, unknown>, seq: number, ts = seq * 1000): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(ts).toISOString(), type, actor: 'system', payload };
}

describe('ApprovalProjectionCollector', () => {
  it('maps pending + completed to ApprovalSnapshot; totalResolved is real', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([
      evt('approval.requested', { approvalId: 'a1', prompt: 'Modify config', toolName: 'fs.write' }, 1),
      evt('approval.resolved', { approvalId: 'a1', decision: 'approved' }, 2),
      evt('approval.created', { approvalId: 'a2' }, 3),
    ]);
    const collector = new ApprovalProjectionCollector(runtime);
    const snap = await collector.snapshot();
    expect(snap).not.toBeNull();
    expect(snap!.pending).toHaveLength(1);
    expect(snap!.pending[0]!.id).toBe('a2');
    expect(snap!.pending[0]!.toolName).toBe('unknown'); // adapter fallback
    expect(snap!.recentlyResolved).toHaveLength(1);
    expect(snap!.recentlyResolved[0]!.id).toBe('a1');
    expect(snap!.totalPending).toBe(1);
    expect(snap!.totalResolved).toBe(1);
  });

  it('pending ordering follows request sequence; terminal entries are NOT in pending (list-membership distinction)', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([
      evt('approval.created', { approvalId: 'a2' }, 1),
      evt('approval.requested', { approvalId: 'a1', prompt: 'run' }, 2),
    ]);
    const collector = new ApprovalProjectionCollector(runtime);
    const snap = await collector.snapshot();
    expect(snap!.pending.map(p => p.id)).toEqual(['a2', 'a1']);
    // A terminal entry leaves pending entirely (projection moves it to completed)
    const runtime2 = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime2.updateAll([
      evt('approval.created', { approvalId: 'a1' }, 1),
      evt('approval.expired', { approvalId: 'a1' }, 2),
    ]);
    const collector2 = new ApprovalProjectionCollector(runtime2);
    const snap2 = await collector2.snapshot();
    expect(snap2!.pending).toHaveLength(0);
    expect(snap2!.recentlyResolved).toHaveLength(1);
    // ApprovalRecordSnapshot has no status field (UI contract); the distinction
    // is expressed by list membership. The projection's own snapshot carries it:
    expect(runtime2.snapshotOf<import('../../../src/tui/runtime/approval-projection.js').ApprovalProjectionSnapshot>(ProjectionIds.approval)!.completed[0]!.status).toBe('expired');
  });

  it('target is derived from prompt via extractTarget; falls back to raw prompt', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([
      evt('approval.created', { approvalId: 'a1', reason: 'Path protected: /tmp/foo' }, 1),
      evt('approval.created', { approvalId: 'a2', reason: 'plain request' }, 2),
    ]);
    const snap = await new ApprovalProjectionCollector(runtime).snapshot();
    expect(snap!.pending[0]!.target).toBe('/tmp/foo');
    expect(snap!.pending[1]!.target).toBe('plain request');
  });

  it('requestedAt comes from the projection entry timestamp only', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([evt('approval.created', { approvalId: 'a1' }, 1, 1700000000000)]);
    const snap = await new ApprovalProjectionCollector(runtime).snapshot();
    expect(snap!.pending[0]!.requestedAt).toBe(1700000000000);
  });

  it('A10 (type-level): ApprovalManager is NOT assignable to ApprovalCollector — the type system enforces a single collector source', () => {
    // The migration removed ApprovalManager.snapshot(); it therefore no longer
    // satisfies ApprovalCollector. If someone re-adds snapshot() or passes
    // ApprovalManager as the collector, this @ts-expect-error stops compiling —
    // the single-source invariant is enforced structurally, not by a weak runtime
    // assertion.
    // @ts-expect-error — ApprovalManager has no snapshot(); only the adapter satisfies ApprovalCollector
    const _c: ApprovalCollector = {} as unknown as ApprovalManager;
  });

  it('PARITY ORACLE: same store fixture → identical ApprovalSnapshot via store path and projection path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-'));
    const eventLog = new EventLog(dir);
    await eventLog.init();
    const store = new ApprovalStore(dir, { eventLog });
    await store.load();

    const a1 = await store.request({ reason: 'Path protected: /tmp/foo', capability: 'filesystem.write', toolId: 'fs' });
    const a2 = await store.request({ reason: 'plain', capability: 'shell.exec', toolId: 'sh' });
    await store.resolve(a1.id, 'approved');

    // --- projection path ---
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    await store.flushEvents();  // await the fire-and-forget appends before reading
    runtime.updateAll(await eventLog.readAll());
    const projSnap = await new ApprovalProjectionCollector(runtime).snapshot();

    // --- store path (the pre-migration behavior) ---
    // ApprovalManager.snapshot() mapped: id, toolName=capability[0], target=extractTarget(reason)||reason, args:{}, requestedAt, requestedBy:'system'
    const pending = store.listPending();
    const storeSnap = {
      pending: pending.map(r => ({
        id: r.id,
        toolName: r.capabilities?.[0] ?? 'unknown',
        target: extractTarget(r.reason) ?? r.reason ?? '',
        args: {},
        requestedAt: Date.parse(r.createdAt) || Date.now(),
        requestedBy: 'system',
      })),
      recentlyResolved: [] as unknown[],
      totalPending: pending.length,
      totalResolved: 0,
    };

    // NORMALIZED deep equality — not whole-object `toEqual`, because the adapter
    // intentionally diverges on `recentlyResolved`/`totalResolved` (old path:
    // always `[]`/0; new path: real projection history). Normalize the comparison:
    // assert the fields that must match (ids, pending ordering, timestamps,
    // target, toolName) with per-field equality, and assert the intentional
    // divergence explicitly.
    expect(projSnap!.pending).toEqual(storeSnap.pending); // ids, ordering, timestamps, target, toolName
    // RESOLVED side — assert the completed entry's mapped fields (not just
    // length), so the adapter's completed→recentlyResolved mapping is genuinely
    // proven and the oracle can't pass with a wrong completed-entry mapping.
    expect(projSnap!.recentlyResolved).toHaveLength(1);
    const resolved = projSnap!.recentlyResolved[0]!;
    expect(resolved.id).toBe(a1.id);
    expect(resolved.toolName).toBe('filesystem.write'); // capabilities[0]
    expect(resolved.target).toBe('/tmp/foo');        // extractTarget(reason)
    expect(resolved.requestedAt).toBe(Date.parse(a1.createdAt)); // payload.timestamp = record.createdAt
    expect(resolved.args).toEqual({});
    expect(resolved.requestedBy).toBe('system');
    // intentional divergence (adapter now supplies real resolved history):
    expect(storeSnap.recentlyResolved).toEqual([]);
    expect(projSnap!.totalResolved).toBe(1);
    expect(projSnap!.totalPending).toBe(storeSnap.totalPending);
  });

  it('FULL LIFECYCLE: request → resolve(approved) → consume → attempted revoke (dead-end); projection ends consumed, matching store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lifecycle-'));
    const eventLog = new EventLog(dir);
    await eventLog.init();
    const store = new ApprovalStore(dir, { eventLog });
    await store.load();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved'); // approved
    // post-approval transition: consumeApproved requires approved → succeeds
    const consumed = await store.consumeApproved(rec.id, rec.bindingKey, {});
    expect(consumed.consumed).toBe(true);
    // dead-end: revoke refuses consumed
    await store.revoke(rec.id, { actor: 'user', reason: 'no' });
    const storeRecord = store.get(rec.id);
    expect(storeRecord!.status).toBe('consumed'); // NOT reopened by the failed revoke
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    await store.flushEvents();  // await the fire-and-forget appends before reading
    runtime.updateAll(await eventLog.readAll());
    const projSnap = await new ApprovalProjectionCollector(runtime).snapshot();
    // consumed is the final terminal state — the entry left pending entirely
    expect(projSnap!.pending).toHaveLength(0);
    expect(projSnap!.recentlyResolved.map(r => r.id)).toContain(rec.id);
    // the projection's own snapshot carries the precise terminal status
    const raw = runtime.snapshotOf<import('../../../src/tui/runtime/approval-projection.js').ApprovalProjectionSnapshot>(ProjectionIds.approval)!;
    expect(raw.completed[0]!.status).toBe('consumed');
  });
});
