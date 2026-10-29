// Explicit offline probe: actual daemon + public CLI; no protected-state reads.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readRunSessionEvents } from '../../dist/src/coordination/kernel/coordination-view.js';
import { CoordinationStore } from '../../dist/src/coordination/kernel/coordination-store.js';
const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cli = join(repo, 'dist/src/cli.js');
const { DEFAULT_CONFIG } = await import(pathToFileURL(join(repo, 'dist/src/operations/config/defaults.js')).href);
const mode = process.argv[2] ?? 'corrected';
if (!['baseline', 'corrected', 'verified'].includes(mode)) throw new Error('Expected baseline, corrected or verified');
const root = await mkdtemp(join(tmpdir(), `alix-d9-review-${mode}-`));
const workspace = join(root, 'workspace'), fixtureHome = join(root, 'home');
await mkdir(workspace); await mkdir(join(fixtureHome, '.config/alix'), { recursive: true });
const worker = { steps: [
  { kind: 'tool', tool: 'file.create', args: { path: 'docs/d9-receipt.txt', content: 'D9-APPROVED' } },
  { kind: 'text', text: 'Done.' },
] };
const review = { steps: [{ kind: 'text', text: JSON.stringify({ satisfied: true, summary: 'The persisted receipt contains exactly D9-APPROVED.', gaps: [] }) }] };
const planner = { steps: [{ kind: 'text', text: JSON.stringify({ nodes: [{
  id: 'n1', title: 'Create isolated receipt', goal: 'Create docs/d9-receipt.txt containing D9-APPROVED',
  domain: 'docs', role: 'worker', requiredCapabilities: ['filesystem.write'], dependencies: [],
}] }) }] };
const config = structuredClone(DEFAULT_CONFIG);
config.models = { default: { provider: 'scripted-mock', name: 'scripted-mock-model' } };
config.subagents = { ...config.subagents, enabled: false };
config.permissions = { ...config.permissions, default: 'ask', sessionMode: 'ask', tools: { 'file.create': 'ask', 'file.read': 'allow' } };
config.context = { ...config.context, repoMap: false, rag: false };
await writeFile(join(fixtureHome, '.config/alix/config.json'), JSON.stringify(config));
await writeFile(join(root, 'global-scenario.json'), JSON.stringify(mode === 'baseline' ? worker : review));
await writeFile(join(root, 'worker-scenario.json'), JSON.stringify(worker));
const observationsPath = join(root, 'observations.jsonl');
const env = { ...process.env, HOME: fixtureHome, ALIX_EVAL_TRACE: '1', ALIX_EVAL_TRACE_FILE: join(root, 'scripted-trace.jsonl'),
  ALIX_D9_PROBE_REPO: repo, ALIX_D9_PROBE_OBSERVATIONS: observationsPath, ALIX_D9_GLOBAL_SCENARIO: join(root, 'global-scenario.json') };
