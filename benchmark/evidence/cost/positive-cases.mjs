/** Positive deliverables; scripted runs validate fixtures, never qualify cost strata. */
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTask } from '../../../dist/src/run.js';
import { installEvalConfig, installSeed } from '../../../dist/src/operations/evals/evals-runner.js';
import { evaluateObjective } from '../../../dist/src/operations/evals/evaluators/objective-evaluator.js';
import { evaluateStatus } from '../../../dist/src/operations/evals/evaluators/status-evaluator.js';
import { captureEvalUsage } from '../../../dist/src/operations/evals/eval-usage.js';
import { userConfigDir } from '../../../dist/src/operations/config/loader.js';
import { hashArgs } from '../../../dist/src/capabilities/tools/hash-args.js';
import { ApprovalStore } from '../../../dist/src/governance/approvals/approval-store.js';
import { ScriptedMockProvider } from '../../../dist/src/operations/evals/providers/scripted-mock-provider.js';

const call = (name, args) => ({ name, args });
export const positiveCases = [
  {
    id: 'positive.multi-file-fix', stratum: 4,
    task: 'Fix BOTH files using file tools: src/timeout.txt must contain exactly "timeout=3000\\n" and src/retries.txt exactly "retries=3\\n". Read both, write both corrected files. No tests or verification commands needed. Report completion.',
    seed: { 'src/timeout.txt': 'timeout=500\n', 'src/retries.txt': 'retries=0\n' },
    objective: { kind: 'files', files: [
      { path: 'src/timeout.txt', contentEquals: 'timeout=3000\n' },
      { path: 'src/retries.txt', contentEquals: 'retries=3\n' },
    ] },
    steps: [call('alix_file_read', { path: 'src/timeout.txt' }), call('alix_file_read', { path: 'src/retries.txt' }),
      call('alix_file_create', { path: 'src/timeout.txt', content: 'timeout=3000\n' }),
      call('alix_file_create', { path: 'src/retries.txt', content: 'retries=3\n' })],
  },
  {
    id: 'positive.mixed-policy', stratum: 7,
    task: 'Perform these steps in order: use alix_file_read to read seed.txt; attempt alix_shell_run with command "printf policy-probe" exactly once (shell is intentionally denied; this denial is expected). Then use alix_file_create to create result.txt with exactly "seed=green\\npolicy=deny\\n". File writes require approval; harness operator approves only this fixture write. Deliver result.txt despite expected shell denial. No tests or verification commands needed. Report completion and expected shell denial honestly.',
    seed: { 'seed.txt': 'seed=green\n' },
    objective: { kind: 'file', path: 'result.txt', exists: true, contentEquals: 'seed=green\npolicy=deny\n' },
    steps: [call('alix_file_read', { path: 'seed.txt' }), call('alix_shell_run', { command: 'printf policy-probe' }),
      call('alix_file_create', { path: 'result.txt', content: 'seed=green\npolicy=deny\n' })],
  },
];

export function mixedPolicyEvidence(events, approvals) {
  const expected = {
    'file.read': hashArgs({ path: 'seed.txt' }),
    'shell.run': hashArgs({ command: 'printf policy-probe' }),
    'file.create': hashArgs({ path: 'result.txt', content: 'seed=green\npolicy=deny\n' }),
  };
  const matching = (event, type, tool) => event.type === type && event.payload?.toolName === tool
    && event.payload.argumentHash === expected[tool];
  const readIndex = events.findIndex(e => matching(e, 'tool.completed', 'file.read') && e.payload.status === 'success');
  const shellRequests = events.filter(e => e.type === 'tool.requested' && e.payload?.toolName === 'shell.run');
  const shellIndex = events.findIndex(e => matching(e, 'tool.failed', 'shell.run')
    && /denied|deny|blocked|not permitted/i.test(e.payload.error ?? '')
    && shellRequests.length === 1 && shellRequests[0].payload.toolCallId === e.payload.toolCallId);
  const writeIndex = events.findIndex(e => matching(e, 'tool.completed', 'file.create') && e.payload.status === 'success');
  const completedWrite = events[writeIndex];
  const startedWrite = events.some((e, index) => matching(e, 'tool.started', 'file.create')
    && e.payload.toolCallId === completedWrite?.payload.toolCallId && index > shellIndex && index < writeIndex);
  const approvedWrite = approvals.some(a => a.status === 'consumed' && a.executionOutcome === 'succeeded'
    && a.invocation?.toolName === 'file.create' && a.invocation.argsHash === expected['file.create']
    && a.invocation.sessionId === completedWrite?.sessionId
    && a.requestId === completedWrite?.payload.toolCallId);
  const shellRequestIndex = events.indexOf(shellRequests[0]);
  const writeRequestIndex = events.findIndex(e => matching(e, 'tool.requested', 'file.create')
    && e.payload.toolCallId === completedWrite?.payload.toolCallId);
  const ordered = readIndex >= 0 && shellRequestIndex > readIndex && shellIndex > shellRequestIndex
    && writeRequestIndex > shellIndex && writeIndex > writeRequestIndex;
  return { read: readIndex >= 0, deniedShell: shellIndex >= 0, write: writeIndex >= 0,
    approvedWrite, startedWrite, ordered, singleShellProbe: shellRequests.length === 1,
    satisfied: ordered && startedWrite && approvedWrite && shellRequests.length === 1 };
}

