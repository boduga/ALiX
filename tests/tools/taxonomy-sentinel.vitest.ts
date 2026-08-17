// Architectural sentinels pinning the post-unification tool/capability
// taxonomy. The taxonomy unification collapsed all parallel tool/capability
// surfaces into a single canonical source: `src/tools/tool-registry.ts`.
//
// Sentinels C (16 entries), D (INV-4 mapping), E (file corrections) and F
// (health count) are already locked by dedicated suites:
//   - tests/tools/tool-contract.vitest.ts
//   - tests/tools/canonical-legacy-mapping.vitest.ts
//   - tests/baseline/providers/tools-health-provider.vitest.ts
//
// This file covers the UNIQUE structural sentinels:
//   A — the canonical source exists and still exports the registry + derived helpers;
//   B — the dead policy-side CapabilityRegistry stays deleted (policy is NOT a taxonomy authority);
//   G — capability→tool views are DERIVED, not an independently-maintained reverse map.

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDefaultToolIndex, getToolsForCapability, getCapabilitiesForTool } from '../../src/tools/tool-registry.js';

const REPO_SRC = fileURLToPath(new URL('../../src/', import.meta.url));

describe('taxonomy unification architecture sentinels', () => {
  it('Sentinel A: src/tools/tool-registry.ts is the canonical source', () => {
    // The module must export the canonical registry builder and the derived
    // capability helpers. If this fails, the canonical source was moved/renamed.
    expect(typeof buildDefaultToolIndex).toBe('function');
    expect(typeof getToolsForCapability).toBe('function');
    expect(typeof getCapabilitiesForTool).toBe('function');
  });

  it('Sentinel B: the dead policy CapabilityRegistry stays deleted (policy is not a taxonomy authority)', () => {
    // The policy-side CapabilityRegistry was deleted by the unification. If it
    // reappears, policy has become a second taxonomy authority.
    expect(existsSync(join(REPO_SRC, 'policy', 'capability-registry.ts'))).toBe(false);
  });

  it('Sentinel G: capability→tool views are derived (no independent reverse map)', () => {
    // getToolsForCapability must be a pure function of the canonical registry.
    // If a maintainer hand-writes a reverse map, this exact-match check fails.
    const { registry } = buildDefaultToolIndex();
    const derived = new Map<string, string[]>();
    for (const t of registry.getAll()) {
      const arr = derived.get(t.capabilityId) ?? [];
      arr.push(t.name);
      derived.set(t.capabilityId, arr);
    }
    for (const [cap, names] of derived) {
      expect([...getToolsForCapability(cap)].sort(), cap).toEqual([...names].sort());
    }
  });
});
