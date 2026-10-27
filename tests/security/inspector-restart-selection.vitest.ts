/** LEAN-G01: persisted Inspector restart discovery only, no scheduler or tool execution. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { findResumableRuns } from '../../src/coordination/kernel/coordination-resume.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

describe('LEAN-G01 Inspector persisted restart candidate selection', () => {
  it('selects active inspector/cli runs across a fresh store instance, excludes daemon and terminal runs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-inspector-'));
    try {
      const writer = new CoordinationStore(cwd);
      const cases = [
        { hostKind: 'inspector', status: 'blocked', include: true },
        { hostKind: 'cli', status: 'running', include: true },
        { hostKind: 'inspector', status: 'planning', include: true },
        { hostKind: 'daemon', status: 'blocked', include: false },
        { hostKind: 'inspector', status: 'completed', include: false },
        { hostKind: 'inspector', status: 'cancelled', include: false },
        { hostKind: undefined, status: 'blocked', include: false },
      ] as const;
      const expected: string[] = [];
      for (const [i, item] of cases.entries()) {
        const run = createCoordinationRun({ sessionId: `restart-${i}`, rootGoal: 'no effects', coordinatorAgentId: 'parent' });
        run.status = item.status;
        run.hostKind = item.hostKind;
        await writer.save(run);
        if (item.include) expected.push(run.id);
      }
      const reader = new CoordinationStore(cwd);
      expect((await findResumableRuns(reader, ['inspector', 'cli'])).sort()).toEqual(expected.sort());
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });
  it('blocked pending worker is discoverable but selection does not dispatch or alter its state', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-pending-'));
    try {
      const writer = new CoordinationStore(cwd);
      const run = createCoordinationRun({ sessionId: 'pending', rootGoal: 'no effects', coordinatorAgentId: 'parent' });
      run.status = 'blocked';
      run.hostKind = 'inspector';
      await writer.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'w', taskLabel: 'pending', goalPrompt: 'do nothing', requiredCapabilities: [], status: 'pending' });
      await writer.addWorker(run.id, worker);
      const reader = new CoordinationStore(cwd);
      expect(await findResumableRuns(reader, ['inspector', 'cli'])).toContain(run.id);
      const after = await reader.load(run.id);
      expect(after?.workers[0]?.status).toBe('pending');
      expect(after?.status).toBe('blocked');
    } finally { closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });
});
