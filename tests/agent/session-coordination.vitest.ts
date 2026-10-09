import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession } from '../../src/agents/agent/session/setup.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { MemoryStore } from '../../src/operations/utils/memory/store.js';
import { ScopeTracker } from '../../src/planning/autonomy/scope-tracker.js';
import { MinimalMetrics } from '../../src/coordination/kernel/minimal-metrics.js';
import { createContextBudget } from '../../src/operations/config/context-budget.js';
import { ensureEncoder } from '../../src/operations/utils/tokens.js';
import { ToolExecutor } from '../../src/capabilities/tools/executor.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { ExecutionCancelledError } from '../../src/runtime-state/runtime/cancellation-token.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';
import type { SessionState } from '../../src/agents/agent/session/state.js';
import type { ToolCallRequest, ToolResult } from '../../src/capabilities/tools/types.js';

const hooks = vi.hoisted(() => ({ seed: undefined as ((state: unknown) => void) | undefined }));
vi.mock('../../src/agents/agent/session/state.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/agents/agent/session/state.js')>();
  return { ...original, createSessionState: (config: Parameters<typeof original.createSessionState>[0]) => {
    const state = original.createSessionState(config); hooks.seed?.(state); return state;
  } };
});
const roots: string[] = [];
afterEach(() => { closeAllSharedLedgers(); hooks.seed = undefined; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture(options: { mode?: 'auto' | 'ask' | 'bypass'; deny?: boolean; readOnly?: boolean; offered?: boolean; handler?: (args: Record<string, unknown>, request?: ToolCallRequest) => Promise<ToolResult> } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'alix-coordination-port-')); roots.push(cwd);
  const sessionId = 'coordination-port'; const sessionDir = join(cwd, '.alix', 'sessions', sessionId); mkdirSync(sessionDir, { recursive: true });
  const log = new EventLog(sessionDir); await log.init();
  const memoryStore = new MemoryStore(join(cwd, 'memory')); await memoryStore.init();
  const config = structuredClone(DEFAULT_CONFIG);
  config.models = { default: { provider: 'mock', name: 'mock', streaming: false } } as any;
  config.permissions.sessionMode = options.mode ?? 'bypass';
  config.permissions.tools['coordination.run'] = options.deny ? 'deny' : options.mode === 'ask' ? 'ask' : 'allow';
  const calls: Array<{ args: Record<string, unknown>; request?: ToolCallRequest }> = [];
  const handler = async (args: Record<string, unknown>, request?: ToolCallRequest): Promise<ToolResult> => {
    calls.push({ args, request }); return options.handler ? options.handler(args, request) : { kind: 'success', output: 'Coordination run: missing-verification\nStatus: completed\nWorkers: 4', coordinationRunId: 'missing-verification' };
  };
  const approvals = new ApprovalStore(cwd, { eventLog: log }); await approvals.load();
  const executor = new ToolExecutor(config, log, cwd, undefined, undefined, { 'coordination.run': handler }, undefined, approvals);
  const complete = vi.fn(async () => ({ text: 'The coordination call returned; aggregate verification is unavailable.', toolCalls: [], finishReason: 'stop' as const }));
  await ensureEncoder('cl100k_base');
  let state!: SessionState;
  hooks.seed = value => {
    state = value as SessionState; state.initialized = true;
    state.ctx = { sessionId, sessionDir, log, config, provider: { id: 'mock', complete, capabilities: { supportsTools: true, supportsStreaming: false }, editFormatPreference: 'search_replace' }, toolExecutor: executor, memoryStore, scope: new ScopeTracker() } as any;
    state.session = { sessionId, actor: 'system' }; state.metrics = new MinimalMetrics();
    state.systemPrompt = 'Answer using actual execution evidence.';
    state.contextBudget = createContextBudget({ contextWindowTokens: 100000 }, { outputRatio: .1, outputFloor: 1000, outputCap: 16384 });
    state.cappedIterations = 3;
    state.providerTools = options.offered === false ? [] : [{ name: 'alix_coordination_run', description: 'Start a multi-worker coordination run', input_schema: { type: 'object', properties: { goal: { type: 'string' } } } }];
  };
  const session = createAgentSession({ cwd, task: '', sessionId, streaming: false, verbose: false, planMode: false, readOnly: options.readOnly });
  hooks.seed = undefined;
  return { session, state, calls, complete, log, approvals };
}

