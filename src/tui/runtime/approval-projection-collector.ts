import type { ProjectionRuntime } from './projection-runtime.js';
import { ProjectionIds } from './projection-ids.js';
import type { ApprovalProjectionSnapshot } from './approval-projection.js';
import type { ApprovalCollector } from '../snapshot-builder.js';
import type { ApprovalSnapshot, ApprovalRecordSnapshot } from '../snapshot.js';
import { extractTarget } from '../../approvals/extract-target.js';

/** Map a projection entry to the UI-facing record shape. */
function toRecord(e: import('./approval-projection.js').ApprovalProjectionEntry): ApprovalRecordSnapshot {
  return {
    id: e.approvalId,
    toolName: e.toolName ?? 'unknown',
    target: extractTarget(e.prompt) ?? e.prompt ?? '',
    args: {},
    requestedAt: e.requestedAt,
    requestedBy: 'system',
  };
}

/** Adapter from ApprovalProjectionSnapshot → the ApprovalCollector interface. */
export class ApprovalProjectionCollector implements ApprovalCollector {
  constructor(private readonly runtime: ProjectionRuntime) {}
  async snapshot(): Promise<ApprovalSnapshot | null> {
    const proj = this.runtime.snapshotOf<ApprovalProjectionSnapshot>(ProjectionIds.approval);
    if (!proj) return null;
    return {
      pending: proj.pending.map(toRecord),
      recentlyResolved: proj.completed.map(toRecord),
      totalPending: proj.pending.length,
      totalResolved: proj.completed.length,
    };
  }
}