const sourceHashes = {};
for (const path of ['src/governance/policy/policy-gate.ts', 'src/capabilities/tools/executor.ts', 'src/coordination/kernel/default-worker-review.ts', 'src/coordination/kernel/worker-executor.ts', 'src/operations/evals/providers/scripted-mock-carrier.ts']) {
  sourceHashes[path] = createHash('sha256').update(await readFile(join(repo, path))).digest('hex');
}
const captures = [];
async function runCli(args, extraEnv = {}) {
  const index = captures.length;
  const stdoutPath = join(root, `cli-${index}.stdout.log`), stderrPath = join(root, `cli-${index}.stderr.log`);
  const out = openSync(stdoutPath, 'w'), err = openSync(stderrPath, 'w');
  const child = spawn(process.execPath, [cli, ...args], { cwd: workspace, env: { ...env, ...extraEnv }, stdio: ['ignore', out, err] });
  const exit = await new Promise(resolve => {
    child.once('exit', code => resolve({ code }));
    child.once('error', error => resolve({ error: String(error) }));
  });
  closeSync(out); closeSync(err);
  const stdout = await readFile(stdoutPath, 'utf8'), stderr = await readFile(stderrPath, 'utf8');
  captures.push({ args, stdout, stderr, exit });
  if (exit.code !== 0) throw new Error(`CLI failed ${JSON.stringify(args)}: ${JSON.stringify(exit)} ${stderr}`);
  return stdout;
}
async function waitFor(read, predicate, label, budget = 90000) {
  const start = Date.now();
  while (Date.now() - start < budget) {
    if (daemon && (daemon.exitCode !== null || daemon.signalCode !== null)) throw new Error('Daemon exited before ' + label + ': ' + await readFile(join(root, 'daemon.stderr.log'), 'utf8'));
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error(`Fixture wait expired: ${label}`);
}
let daemon;
let daemonExit;
let daemonStdout = '', daemonStderr = '';
let daemonOut, daemonErr;
let runId;
const summary = { mode, root, workspace, sourceHashes, expected: mode === 'baseline' ? 'reviewer tools rejected' : 'worker completed once', passed: false };
console.log(JSON.stringify({ mode, root, phase: 'starting' }));
try {
  const planned = await runCli(['coordination', 'run', 'Create docs/d9-receipt.txt containing D9-APPROVED', '--daemon', '--session-mode=ask'], { ALIX_EVAL_SCENARIO: JSON.stringify(planner) });
  runId = planned.match(/coord_[a-f0-9-]{36}/)?.[0];
  assert.ok(runId, `No run ID in planner output: ${planned}`);
  summary.runId = runId;
  daemonOut = openSync(join(root, 'daemon.stdout.log'), 'w');
  daemonErr = openSync(join(root, 'daemon.stderr.log'), 'w');
  daemon = spawn(process.execPath, ['--import', fileURLToPath(new URL('./d9-review-observer.mjs', import.meta.url)), join(repo, 'dist/src/operations/daemon/daemon-server.js'), '--socket', join(root, 'daemon.sock'), '--cwd', workspace],
    { cwd: workspace, env: { ...env, ALIX_EVAL_SCENARIO: JSON.stringify(worker) }, stdio: ['ignore', daemonOut, daemonErr] });
  daemonExit = new Promise(resolve => { daemon.once('exit', (code, signal) => resolve({ code, signal })); daemon.once('error', error => resolve({ error: String(error) })); });
  daemon.on('error', error => { daemonStderr += String(error); });
  const approvals = () => runCli(['coordination', 'approvals', runId, '--json']).then(JSON.parse);
  const first = await waitFor(approvals, records => records.some(r => r.status === 'pending'), 'initial dispatch approval');
  const initial = first.filter(r => r.status === 'pending');
  assert.equal(initial.length, 1);
  await assert.rejects(readFile(join(workspace, 'docs/d9-receipt.txt')), 'file must not exist before dispatch approval');
  summary.initialApprovalId = initial[0].id;
  await runCli(['approvals', 'approve', initial[0].id, '--reason', 'Isolated D9 deterministic dispatch qualification']);
  const workers = () => runCli(['coordination', 'workers', runId, '--json']).then(JSON.parse);
  const result = await waitFor(workers, rows => mode === 'baseline'
    ? rows.some(w => w.status === 'blocked' && w.error?.includes('Reviewer requested tools'))
    : rows.length === 1 && rows[0].status === 'completed', 'worker result');
  summary.worker = result[0];
  assert.equal(await readFile(join(workspace, 'docs/d9-receipt.txt'), 'utf8'), 'D9-APPROVED');
  const decisions = (await readFile(observationsPath, 'utf8')).trim().split('\n').map(JSON.parse);
  const writes = decisions.filter(r => r.type === 'policy.tool' && r.request.toolName === 'file.create');
  assert.equal(writes.length, 1, 'one policy evaluation for file.create');
  assert.equal(writes[0].decision.decision, 'allow');
  assert.ok(writes[0].decision.matchedRuleId, 'a concrete authorization rule is required');
  summary.toolAuthorization = writes[0];
  const fileEvents = decisions.filter(r => r.type === 'event' && r.event.type === 'file.created');
  assert.equal(fileEvents.length, 1, 'one actual file mutation');
  summary.fileCreateCount = fileEvents.length;
  const finalApprovals = await approvals();
  assert.equal(finalApprovals.find(r => r.id === initial[0].id)?.status, 'consumed');
  if (mode === 'baseline') {
    assert.equal(result[0].outcome, 'failure');
    assert.equal(finalApprovals.filter(r => r.status === 'pending').length, 1);
  } else {
    assert.equal(result[0].attempt, 1);
    assert.equal(result[0].outcome, 'success');
    assert.equal(finalApprovals.length, 1, 'no second dispatch or tool-specific approval should be minted on this owned-scope path');
    // Allow another scheduler polling cycle to reveal an unintended retry.
    await new Promise(resolve => setTimeout(resolve, 3500));
    assert.equal((await approvals()).length, 1);
    assert.equal((await workers())[0].status, 'completed');
  }
  summary.approvals = finalApprovals;
  summary.status = await runCli(['coordination', 'status', runId]);
  summary.results = JSON.parse(await runCli(['coordination', 'results', runId, '--json']));
  if (mode === 'verified') {
    assert.ok(summary.status.includes('verification=verified'), 'normal CLI derivation must verify the run from durable evidence');
    // Finalization can run in a separate CLI process, outside the daemon's
    // injected observer. Inspect the same durable session log as the CLI.
    const run = await new CoordinationStore(workspace).load(runId);
    assert.ok(run?.sessionId, 'run must have a durable session identity');
    const events = await readRunSessionEvents(workspace, run.sessionId);
    const completion = events.filter(event => event.type === 'coordination.aggregate.completed' && event.payload?.runId === runId);
    assert.equal(completion.length, 1, 'one durable aggregate completion event');
    const event = completion[0];
    assert.equal(event.payload.runId, runId);
    assert.equal(event.payload.aggregateResultRef, summary.results.aggregateRef);
    assert.equal(event.payload.sourceFingerprint, summary.results.sourceFingerprint);
    summary.completionVerificationEvent = event;
  }
  summary.passed = true;
} catch (error) {
  summary.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (daemon && daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGTERM');
  if (daemonExit) summary.daemonExit = await daemonExit;
  if (daemonOut !== undefined) { closeSync(daemonOut); daemonStdout = await readFile(join(root, 'daemon.stdout.log'), 'utf8'); }
  if (daemonErr !== undefined) { closeSync(daemonErr); daemonStderr += await readFile(join(root, 'daemon.stderr.log'), 'utf8'); }
  if (daemonOut === undefined) await writeFile(join(root, 'daemon.stdout.log'), daemonStdout);
  await writeFile(join(root, 'daemon.stderr.log'), daemonStderr);
  await writeFile(join(root, 'cli-captures.json'), JSON.stringify(captures, null, 2));
  await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
