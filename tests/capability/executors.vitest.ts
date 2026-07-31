import { describe, it, expect } from 'vitest';
import { ExecutorRegistry, NativeExecutor } from '../../src/capability/executors.js';
import type { Capability, CapabilityContext } from '../../src/capability/types.js';

function cap(strategy: string): Capability {
  return {
    id: 'core.echo', version: '1.0', kind: 'core', title: 'Echo', description: 'echo',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    execution: { strategy },
  };
}

function ctx(): CapabilityContext {
  return {
    invocationId: 'inv-1', requestId: 'req-1', actor: 'operator',
    permissions: ['operator'], cwd: '/', workspace: '/', sessionId: 's1',
    cancellationToken: new AbortController().signal, eventBus: { emit: () => {} },
  };
}

describe('ExecutorRegistry', () => {
  it('registers and retrieves executors by strategy', () => {
    const er = new ExecutorRegistry();
    er.register('native', new NativeExecutor());
    expect(er.get('native')).toBeInstanceOf(NativeExecutor);
    expect(er.get('missing')).toBeUndefined();
  });
});

describe('NativeExecutor', () => {
  it('runs a registered handler and returns its output', async () => {
    const native = new NativeExecutor();
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    const out = await native.run(cap('native'), ctx(), { msg: 'hi' });
    expect(out.output).toEqual({ msg: 'hi' });
  });

  it('returns an error for an unregistered handler', async () => {
    const out = await new NativeExecutor().run(cap('native'), ctx(), {});
    expect(out.error).toMatch(/No handler/);
  });
});
