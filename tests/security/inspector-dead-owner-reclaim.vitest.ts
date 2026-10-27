/** LEAN-G01 isolated durable dead-owner reclaim; no scheduler or external tools. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { reclaimDeadOwnerWorkers } from '../../src/coordination/kernel/coordination-resume.js';
import { OwnershipRegistry } from '../../src/coordination/ownership/ownership-registry.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

describe('LEAN-G01 persisted Inspector dead-owner reclaim', () => {
  it('reclaims provably dead worker to pending without incrementing attempt, then remains idempotent', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-reclaim-'));
    try {
      const store = new CoordinationStore(cwd);
      const run = createCoordinationRun({ sessionId: 'reclaim', rootGoal: 'no effects', coordinatorAgentId: 'parent' });
      run.hostKind = 'inspector'; run.status = 'running';
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'w', taskLabel: 'reclaim', goalPrompt: 'no effects', requiredCapabilities: [], status: 'running', attempt: 1, maxAttempts: 3, executionOwnerId: 'web-99999999', lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString() });
      await store.addWorker(run.id, worker);
      const freshStore = new CoordinationStore(cwd);
      const registry = new OwnershipRegistry(cwd);
      const first = await reclaimDeadOwnerWorkers(freshStore, run.id, registry);
      expect(first.reclaimedWorkerIds).toEqual([worker.id]);
      const recovered = (await freshStore.load(run.id))!.workers[0]!;
      expect(recovered.status).toBe('pending');
      expect(recovered.attempt).toBe(1);
      expect(recovered.executionOwnerId).toBeUndefined();
      const second = await reclaimDeadOwnerWorkers(freshStore, run.id, registry);
      expect(second.reclaimedWorkerIds).toEqual([]);
      expect((await freshStore.load(run.id))!.workers[0]!.attempt).toBe(1);
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });
});
