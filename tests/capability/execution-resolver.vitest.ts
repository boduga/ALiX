import { describe, it, expect } from 'vitest';
import { ExecutionResolver } from '../../src/capability/execution-resolver.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityNotFoundError } from '../../src/capability/errors.js';
import type { Capability, CapabilityContext } from '../../src/capability/types.js';

function ctx(): CapabilityContext {
  return {
    invocationId: 'inv-1', requestId: 'req-1', actor: 'operator',
    permissions: ['operator'], cwd: '/', workspace: '/', sessionId: 's1',
    cancellationToken: new AbortController().signal,
    eventBus: { emit: () => {} },
  };
}

describe('ExecutionResolver', () => {
  it('resolves a native capability to a single-step native plan with capabilityId', () => {
    const reg = new CapabilityRegistry();
    reg.register({
      id: 'core.session.list', version: '1.0', kind: 'core', title: 'List', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'native', timeout: 5000, cancellable: true },
    });
    const plans = new ExecutionResolver(reg).resolve('core.session.list', ctx());
    expect(plans).toHaveLength(1);
    expect(plans[0]!.capabilityId).toBe('core.session.list');
    expect(plans[0]!.steps).toHaveLength(1);
    expect(plans[0]!.steps[0]!.executor).toBe('native');
    expect(plans[0]!.steps[0]!.timeout).toBe(5000);
  });

  it('applies the strategy default timeout when absent', () => {
    const reg = new CapabilityRegistry();
    reg.register({
      id: 'git.commit', version: '1.0', kind: 'core', title: 'Commit', description: 'x',
      tags: [], category: 'git', risk: 'high', requiredPermissions: ['developer'],
      execution: { strategy: 'cli' },
    });
    const plans = new ExecutionResolver(reg).resolve('git.commit', ctx());
    expect(plans[0]!.steps[0]!.timeout).toBe(30_000);
  });

  it('throws CapabilityNotFoundError for an unknown capability id', () => {
    const resolver = new ExecutionResolver(new CapabilityRegistry());
    expect(() => resolver.resolve('nope.missing', ctx())).toThrow(CapabilityNotFoundError);
  });
});
