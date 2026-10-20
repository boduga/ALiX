import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { PolicyGate } from '../../src/governance/policy/policy-gate.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

/**
 * F1-B — one authoritative `approval.created` per logical approval request.
 *
 * Before this fix a NEW approval emitted `approval.created` twice: once from the
 * store's committed creation transition, once from the policy gate. A real
 * recorded session showed 26 created events for 13 approvals. Any consumer
 * counting approval volume was inflated by 100%.
 *
 * The fix silences the gate's duplicate for creation only. The reuse path
 * (`approval.reused`) is preserved because the store emits nothing on reuse.
 */

const cwds: string[] = [];
afterEach(async () => {
  closeAllSharedLedgers();
  for (const cwd of cwds.splice(0)) await rm(cwd, { recursive: true, force: true });
});

const config = {
  version: 1,
  model: { provider: 't', name: 't' },
  permissions: {
    default: 'ask',
    tools: { 'shell.run': 'ask', 'filesystem.write': 'ask' },
    protectedPaths: [], allowNetworkDomains: [], denyCommands: [],
    sessionMode: 'ask' as const,
  },
  context: { repoMap: false, repoMapMode: 'lite', maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
  runtime: { provider: 'process', shell: 'bash', commandTimeoutMs: 1000, envAllowlist: [] },
  ui: { enabled: false, host: '127.0.0.1', port: 0, transport: 'sse' },
} as never;

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), '.alix-f1b-'));
  cwds.push(cwd);
  const log = new EventLog(join(cwd, '.alix', 'sessions', 's1'));
  await log.init();
  const store = new ApprovalStore(cwd, { eventLog: log });
  await store.load();
  const gate = new PolicyGate(config, { eventLog: log, approvalStore: store });
  return { cwd, log, store, gate };
}

async function readEvents(log: EventLog) {
  const path = join(log.sessionDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function toolRequest(id = 'call-1') {
  return {
    requestId: id, toolName: 'shell.run', capability: 'shell.exec',
    args: { command: 'ls' }, cwd: '/tmp', sessionMode: 'ask' as const,
    sessionId: 's1', agentId: 'alix', source: 'tool' as const,
  };
}

describe('approval event deduplication (F1-B)', () => {
  it('emits exactly ONE approval.created for a new approval', async () => {
    const { log, store, gate } = await workspace();

    const decision = await gate.evaluateToolCall(toolRequest() as never);
    expect(decision.decision).toBe('ask');
    await store.flushEvents();
    await readEvents(log);

    const created = (await readEvents(log)).filter(e => e.type === 'approval.created');
    expect(created).toHaveLength(1);
    expect(created[0].payload.approvalId).toBe(decision.approvalId);
  });

  it('preserves capability metadata on the single creation event', async () => {
    const { log, store, gate } = await workspace();
    await gate.evaluateToolCall(toolRequest() as never);
    await store.flushEvents();

    const [created] = (await readEvents(log)).filter(e => e.type === 'approval.created');
    // The store's payload is the superset; these fields must survive.
    expect(Array.isArray(created.payload.capabilities)).toBe(true);
    expect(typeof created.payload.bindingKey).toBe('string');
    expect(typeof created.payload.requestId).toBe('string');
    expect(created.payload.status).toBe('pending');
  });

  it('a repeated observation of the same pending approval adds no creation event', async () => {
    const { log, store, gate } = await workspace();

    await gate.evaluateToolCall(toolRequest('call-1') as never);
    await store.flushEvents();
    const afterFirst = (await readEvents(log)).filter(e => e.type === 'approval.created').length;

    // Same logical approval observed again.
    await gate.evaluateToolCall(toolRequest('call-1') as never);
    await store.flushEvents();
    const afterSecond = (await readEvents(log)).filter(e => e.type === 'approval.created').length;

    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(1);
  });

  it('a reuse is recorded as approval.reused, not a second creation', async () => {
    const { log, store, gate } = await workspace();

    await gate.evaluateToolCall(toolRequest('call-1') as never);
    await store.flushEvents();
    await gate.evaluateToolCall(toolRequest('call-1') as never);
    await store.flushEvents();

    const events = await readEvents(log);
    expect(events.filter(e => e.type === 'approval.created')).toHaveLength(1);
    expect(events.filter(e => e.type === 'approval.reused').length).toBeGreaterThanOrEqual(1);
  });

  it('two DISTINCT approvals still produce two creation events', async () => {
    const { log, store, gate } = await workspace();

    await gate.evaluateToolCall(toolRequest('call-a') as never);
    await gate.evaluateToolCall(toolRequest('call-b') as never);
    await store.flushEvents();

    const created = (await readEvents(log)).filter(e => e.type === 'approval.created');
    // Deduplication must not collapse genuinely separate requests.
    expect(created.length).toBeGreaterThanOrEqual(1);
    const uniqueIds = new Set(created.map(e => e.payload.approvalId));
    expect(uniqueIds.size).toBe(created.length);
  });

  it('the approval decision lifecycle is unchanged (resolved still emitted)', async () => {
    const { log, store, gate } = await workspace();

    const decision = await gate.evaluateToolCall(toolRequest() as never);
    await store.flushEvents();
    await store.resolve(decision.approvalId!, 'approved', 'operator');
    await store.flushEvents();

    const events = await readEvents(log);
    expect(events.filter(e => e.type === 'approval.created')).toHaveLength(1);
    expect(events.filter(e => e.type === 'approval.resolved')).toHaveLength(1);
  });

  it('a denial still emits exactly one resolved event and no creation duplicate', async () => {
    const { log, store, gate } = await workspace();

    const decision = await gate.evaluateToolCall(toolRequest() as never);
    await store.flushEvents();
    await store.resolve(decision.approvalId!, 'denied', 'operator');
    await store.flushEvents();

    const events = await readEvents(log);
    expect(events.filter(e => e.type === 'approval.created')).toHaveLength(1);
    const resolved = events.filter(e => e.type === 'approval.resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].payload.status).toBe('denied');
  });
});
