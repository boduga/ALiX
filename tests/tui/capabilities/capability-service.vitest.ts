// tests/tui/capabilities/capability-service.vitest.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CapabilityService, setCapabilityService, getCapabilityService, clearCapabilityService,
} from '../../../src/tui/capabilities/capability-service.js';
import type { InvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';

class FakeEventLog {
  events: Array<Record<string, unknown>> = [];
  async append(e: Record<string, unknown>) { this.events.push(e); return e as never; }
}

describe('CapabilityService', () => {
  let presenter: InvocationPresenter;
  let log: FakeEventLog;

  beforeEach(() => { presenter = { present: vi.fn(async () => {}) }; log = new FakeEventLog(); clearCapabilityService(); });
  afterEach(() => clearCapabilityService());

  it('wireInitialCapabilities registers core + registry-derived tool definitions', async () => {
    const svc = new CapabilityService(presenter, { eventLog: log as never });
    await svc.ready();
    expect(svc.find('core.session.list')).toBeDefined();
    expect(svc.query({ kinds: ['core'] }).length).toBeGreaterThanOrEqual(1);
    // Tool capabilities now come from the canonical registry projection
    // (15 concrete tools; the mcp.* wildcard is excluded).
    expect(svc.find('tool.file.read')).toBeDefined();
    expect(svc.find('tool.shell.run')).toBeDefined();
    expect(svc.find('tool.file.create')).toBeDefined();
    expect(svc.query({ kinds: ['tool'] }).length).toBeGreaterThanOrEqual(15);
  });

  it('invoke() presents automatically', async () => {
    const svc = new CapabilityService(presenter, { eventLog: log as never });
    await svc.ready();
    const inv = svc.invoke('core.session.list', {});
    expect(inv).toBeDefined();
    expect(presenter.present).toHaveBeenCalledTimes(1);
    await inv.wait();
  });

  it('bridges capability events into the EventLog', async () => {
    const svc = new CapabilityService(presenter, { eventLog: log as never });
    await svc.ready();
    await svc.invoke('core.session.list', {}).wait();
    expect(log.events.length).toBeGreaterThan(0);
    expect(log.events[0]!.type).toMatch(/^capability\./);
  });

  it('getCapabilityService returns the shared instance after setCapabilityService', () => {
    const svc = new CapabilityService(presenter);
    setCapabilityService(svc);
    expect(getCapabilityService()).toBe(svc);
  });
});
