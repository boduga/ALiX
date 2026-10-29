import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { executeWithEffectReplayGuard } from '../../src/capabilities/tools/effect-replay-guard.js';
import { createToolExecutor } from '../../src/capabilities/tools/tool-executor-factory.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { hashArgs } from '../../src/capabilities/tools/hash-args.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';
import type { ToolCallRequest, ToolResult } from '../../src/capabilities/tools/types.js';

const call = (name = 'shell.run'): ToolCallRequest => ({ toolCallId: 'original', name, args: name === 'shell.run' ? { command: 'charge-account' } : { account: 'a', amount: 10 } });
const unknown: ToolResult = { kind: 'error', message: 'unrelated text', outcomeUnknown: true, retryable: true };
const ok: ToolResult = { kind: 'success', output: 'done' };

// Explicit expected outcomes span safe/idempotent controls and all conservative
// failures; message content and adapter retry suggestions confer no authority.
for (const row of [
  { name: 'shell.run', args: { command: 'ls' }, outcome: unknown, allowed: true },
  { name: 'shell.run', args: { command: 'pwd' }, outcome: unknown, allowed: true },
  { name: 'shell.run', args: { command: "grep 'needle' input.txt" }, outcome: unknown, allowed: true },
  { name: 'shell.run', args: { command: "rg 'needle' input.txt" }, outcome: unknown, allowed: false },
  { name: 'shell.run', args: { command: "rg '--pre' sh script.txt" }, outcome: unknown, allowed: false },
  { name: 'shell.run', args: { command: 'rg --pre sh script.txt' }, outcome: unknown, allowed: false },
  { name: 'shell.run', args: { command: "rg '--pre=sh' script.txt" }, outcome: unknown, allowed: false },
  { name: 'shell.run', args: { command: 'git show --output effect.txt' }, outcome: unknown, allowed: false },
  { name: 'shell.run', args: { command: "rg 'needle' input.txt" }, outcome: ok, allowed: true },
  { name: 'file.create', args: { path: 'x', content: 'x' }, outcome: unknown, allowed: true },
  { name: 'patch.apply', args: {}, outcome: unknown, allowed: false },
  { name: 'shell.run', args: { command: 'charge-account' }, outcome: ok, allowed: true },
  { name: 'mcp.billing.charge', args: { amount: 10 }, outcome: ok, allowed: true },
  { name: 'shell.run', args: { command: 'charge-account' }, outcome: unknown, allowed: false },
  { name: 'mcp.billing.charge', args: { amount: 10 }, outcome: unknown, allowed: false },
  { name: 'shell.run', args: { command: 'charge-account' }, outcome: { kind: 'error', message: 'safe to retry', retryable: true } as ToolResult, allowed: false },
]) {
  it(`replay parity ${row.name} ${JSON.stringify(row.args)} ${row.outcome.kind} allowed=${row.allowed}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'alix-effect-parity-'));
    try {
      const request = { toolCallId: 'one', name: row.name, args: row.args };
      let effects = 0;
      await executeWithEffectReplayGuard(root, request, async () => { effects++; return row.outcome; });
      await executeWithEffectReplayGuard(root, { ...request, toolCallId: 'fresh', invocationId: 'new', agentId: 'other', sessionId: 'other' }, async () => { effects++; return ok; });
      assert.equal(effects, row.allowed ? 2 : 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

it('concurrent claims have one winner; throw and cancellation leave durable quarantine', async () => {
  for (const cancellation of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), 'alix-effect-race-'));
    try {
      let effects = 0;
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => executeWithEffectReplayGuard(root, { ...call(), toolCallId: String(i) }, async () => {
        effects++;
        if (cancellation) { const { ExecutionCancelledError } = await import('../../src/runtime-state/runtime/cancellation-token.js'); throw new ExecutionCancelledError('cancelled after effect'); }
        throw new Error('thrown after effect');
      })));
      assert.equal(effects, 1);
      assert.equal(results.filter(r => r.status === 'rejected').length, 1);
      const retry = await executeWithEffectReplayGuard(root, call(), async () => { effects++; return ok; });
      assert.equal(retry.kind, 'error');
      assert.equal(effects, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

it('SIGKILL after an effect blocks a fresh-process invocation, including transport knob changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alix-effect-kill-'));
  try {
    const moduleUrl = new URL('../../src/capabilities/tools/effect-replay-guard.js', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { executeWithEffectReplayGuard } from ${JSON.stringify(moduleUrl)};
      import { writeFileSync } from 'node:fs';
      const [root, request] = JSON.parse(process.argv[1]);
      await executeWithEffectReplayGuard(root, request, async () => {
        writeFileSync(root + '/effect', 'charged');
        process.kill(process.pid, 'SIGKILL');
        return { kind: 'success' };
      });
    `, JSON.stringify([root, call()])], { encoding: 'utf8' });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    assert.equal(await readFile(join(root, 'effect'), 'utf8'), 'charged');
    const retry = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { executeWithEffectReplayGuard } from ${JSON.stringify(moduleUrl)};
      import { writeFileSync } from 'node:fs';
      const [root, request] = JSON.parse(process.argv[1]);
      writeFileSync(root + '/retry-result.json', JSON.stringify(await executeWithEffectReplayGuard(root, request, async () => { throw new Error('REPLAYED'); })));
    `, JSON.stringify([root, { ...call(), toolCallId: 'fresh', args: { ...call().args, timeoutMs: 1, persistent: true, cwd: '.' } }])], { encoding: 'utf8' });
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(JSON.parse(await readFile(join(root, 'retry-result.json'), 'utf8')).retryable, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('unavailable durable state fails closed without executing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alix-effect-unavailable-'));
  try {
    await writeFile(join(root, '.alix'), 'not a directory');
    let effects = 0;
    const result = await executeWithEffectReplayGuard(root, call(), async () => { effects++; return ok; });
    assert.equal(result.kind, 'error');
    assert.equal(effects, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('SIGKILL after durable claim but before effect does not permit automatic reclaim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alix-effect-before-kill-'));
  try {
    const moduleUrl = new URL('../../src/capabilities/tools/effect-replay-guard.js', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { executeWithEffectReplayGuard } from ${JSON.stringify(moduleUrl)};
      const [root, request] = JSON.parse(process.argv[1]);
      await executeWithEffectReplayGuard(root, request, async () => {
        process.kill(process.pid, 'SIGKILL');
        return { kind: 'success' };
      });
    `, JSON.stringify([root, call()])], { encoding: 'utf8' });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    let effects = 0;
    const retry = await executeWithEffectReplayGuard(root, { ...call(), toolCallId: 'new-after-crash' }, async () => { effects++; return ok; });
    assert.equal(retry.kind, 'error');
    assert.equal(effects, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const mode of ['auto', 'bypass', 'ask'] as const) {
  for (const resumed of [false, true]) {
    it(`real dispatch ${mode}, resumed=${resumed}: partial shell failure blocks fresh invocation and approval`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'alix-effect-dispatch-'));
      const log = new EventLog(join(root, '.alix', 'sessions', 'test'));
      try {
        await log.init();
        const store = new ApprovalStore(root);
        await store.load();
        const config = structuredClone(DEFAULT_CONFIG);
        config.permissions.sessionMode = mode;
        config.permissions.tools = { 'shell.run': mode === 'ask' ? 'ask' : 'allow' };
        const executor = createToolExecutor({ config, log, root, approvalStore: store });
        const request = { toolCallId: 'first', name: 'shell.run', args: { command: "printf 'charged\\n' >> effects.txt; exit 7" }, agentId: 'agent' };
        async function approvedRequest(id: string) {
          const invocation = { capability: 'shell.run', toolName: 'shell.run', workspace: root, argsHash: hashArgs(request.args), sessionId: 'test', agentId: 'agent' };
          const record = await store.request({ requestId: id, capability: 'shell.run', toolId: 'shell.run', reason: 'test', invocation });
          await store.resolve(record.id, 'approved');
          return record.id;
        }
        let approvalId: string | undefined;
        if (resumed) approvalId = await approvedRequest('initial-resume');
        else if (mode === 'ask') {
          const pending = await executor.execute(request);
          assert.equal(pending.kind, 'denied');
          approvalId = 'approvalId' in pending ? pending.approvalId : undefined;
          assert.ok(approvalId);
          await store.resolve(approvalId, 'approved');
        }
        const result = await executor.execute({ ...request, ...(resumed ? { source: 'continuation-resume', approvalId } : {}) });
        assert.equal(result.kind, 'error');
        assert.ok('outcomeUnknown' in result && result.outcomeUnknown);
        if (approvalId) assert.equal((await store.loadFresh(approvalId))?.executionOutcome, 'pending');
        // A completely new durable approval cannot authorize replay either.
        const freshApproval = await approvedRequest('new-resume');
        const fresh = await executor.execute({ ...request, toolCallId: 'fresh', source: 'continuation-resume', approvalId: freshApproval });
        assert.equal(fresh.kind, 'error');
        assert.equal(await readFile(join(root, 'effects.txt'), 'utf8'), 'charged\n');
        assert.equal((await readdir(join(root, '.alix', 'effect-replay', 'v1'))).length, 1);
      } finally { await log.close(); closeAllSharedLedgers(); await rm(root, { recursive: true, force: true }); }
    });
  }
}
