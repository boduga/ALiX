import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { positiveCases, evaluatePositiveCase, mixedPolicyEvidence, runPositiveCases } from './positive-cases.mjs';

test('single-file repair cannot satisfy two-file objective; absent mixed authority fails', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'positive-oracle-'));
  try {
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src/timeout.txt'), 'timeout=3000\n');
    writeFileSync(join(cwd, 'src/retries.txt'), 'retries=0\n');
    assert.equal(evaluatePositiveCase(cwd, positiveCases[0], { reason: 'completed' }).verdict, 'fail');
    writeFileSync(join(cwd, 'result.txt'), 'seed=green\npolicy=deny\n');
    const mixed = evaluatePositiveCase(cwd, positiveCases[1], { reason: 'completed' });
    assert.equal(mixed.objective.landed, true);
    assert.equal(mixed.status.honest, true);
    assert.equal(mixed.verdict, 'fail');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('scripted positive fixtures execute real loop and mixed policy, never promote billable success', async () => {
  const isolatedHome = mkdtempSync(join(tmpdir(), 'positive-home-'));
  const previousHome = process.env.HOME;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const configDir = join(isolatedHome, '.config', 'alix');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ apiKeys: {} }));
  process.env.HOME = isolatedHome;
  process.env.XDG_CONFIG_HOME = join(isolatedHome, '.config');
  try {
    const run = await runPositiveCases({ scripted: true });
    assert.equal(run.results.length, 2);
    assert.deepEqual(run.results.map(row => row.verdict), ['pass', 'pass']);
    assert.equal(run.verifiedSuccesses, 0);
    assert.equal(run.costUSD, null);
    const mixed = run.results[1];
    assert.equal(mixed.policy.satisfied, true);
    assert.equal(mixed.approvals.length, 1);
    assert.equal(mixed.approvals[0].status, 'consumed');
    assert.equal(mixed.approvals[0].executionOutcome, 'succeeded');
    const shellRequest = mixed.events.find(e => e.type === 'tool.requested' && e.payload?.toolName === 'shell.run');
    assert.equal(mixedPolicyEvidence([...mixed.events, shellRequest], mixed.approvals).satisfied, false);
    const reordered = [...mixed.events];
    const deniedIndex = reordered.findIndex(e => e.type === 'tool.failed' && e.payload?.toolName === 'shell.run');
    reordered.unshift(...reordered.splice(deniedIndex, 1));
    assert.equal(mixedPolicyEvidence(reordered, mixed.approvals).satisfied, false);
    const badApproval = structuredClone(mixed.approvals);
    badApproval[0].invocation.argsHash = 'wrong-path';
    assert.equal(mixedPolicyEvidence(mixed.events, badApproval).satisfied, false);
    const badRead = structuredClone(mixed.events);
    badRead.find(e => e.type === 'tool.completed' && e.payload?.toolName === 'file.read').payload.argumentHash = 'wrong-seed';
    assert.equal(mixedPolicyEvidence(badRead, mixed.approvals).satisfied, false);

  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    rmSync(isolatedHome, { recursive: true, force: true });
  }
});
