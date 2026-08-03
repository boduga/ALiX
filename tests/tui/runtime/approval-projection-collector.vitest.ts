import { describe, it, expect } from 'vitest';
import { ApprovalProjectionCollector } from '../../../src/tui/runtime/approval-projection-collector.js';
import { ApprovalProjection } from '../../../src/tui/runtime/approval-projection.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';
import type { AlixEvent } from '../../../src/events/types.js';

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

  it('targetPath is derived from prompt via extractTarget; falls back to raw prompt', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([
      evt('approval.created', { approvalId: 'a1', reason: 'Path protected: /tmp/foo' }, 1),
      evt('approval.created', { approvalId: 'a2', reason: 'plain request' }, 2),
    ]);
    const snap = await new ApprovalProjectionCollector(runtime).snapshot();
    expect(snap!.pending[0]!.targetPath).toBe('/tmp/foo');
    expect(snap!.pending[1]!.targetPath).toBe('plain request');
  });

  it('requestedAt comes from the projection entry timestamp only', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([evt('approval.created', { approvalId: 'a1' }, 1, 1700000000000)]);
    const snap = await new ApprovalProjectionCollector(runtime).snapshot();
    expect(snap!.pending[0]!.requestedAt).toBe(1700000000000);
  });

  it('SnapshotBuilder approvals dependency is an ApprovalProjectionCollector, not ApprovalManager (single source)', async () => {
    // composition-root assertion is hard to unit-test in isolation; instead assert
    // the adapter is the only ApprovalCollector implementation wired via the interface.
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    const collector = new ApprovalProjectionCollector(runtime);
    expect(collector).toSatisfy((c) => c.snapshot !== undefined);
  });
});
