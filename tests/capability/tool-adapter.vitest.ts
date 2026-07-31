import { describe, it, expect } from 'vitest';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';
import { createToolExecutorAdapter } from '../../src/capability/tool-adapter.js';
import type { ToolCallRequest, ToolResult } from '../../src/tools/types.js';

describe('tool executor adapter', () => {
  it('runs tool.file.read through the existing ToolExecutor contract', async () => {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    platform.registerExecutor('tool', createToolExecutorAdapter({
      execute: async (req: ToolCallRequest): Promise<ToolResult> => {
        if (req.name === 'file.read') return { kind: 'success', content: 'file contents' };
        return { kind: 'error', message: 'unknown' };
      },
    }));
    const inv = platform.invoke('tool.file.read', { path: 'a.ts' }, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() });
    const result = await inv.wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBe('file contents');
  });

  it('maps a denied result to an invocation failure', async () => {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    platform.registerExecutor('tool', createToolExecutorAdapter({
      execute: async (req: ToolCallRequest): Promise<ToolResult | { kind: 'denied'; reason: string }> => {
        if (req.name === 'shell.run') return { kind: 'denied', reason: 'Approval required' };
        return { kind: 'error', message: 'unknown' };
      },
    }));
    const inv = platform.invoke('tool.shell.run', { command: 'rm -rf /' }, { actor: 'admin', cwd: process.cwd(), workspace: process.cwd() });
    const result = await inv.wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Approval required');
  });

  it('maps an error result to an invocation failure', async () => {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    platform.registerExecutor('tool', createToolExecutorAdapter({
      execute: async (req: ToolCallRequest): Promise<ToolResult> => {
        if (req.name === 'file.read') return { kind: 'error', message: 'boom' };
        return { kind: 'error', message: 'unknown' };
      },
    }));
    const inv = platform.invoke('tool.file.read', { path: 'a.ts' }, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() });
    const result = await inv.wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
