// tests/capability/registry-capabilities-invariant.vitest.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityService } from '../../src/tui/capabilities/capability-service.js';
import type { InvocationPresenter } from '../../src/tui/capabilities/invocation-presenter.js';
import { buildDefaultToolIndex } from '../../src/tools/tool-registry.js';
import type { ToolCapability } from '../../src/tools/tool-registry.js';
import { toolCapabilityId } from '../../src/capability/registry-capabilities.js';
import type { Capability } from '../../src/capability/types.js';

/** Duck-typed EventLog — the TUI service only appends through it, and the
 *  platform requires an authoritative EventLog (locked ruling #12). Mirror of
 *  tests/tui/capabilities/capability-service.vitest.ts. */
class FakeEventLog {
  events: Array<Record<string, unknown>> = [];
  async append(e: Record<string, unknown>) { this.events.push(e); return e as never; }
}

const NOOP_PRESENTER: InvocationPresenter = { present: async () => {} };

/**
 * The durable palette↔registry cross-drift invariant (Task 7).
 *
 * Drives the REAL TUI palette (CapabilityService.query({ kinds: ["tool"] })),
 * not a hand-built copy, so it catches palette-vs-registry drift at the source:
 * any registry entry the projection silently drops, or any projected field the
 * canonical round-trip loses, fails here.
 */
describe('palette↔registry cross-drift invariant', () => {
  let realCwd: string;
  let toolCwd: string;

  beforeAll(() => {
    realCwd = process.cwd();
    toolCwd = mkdtempSync(join(tmpdir(), 'alix-cap-invariant-'));
    // CapabilityPlatform defaults its catalog store to <cwd>/.alix/capabilities
    // and register() is idempotent per definition id — a polluted repo store
    // would shadow the CURRENT registry (stale risk/fields persist). Chdir to a
    // fresh tmp dir so the palette is projected purely from current source.
    process.chdir(toolCwd);
  });

  afterAll(() => {
    process.chdir(realCwd);
    rmSync(toolCwd, { recursive: true, force: true });
  });

  /** REAL service — same construction as the TUI bootstrap tests. */
  async function realPaletteTools(): Promise<Capability[]> {
    const svc = new CapabilityService(NOOP_PRESENTER, { eventLog: new FakeEventLog() as never });
    await svc.ready();
    return svc.query({ kinds: ['tool'] });
  }

  /** Canonical registry, minus the mcp.* wildcard (not a concrete tool). */
  function concreteRegistryEntries(): ToolCapability[] {
    const { registry } = buildDefaultToolIndex();
    return registry.getAll().filter((t) => t.name !== 'mcp.*');
  }

  it('every palette tool capability originates from the registry with risk/capabilityId/mutates/surface intact', async () => {
    const palette = await realPaletteTools();
    const { registry } = buildDefaultToolIndex();

    expect(palette.length).toBe(15);

    for (const cap of palette) {
      const toolName = cap.extensions?.toolName;
      expect(typeof toolName, `palette cap ${cap.id} carries extensions.toolName`).toBe('string');

      const entry = registry.lookup(toolName as string);
      expect(entry, `registry has an entry for palette tool "${toolName}" (from ${cap.id})`).toBeDefined();
      if (!entry) continue;

      expect(cap.risk, `${toolName}: risk`).toBe(entry.risk);
      expect(cap.extensions?.capabilityId, `${toolName}: extensions.capabilityId`).toBe(entry.capabilityId);
      expect(cap.extensions?.mutates, `${toolName}: extensions.mutates`).toBe(entry.mutates);
      expect(cap.extensions?.alwaysInclude, `${toolName}: extensions.alwaysInclude`).toBe(entry.alwaysInclude);
      expect(cap.extensions?.surface, `${toolName}: extensions.surface`).toBe(entry.alwaysInclude ? 'active' : 'governed');
    }
  });

  it('every concrete registry tool appears in the palette under its projected id', async () => {
    const palette = await realPaletteTools();
    const paletteIds = new Set(palette.map((c) => c.id));
    const concrete = concreteRegistryEntries();

    expect(concrete.length).toBe(15);

    for (const tool of concrete) {
      expect(paletteIds.has(toolCapabilityId(tool.name)),
        `registry tool "${tool.name}" is projected into palette as ${toolCapabilityId(tool.name)}`).toBe(true);
    }
  });

  it('palette tool count exactly matches the concrete registry surface (no dupes, no drops)', async () => {
    const palette = await realPaletteTools();
    const paletteIds = palette.map((c) => c.id);
    expect(new Set(paletteIds).size).toBe(paletteIds.length);

    const concrete = concreteRegistryEntries().map((t) => toolCapabilityId(t.name));
    expect(paletteIds.sort()).toEqual([...concrete].sort());
  });
});
