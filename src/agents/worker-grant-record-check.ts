/** GE-04 Q3.8: pure synthetic post-claim record qualification, NOT production wired. */
import type { WorkerGrantIdentity } from './worker-grant-binding.js';

export type ClaimedWorkerRecord = Readonly<{
  runId: string;
  workerId: string;
  attempt: number;
  status: string;
  executionOwnerId?: string;
  planRevision: number;
}>;

/** A scheduler-controlled caller must supply a freshly loaded post-claim record.
 * This does not authenticate its source or establish model-routing authority.
 */
export function assertClaimedWorkerRecord(
  record: ClaimedWorkerRecord | null | undefined,
  identity: WorkerGrantIdentity,
  expectedOwnerId: string,
  expectedPlanRevision: number,
): void {
  if (!record || !identity ||
      typeof record.runId !== 'string' || !record.runId.trim() ||
      typeof record.workerId !== 'string' || !record.workerId.trim() ||
      record.runId !== identity.coordinationRunId || record.workerId !== identity.workerId ||
      !Number.isSafeInteger(record.attempt) || record.attempt < 1 ||
      record.attempt !== identity.attempt || record.status !== 'running' ||
      typeof expectedOwnerId !== 'string' || !expectedOwnerId.trim() ||
      record.executionOwnerId !== expectedOwnerId ||
      !Number.isSafeInteger(expectedPlanRevision) || expectedPlanRevision < 0 ||
      !Number.isSafeInteger(record.planRevision) || record.planRevision !== expectedPlanRevision) {
    throw new Error('Worker post-claim record mismatch');
  }
}
