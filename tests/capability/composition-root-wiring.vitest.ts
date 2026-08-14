import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { EventLog } from '../../src/events/event-log.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-cr-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-cr-sess-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

describe('Composition root wiring (locked ruling #6 — no singleton, no hidden globals)', () => {
  it('CapabilityPlatform exposes a constructed CapabilityService', () => {
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    expect(platform.service).toBeInstanceOf(CapabilityService);
  });

  it('two separate platforms produce independent services (no singleton)', () => {
    const eventLog = new EventLog(sessionDir);
    const p1 = new CapabilityPlatform({ catalogDir: dir, eventLog });
    const p2 = new CapabilityPlatform({ catalogDir: dir + '-2', eventLog: new EventLog(sessionDir + '-2') });
    expect(p1.service).not.toBe(p2.service);
  });

  it('platform.service.list() reflects the catalog it was composed with (parity invariant)', () => {
    // R10 — composition correctness uses test-owned catalog; service is sole public read.
    const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    const platform = new CapabilityPlatform({ catalog, eventLog: new EventLog(sessionDir) });
    catalog.register({
      id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
      tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
      dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    });
    const fromService = platform.service.list().items.map(i => i.id).sort();
    const fromCatalog = catalog.list().map(c => c.id).sort();
    expect(fromService).toEqual(fromCatalog);
  });
});