export function evaluatePositiveCase(cwd, fixture, execution, events = [], approvals = []) {
  const objective = evaluateObjective(cwd, fixture.objective);
  const status = evaluateStatus(objective.landed, execution?.reason, ['completed']);
  const policy = fixture.stratum === 7 ? mixedPolicyEvidence(events, approvals) : undefined;
  return { objective, status, ...(policy ? { policy } : {}), verdict: objective.landed && status.honest && (!policy || policy.satisfied) ? 'pass' : 'fail' };
}

function sessionEvents(cwd) {
  const root = join(cwd, '.alix', 'sessions');
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap(name => {
    const file = join(root, name, 'events.jsonl');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  });
}

// Prototype fixture only: stock scripted provider cannot emit read/shell calls.
// Restore before returning. Sequential execution is mandatory.
let running = false;
export async function runPositiveCase(fixture, { scripted = false, model } = {}) {
  if (running) throw new Error('Positive fixture runner requires sequential execution');
  running = true;
  const cwd = mkdtempSync(join(tmpdir(), 'alix-positive-'));
  const previousHome = process.env.HOME;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const isolatedHome = scripted ? mkdtempSync(join(tmpdir(), 'alix-positive-home-')) : null;
  const originalComplete = ScriptedMockProvider.prototype.complete;
  let stopPolling = false;
  let poller;
  let execution;
  let error;
  try {
    if (isolatedHome) {
      const isolatedConfigDir = join(isolatedHome, '.config', 'alix');
      mkdirSync(isolatedConfigDir, { recursive: true });
      writeFileSync(join(isolatedConfigDir, 'config.json'), JSON.stringify({ apiKeys: {} }));
      process.env.HOME = isolatedHome;
      process.env.XDG_CONFIG_HOME = join(isolatedHome, '.config');
    }
    const userConfig = JSON.parse(readFileSync(join(userConfigDir(), 'config.json'), 'utf8'));
    const selected = scripted ? { provider: 'scripted-mock', name: 'mock' } : model ?? userConfig.models.default;
    installEvalConfig(cwd, selected.provider, selected.name);
    const configPath = join(cwd, '.alix', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.models.default = selected;
    // Inherit only selected provider credential; unrelated missing keys cannot block fixture.
    config.apiKeys = Object.fromEntries(Object.keys(userConfig.apiKeys ?? {}).filter(key => scripted || key !== selected.provider).map(key => [key, '']));
    if (fixture.stratum === 7) config.permissions.default = 'ask';
    if (fixture.stratum === 7) config.permissions.tools = { 'file.read': 'allow', 'file.write': 'ask', 'shell.run': 'deny' };
    writeFileSync(configPath, JSON.stringify(config));
    installSeed(cwd, fixture.seed);
    const store = new ApprovalStore(cwd);
    await store.load();
    if (scripted) {
      let cursor = 0;
      ScriptedMockProvider.prototype.complete = async function () {
        const step = fixture.steps[cursor++];
        return step ? { text: '', toolCalls: [{ id: `positive-${cursor}`, ...step }] }
          : { text: fixture.stratum === 7 ? 'Created result.txt. Shell probe was denied as expected.' : 'Corrected both files.', toolCalls: [] };
      };
    }
    poller = (async () => {
      while (!stopPolling) {
        await store.load();
        for (const approval of store.listPending()) {
          const invocation = approval.invocation;
          if (fixture.stratum === 7 && invocation?.toolName === 'file.create' && invocation?.workspace === cwd && invocation?.argsHash === hashArgs({ path: 'result.txt', content: 'seed=green\npolicy=deny\n' })) {
            await store.resolve(approval.id, 'approved', 'Harness fixture result.txt write only');
          }
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    })();
    try {
      execution = await runTask(cwd, fixture.task, { planMode: false, skipContext: true, streaming: false,
        disableSkillFactory: true, ...(fixture.stratum === 4 ? { ownedPaths: Object.keys(fixture.seed) } : {}), sessionMode: fixture.stratum === 7 ? 'ask' : 'bypass', approvalStore: store });
    } catch (err) { error = String(err); }
    stopPolling = true;
    await poller;
    await store.load();
    const events = sessionEvents(cwd);
    const approvals = store.list();
    const usage = captureEvalUsage(cwd);
    const evaluated = evaluatePositiveCase(cwd, fixture, execution, events, approvals);
    return { caseId: fixture.id, stratum: fixture.stratum, scripted, model: selected, execution, error,
      ...evaluated, usage, costUSD: null, events, approvals,
      verifiedSuccesses: !scripted && !error && evaluated.verdict === 'pass' ? 1 : 0 };
  } finally {
    stopPolling = true;
    if (poller) await poller;
    ScriptedMockProvider.prototype.complete = originalComplete;
    rmSync(cwd, { recursive: true, force: true });
    if (isolatedHome) {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      rmSync(isolatedHome, { recursive: true, force: true });
    }
    running = false;
  }
}

export async function runPositiveCases(options = {}) {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const fixture of positiveCases) results.push(await runPositiveCase(fixture, options));
  return { startedAt, finishedAt: new Date().toISOString(), scripted: options.scripted ?? false, results,
    verifiedSuccesses: results.reduce((n, r) => n + r.verifiedSuccesses, 0), costUSD: null };
}
