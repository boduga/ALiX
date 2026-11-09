/** Actual production refusal: unlike historical-loop suites, the guard is real. */
import {describe, it, expect, vi, beforeEach} from 'vitest';
const calls = vi.hoisted(() => ({load: vi.fn(), run: vi.fn(), provider: vi.fn()}));
vi.mock('../../src/operations/config/loader.js', () => ({loadConfig: calls.load}));
vi.mock('../../src/run.js', () => ({runTask: calls.run, buildToolsForProvider: vi.fn()}));
vi.mock('../../src/models/providers/registry.js', () => ({createProvider: calls.provider}));
import {SubagentCLI} from '../../src/agents/subagent-cli.js';
import {DefaultWorkerExecutor} from '../../src/coordination/kernel/worker-executor.js';
beforeEach(() => vi.clearAllMocks());
describe('GE-04 real entry refusal before credential/model execution', () => {
  it('direct SubagentCLI rejects before argument/config/provider work', async () => {
    await expect(SubagentCLI.main(['--subagent', 'worker', '--credential-fd', '3', '--ge04-startup-fd', '4'])).rejects.toThrow(/SECURITY HOLD/);
    expect(calls.load).not.toHaveBeenCalled();
    expect(calls.run).not.toHaveBeenCalled();
    expect(calls.provider).not.toHaveBeenCalled();
  });
  it.each([false, true])('in-process default cannot bypass refusal with approval store present=%s', async withStore => {
    const store = withStore ? {get() {throw new Error('Approval store must not be accessed');}} as never : undefined;
    const result = await new DefaultWorkerExecutor(store).execute({} as never, {} as never, new AbortController().signal);
    expect(result.outcome).toBe('failure');
    expect(result.failureKind).toBe('authorization_denied');
    expect(result.error).toMatch(/SECURITY HOLD/);
    expect(calls.load).not.toHaveBeenCalled();
    expect(calls.run).not.toHaveBeenCalled();
    expect(calls.provider).not.toHaveBeenCalled();
  });
  it('already-aborted default stays cancelled without execution', async () => {
    const controller = new AbortController(); controller.abort();
    const result = await new DefaultWorkerExecutor().execute({} as never, {} as never, controller.signal);
    expect(result.failureKind).toBe('cancelled');
    expect(calls.run).not.toHaveBeenCalled();
  });
});
