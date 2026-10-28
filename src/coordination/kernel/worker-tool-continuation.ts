import type { AlixEvent } from '../../runtime-state/events/types.js';
import type { ToolExecutor } from '../../capabilities/tools/tool-executor-factory.js';
import type { WorkerAssignment } from './coordination-types.js';
import { computeOwnershipClaimsHash } from '../../governance/approvals/approval-binding.js';

/** Bind only a continuation observed through this worker invocation's event log.
 * Request metadata and shared-session searches cannot establish worker identity.
 */
export async function bindWorkerToolContinuation(
  sessionId: string, worker: WorkerAssignment, events: readonly AlixEvent[], getExecutor: () => ToolExecutor,
): Promise<string | undefined> {
  const calls = new Set<unknown>();
  for (const event of events) {
    if (event.type !== 'tool.failed' || !event.payload || typeof event.payload !== 'object') continue;
    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.error === 'string' && payload.error.startsWith('Approval required: ')) calls.add(payload.toolCallId);
  }
  if (!calls.size) return undefined;
  const executor = getExecutor();
  const continuations = (await executor.pendingContinuations()).filter(c => c.sessionId === sessionId &&
    c.kind === 'tool' && c.toolCall && calls.has(c.toolCall.toolCallId));
  // Multiple paused operations require explicit orchestration, never guess.
  if (continuations.length !== 1) return undefined;
  const cont = continuations[0];
  const bound = await executor.bindContinuationWorker(cont.approvalId, {
    runId: worker.coordinationRunId, workerId: worker.id, attempt: worker.attempt,
    assignedAgentId: worker.agentId,
    ownershipHash: computeOwnershipClaimsHash(worker.ownershipClaims),
    ownershipScopes: [...worker.ownershipScopes],
  });
  return bound ? cont.approvalId : undefined;
}
