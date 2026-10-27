/**
 * LEAN-G01 daemon adapter approval dependency.
 *
 * These began as characterization tests for the wiring gap (the adapter did not
 * forward the runtime context approval store). The gap is closed, so the
 * assertions now guard the repaired behaviour instead of describing the defect.
 * Still not approval SECURITY acceptance — the acceptance suites cover that; these
 * verify the adapter passes the store through and no real tool runs.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeToolBehavior: vi.fn(async () => 'blocked'),
  executeGroundedChatBehavior: vi.fn(async () => 'no retrieval'),
  loadConfig: vi.fn(async () => ({ permissions: { sessionMode: 'ask' } })),
}));
vi.mock('../../src/runtime-state/runtime/route-execution.js', () => ({
  executeToolBehavior: mocks.executeToolBehavior,
  executeGroundedChatBehavior: mocks.executeGroundedChatBehavior,
  executeChatBehavior: vi.fn(),
  executeDirectBehavior: vi.fn(),
}));
vi.mock('../../src/operations/config/loader.js', () => ({ loadConfig: mocks.loadConfig }));

import { DaemonRuntimeExecutor } from '../../src/operations/daemon/daemon-runtime-executor.js';

function fixture() {
  const frames: string[] = [];
  const approvalStore = { marker: 'sentinel-approval-store' };
  const ctx = { cwd: '/isolated/not-used', sessionId: 's', sessionDir: '/isolated/not-used/s', eventLog: {}, config: {}, approvalStore };
  const executor = new DaemonRuntimeExecutor({
    client: { destroyed: false, writable: true, write: (s: string) => { frames.push(s); } } as never,
    sessionId: 's', taskId: 't', cwd: ctx.cwd, eventLog: ctx.eventLog,
  });
  return { ctx, executor, frames, approvalStore };
}

describe('LEAN-G01 daemon adapter approval dependency (gap closed; guards regression)', () => {
  it('tool adapter forwards context approvalStore when delegating', async () => {
    const { ctx, executor, frames } = fixture();
    await executor.executeTool({ kind: 'tool', tool: 'file.create', args: { path: 'never-executed' } } as never, ctx);
    expect(mocks.executeToolBehavior).toHaveBeenCalledOnce();
    const deps = (mocks.executeToolBehavior.mock.calls as unknown[][])[0]![2];
    expect(deps).toHaveProperty('approvalStore', ctx.approvalStore);
    expect(frames).toHaveLength(2); // marker and mocked result; no real tool
  });
  it('grounded-chat adapter forwards context approvalStore', async () => {
    const { ctx, executor } = fixture();
    await executor.executeGroundedChat({ kind: 'grounded_chat', prompt: 'x', allowedTools: ['web.search'] } as never, ctx);
    expect(mocks.executeGroundedChatBehavior).toHaveBeenCalledOnce();
    expect((mocks.executeGroundedChatBehavior.mock.calls as unknown[][])[0]![2]).toHaveProperty('approvalStore', ctx.approvalStore);
  });
});
