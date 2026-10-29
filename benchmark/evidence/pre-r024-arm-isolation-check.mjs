#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
function value(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const armId = value('--arm-id');
const replayClass = value('--replay-class');
const output = value('--output');
const allowedReplay = new Set(['table-replay', 'arithmetic-replay', 'scenario-reproduction']);
if (!armId) {
  console.error('missing --arm-id');
  process.exit(2);
}
if (!allowedReplay.has(replayClass)) {
  console.error('invalid --replay-class; expected table-replay|arithmetic-replay|scenario-reproduction');
  process.exit(2);
}

function run(command, argv) {
  const started = Date.now();
  const res = spawnSync(command, argv, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    command: [command, ...argv].join(' '),
    exitCode: res.status,
    durationMs: Date.now() - started,
    stdout: res.stdout,
    stderr: res.stderr,
    passed: res.status === 0,
  };
}

const head = run('git', ['rev-parse', 'HEAD']);
const tree = run('git', ['rev-parse', 'HEAD^{tree}']);
const status = run('git', ['status', '--porcelain', '--untracked-files=no']);
const build = run('pnpm', ['build']);
const nodeNegatives = build.passed ? run('node', [
  '--test', '--test-concurrency=1',
  'dist/tests/security/legacy-approval-single-use.test.js',
  'dist/tests/security/approval-crash-recovery.test.js',
  'dist/tests/architecture/r15-authorization.test.js',
]) : { command: 'skipped: build failed', exitCode: null, durationMs: 0, stdout: '', stderr: '', passed: false };
const workerPort = build.passed ? run('pnpm', [
  'exec', 'vitest', 'run', 'tests/security/worker-approval-port.vitest.ts', '--reporter=dot',
]) : { command: 'skipped: build failed', exitCode: null, durationMs: 0, stdout: '', stderr: '', passed: false };

const record = {
  schemaVersion: 1,
  kind: 'pre-r024-arm-isolation-check',
  recordedAt: new Date().toISOString(),
  armId,
  replayClass,
  source: {
    commit: head.stdout?.trim() || null,
    tree: tree.stdout?.trim() || null,
    trackedDirty: Boolean(status.stdout?.trim()),
  },
  checks: { build, nodeNegatives, workerPort },
  passed: build.passed && nodeNegatives.passed && workerPort.passed,
  note: 'This proves the mandatory S0 negative set ran for this arm. It does not qualify OS-level shell/filesystem isolation or rubric unreachability.',
};
const text = JSON.stringify(record, null, 2) + '\n';
if (output) writeFileSync(output, text);
process.stdout.write(text);
process.exit(record.passed ? 0 : 1);
