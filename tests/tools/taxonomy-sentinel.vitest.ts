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
import { TOOL_NAME_MAP } from '../../src/agents/tool-name-map.js';
import { WRITE_TOOLS } from '../../src/agents/tool-policy.js';
import { CORE_TOOL_NAMES } from '../../src/config/tool-scoping.js';
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

  it('Sentinel H: TOOL_NAME_MAP mirrors the canonical tool surface (no phantom/missing tools)', () => {
    const { registry } = buildDefaultToolIndex();
    const mapNames = new Set(Object.values(TOOL_NAME_MAP));
    const registryNames = new Set(registry.getAll().map((t) => t.name));
    // Every map value must be a real tool (or the MCP search sentinel / runtime-added mcp.*).
    for (const v of mapNames) {
      if (v === 'mcp_search_tools') continue;        // MCP tool-search sentinel
      if (v.startsWith('mcp.')) continue;            // runtime-added MCP tools
      expect(registryNames.has(v), `TOOL_NAME_MAP phantom: ${v}`).toBe(true);
    }
    // The registry tools that must be reachable by the model.
    for (const t of registry.getAll()) {
      if (t.name === 'mcp.*') continue;              // dynamic family, added at runtime
      expect([...mapNames].some((v) => v === t.name), `TOOL_NAME_MAP missing: ${t.name}`).toBe(true);
    }
  });

  it('Sentinel I: no phantom alix_file_write in NLP admission/policy lists', () => {
    // `file.write` is only a policy key for file.create/file.delete, NOT an
    // executable tool name — no `alix_file_write` alias exists. If it ever
    // reappears in the always-mandatory admission set (CORE_TOOL_NAMES) or the
    // write classification set (WRITE_TOOLS), it admits/classifies a tool that
    // fails at dispatch (CompositeToolRouter → "No router found").
    expect(CORE_TOOL_NAMES.has('alix_file_write')).toBe(false);
    expect(WRITE_TOOLS.has('alix_file_write')).toBe(false);
  });

  it('Sentinel I: real write tools stay classified', () => {
    // The retirement must not gut WRITE_TOOLS — these real, dispatchable
    // write tools must remain classified as write tools.
    expect(WRITE_TOOLS.has('alix_file_create')).toBe(true);
    expect(WRITE_TOOLS.has('alix_file_delete')).toBe(true);
    expect(WRITE_TOOLS.has('alix_file_exists')).toBe(true);
  });
});
