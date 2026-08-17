import { describe, it, expect } from 'vitest';
import { legacyCapabilityToCanonical } from '../../src/tools/capability-map.js';
import { buildDefaultToolIndex } from '../../src/tools/tool-registry.js';

describe('canonical ↔ legacy capability mapping (INV-4)', () => {
  it('legacyCapabilityToCanonical(entry.policyKey) === entry.capabilityId for every entry', () => {
    const { registry } = buildDefaultToolIndex();
    for (const t of registry.getAll()) {
      expect(legacyCapabilityToCanonical(t.policyKey), `${t.name}: legacy(${t.policyKey}) !== ${t.capabilityId}`).toBe(t.capabilityId);
    }
  });

  it('explicitly pins the file corrections (guard against restoring split identities)', () => {
    const byName = new Map(buildDefaultToolIndex().registry.getAll().map((t) => [t.name, t]));
    expect(byName.get('file.create')!.capabilityId).toBe('filesystem.write');
    expect(byName.get('file.delete')!.capabilityId).toBe('filesystem.write');
    expect(legacyCapabilityToCanonical(byName.get('file.create')!.policyKey)).toBe('filesystem.write');
    expect(legacyCapabilityToCanonical(byName.get('file.delete')!.policyKey)).toBe('filesystem.write');
  });

  it('legacyCapabilityToCanonical still canonicalizes non-tool policy keys', () => {
    expect(legacyCapabilityToCanonical('git.commit')).toBe('repo.write');
    expect(legacyCapabilityToCanonical('shell.readonly')).toBe('shell.exec');
  });
});
