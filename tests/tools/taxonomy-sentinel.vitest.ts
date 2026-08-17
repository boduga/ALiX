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
import { BASE_TOOLS, READ_ONLY_TOOL_NAMES } from '../../src/run/helpers.js';

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
    expect(WRITE_TOOLS.has('alix_patch_preview')).toBe(true);
    expect(WRITE_TOOLS.has('alix_patch_apply')).toBe(true);
  });

  it('Sentinel J: the offered NLP surface (BASE_TOOLS) is the TOOL_NAME_MAP model-facing surface, minus explicit scope-out', () => {
    // The model-facing tool catalog handed to the NLP loop must be exactly the
    // TOOL_NAME_MAP keys (alix_* model names) minus the tools deliberately not
    // offered. No bare executor names (web_search, create_hook, file.read) may
    // leak into the offered surface, and no phantom name may be offered.
    //
    // Scope-out rationale:
    //   - alix_create_skill / alix_list_extensions / alix_inspect_extension:
    //     self-extend tools, deliberately NOT offered (nothing requires them).
    //   - mcp_search_tools: MCP tool-search sentinel, not an executable tool.
    //   - mcp.* tools are added at runtime by the agent loop, never statically.
    const offered = new Set(BASE_TOOLS.map((t) => t.name));
    const mapKeys = new Set(Object.keys(TOOL_NAME_MAP));
    const scopedOut = new Set([
      'alix_create_skill',
      'alix_list_extensions',
      'alix_inspect_extension',
      'mcp_search_tools',
    ]);

    // 1. Every offered name is a real TOOL_NAME_MAP key (model-facing, alix_*).
    for (const name of offered) {
      expect(mapKeys.has(name), `BASE_TOOLS offers non-map name: ${name}`).toBe(true);
    }

    // 2. Offered surface ≡ map keys minus scope-out (no phantom, no leak, no gap).
    const expectedOffered = [...mapKeys].filter((k) => !scopedOut.has(k)).sort();
    expect([...offered].sort()).toEqual(expectedOffered);

    // 3. Every offered name resolves through the map to a real registry tool.
    const { registry } = buildDefaultToolIndex();
    const registryNames = new Set(registry.getAll().map((t) => t.name));
    for (const name of offered) {
      const exec = TOOL_NAME_MAP[name];
      expect(exec, `${name} has no executor mapping`).toBeDefined();
      expect(registryNames.has(exec), `${name} -> ${exec} is not a registry tool`).toBe(true);
    }

    // 4. Read-only subset is drawn from the offered surface only.
    for (const name of READ_ONLY_TOOL_NAMES) {
      expect(offered.has(name), `READ_ONLY_TOOL_NAMES has non-offered name: ${name}`).toBe(true);
    }
  });
});
