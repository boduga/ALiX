import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { CapabilityService } from '../../src/capability/capability-service.js';
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

  it('platform.service.list() queries the same catalog as registry.query() (parity invariant)', () => {
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    platform.registry.import([{
      id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
      tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
      dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    } as never]);
    const fromService = platform.service.list().items.map(i => i.id).sort();
    const fromRegistry = platform.registry.list().map(c => c.id).sort();
    expect(fromService).toEqual(fromRegistry);
  });
});
