// tests/tui/capabilities/capability-service.vitest.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CapabilityService, setCapabilityService, getCapabilityService, clearCapabilityService,
} from '../../../src/interfaces/tui/capabilities/capability-service.js';
import type { InvocationPresenter } from '../../../src/interfaces/tui/capabilities/invocation-presenter.js';

class FakeEventLog {
  events: Array<Record<string, unknown>> = [];
  async append(e: Record<string, unknown>) { this.events.push(e); return e as never; }
}

describe('CapabilityService', () => {
  let presenter: InvocationPresenter;
  let log: FakeEventLog;

  // MUST be a temp dir, never the platform's `process.cwd()` default. This
  // test seeds registry-derived `tool.*` definitions, which is exactly what
  // wrote rows into the repository's real `.alix/capabilities` store — those
  // rows outlive the run and resurface as phantom parity mismatches in
  // unrelated tests.
  let tmpCatalogDir: string;
  beforeEach(() => {
    presenter = { present: vi.fn(async () => {}) };
    log = new FakeEventLog();
    tmpCatalogDir = mkdtempSync(join(tmpdir(), 'cap-catalog-'));
    clearCapabilityService();
  });
  afterEach(() => clearCapabilityService());

  it('wireInitialCapabilities registers core + registry-derived tool definitions', async () => {
    const svc = new CapabilityService(presenter, { eventLog: log as never, catalogDir: tmpCatalogDir });
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
    const svc = new CapabilityService(presenter, { eventLog: log as never, catalogDir: tmpCatalogDir });
    await svc.ready();
    const inv = svc.invoke('core.session.list', {});
    expect(inv).toBeDefined();
    expect(presenter.present).toHaveBeenCalledTimes(1);
    await inv.wait();
  });

  it('bridges capability events into the EventLog', async () => {
    const svc = new CapabilityService(presenter, { eventLog: log as never, catalogDir: tmpCatalogDir });
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
