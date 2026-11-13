/** Regression: the old same-UID cooperative observer must no longer launch workers. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SubagentManager} from '../../src/agents/subagent-manager.js';
test('old cooperative lifecycle observer and process override cannot authorize a worker', async () => {
  let observed = false;
  const manager = new SubagentManager({sessionId: 'ge04',
    spawnOverride: {command: process.execPath, args: ['-e', 'process.exit(0)']},
    supervisorWorkerLifecycle: {onSpawned: async () => {observed = true;}, onExited: () => {observed = true;}}});
  await assert.rejects(manager.spawn({id: 'worker', role: 'explorer', mode: 'read_only', prompt: 'test',
    coordinationRunId: 'run', coordinationWorkerAttempt: 1}), /SECURITY HOLD/);
  assert.equal(observed, false);
});