describe('typed AgentSession coordination port', () => {
  it('executes one exact governed kickoff before provider synthesis, retaining original objective and mode', async () => {
    const f = await fixture();
    expect(f.session.runCoordination).toBeTypeOf('function');
    f.session.setMode?.('auto');
    const result = await f.session.runCoordination!({ goal: 'Produce four independent reports', maxConcurrency: 4 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.args).toEqual({ goal: 'Produce four independent reports', maxConcurrency: 4, sessionMode: 'auto' });
    expect(f.calls[0]!.request).toMatchObject({ name: 'coordination.run' });
    expect(f.complete).toHaveBeenCalled();
    expect(result.reason).not.toBe('completed');
    expect(f.state.messages[0]?.content).toContain('Produce four independent reports');
    const events = await f.log.readAll();
    expect(events.some(event => event.type === 'tool.requested'
      && typeof event.payload === 'object' && event.payload !== null
      && 'toolName' in event.payload && event.payload.toolName === 'coordination.run')).toBe(true);
  });
  it.each([{ goal: '' }, { goal: 'reports', maxConcurrency: 0 }, { goal: 'reports', maxConcurrency: 9 }, { goal: 'reports', maxConcurrency: 1.5 }, { goal: 'reports', maxConcurrency: NaN }])('rejects invalid input before dispatch: %j', async request => {
    const f = await fixture(); await expect(f.session.runCoordination!(request)).rejects.toThrow(); expect(f.calls).toHaveLength(0); expect(f.complete).not.toHaveBeenCalled();
  });
  it.each([{ readOnly: true }, { offered: false }])('never executes when unavailable: %j', async options => {
    const f = await fixture(options); await expect(f.session.runCoordination!({ goal: 'Create reports' })).rejects.toThrow(/read.only|unavailable|offered/i); expect(f.calls).toHaveLength(0); expect(f.complete).not.toHaveBeenCalled();
  });
  it('rejects an executor alias offered in place of the exact model handle', async () => {
    const f = await fixture(); f.state.providerTools[0]!.name = 'coordination.run';
    await expect(f.session.runCoordination!({ goal: 'Create reports' })).rejects.toThrow(/offered/);
    expect(f.calls).toHaveLength(0); expect(f.complete).not.toHaveBeenCalled();
  });
  it('ignores forged permission and tool fields on operator input', async () => {
    const f = await fixture({ mode: 'auto' });
    await f.session.runCoordination!({ goal: 'Create reports', sessionMode: 'bypass', name: 'alix_shell_run', args: { command: 'unsafe' } } as any);
    expect(f.calls[0]!.args).toEqual({ goal: 'Create reports', sessionMode: 'auto' });
  });
  it('preserves explicit configured denial', async () => {
    const f = await fixture({ mode: 'auto', deny: true }); const result = await f.session.runCoordination!({ goal: 'Create reports' }); expect(f.calls).toHaveLength(0); expect(result.reason).not.toBe('completed');
  });
  it('retains ordinary research classification while executing an actually offered coordination tool', async () => {
    const f = await fixture();
    const result = await f.session.runCoordination!({ goal: 'Research TUI latency with four independent workers' });
    expect(f.calls).toHaveLength(1); expect(result.reason).not.toBe('completed');
    expect(f.state.config.readOnly).toBeUndefined();
  });
  it('awaits real approval before dispatching and preserves ask mode', async () => {
    const f = await fixture({ mode: 'ask' });
    const pending = f.session.runCoordination!({ goal: 'Create reports' });
    await vi.waitFor(() => {
      expect(f.approvals.listPending()).toHaveLength(1);
      expect(f.session.getActivity?.()?.state).toBe('awaiting_approval');
    });
    expect(f.calls).toHaveLength(0);
    expect(f.session.getActivity?.()?.state).toBe('awaiting_approval');
    await f.approvals.resolve(f.approvals.listPending()[0]!.id, 'approved', 'operator');
    await pending;
    expect(f.calls).toHaveLength(1); expect(f.calls[0]!.args.sessionMode).toBe('ask');
  });
  it('suppresses all concurrent session submission and releases ownership after cancellation', async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = await fixture({ handler: async (_args, request) => {
      entered();
      return new Promise((_resolve, reject) => request?.signal?.addEventListener('abort', () => reject(new ExecutionCancelledError('operator cancelled')), { once: true }));
    } });
    const pending = f.session.runCoordination!({ goal: 'Create reports' });
    const rejected = expect(pending).rejects.toThrow(/cancelled/i);
    await started;
    await expect(f.session.runCoordination!({ goal: 'Duplicate reports' })).rejects.toThrow(/busy/);
    await expect(f.session.processTurn('Other repository work')).rejects.toThrow(/busy/);
    await expect(f.session.processChat('Hello')).rejects.toThrow(/busy/);
    expect(f.session.cancelActiveTurn?.('operator cancelled')).toBe(true);
    await rejected;
    expect(f.calls).toHaveLength(1);
    expect(f.session.getLastCancelSummary?.()).toMatch(/Cancelled/);
    await f.session.processTurn('Summarize this repository');
    expect(f.calls).toHaveLength(1);
  });
});
