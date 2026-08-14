import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';
import { createToolProviderExecutor } from '../../src/capability/tool-adapter.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { ToolCallRequest, ToolResult } from '../../src/tools/types.js';

describe('tool provider executor', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-tool-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // R10 — test-owned catalog composed into the platform; `registerInitialCapabilities`
  // accepts a CapabilityRegistry, so wrap our catalog in one with the catalog-backed port.
  function platformWithTool(tool: { execute(req: ToolCallRequest): Promise<ToolResult | { kind: 'denied'; reason: string }> }) {
    const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    const platform = new CapabilityPlatform({ catalog, eventLog: { append: async () => {}, readAll: async () => [] } as never });
    const registry = new CapabilityRegistry(catalog);
    registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
    registerInitialCapabilities(registry, platform.native);
    platform.registerProvider('tool', createToolProviderExecutor(tool));
    return platform;
  }

  it('runs tool.file.read through the existing ToolExecutor contract', async () => {
    const platform = platformWithTool({
      execute: async (req: ToolCallRequest): Promise<ToolResult> => {
        if (req.name === 'file.read') return { kind: 'success', content: 'file contents' };
        return { kind: 'error', message: 'unknown' };
      },
    });
    const result = await platform.invoke('tool.file.read', { path: 'a.ts' }, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() }).wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBe('file contents');
  });

  it('maps a denied result to an invocation failure', async () => {
    const platform = platformWithTool({
      execute: async (req: ToolCallRequest): Promise<ToolResult | { kind: 'denied'; reason: string }> => {
        if (req.name === 'shell.run') return { kind: 'denied', reason: 'Approval required' };
        return { kind: 'error', message: 'unknown' };
      },
    });
    const result = await platform.invoke('tool.shell.run', { command: 'rm -rf /' }, { actor: 'admin', cwd: process.cwd(), workspace: process.cwd() }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Approval required');
  });

  it('maps an error result to an invocation failure', async () => {
    const platform = platformWithTool({
      execute: async (req: ToolCallRequest): Promise<ToolResult> => {
        if (req.name === 'file.read') return { kind: 'error', message: 'boom' };
        return { kind: 'error', message: 'unknown' };
      },
    });
    const result = await platform.invoke('tool.file.read', { path: 'a.ts' }, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
