import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDefaultToolIndex } from '../../src/capabilities/tools/tool-registry.js';
import { executeWithEffectJournal, readEffectRecord } from '../../src/capabilities/tools/effect-journal.js';
import { runCommand } from '../../src/capabilities/tools/shell-tool.js';
import { McpToolRouter } from '../../src/capabilities/tools/tool-router.js';
import { McpToolRegistry } from '../../src/capabilities/mcp/registry.js';
import type { ToolCallRequest } from '../../src/capabilities/tools/types.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'alix-d9-dispatch-'));
  roots.push(root);
  return root;
}
function shell(command: string, args: Record<string, unknown> = {}): ToolCallRequest {
  return { toolCallId: 'shell', name: 'shell.run', args: { command, ...args } };
}

describe('D9 Slice D registry coverage', () => {
  it('enumerates the complete high/critical mutating routed catalogue', () => {
    const names = buildDefaultToolIndex().registry.getAll()
      .filter((tool) => tool.mutates && (tool.risk === 'high' || tool.risk === 'critical'))
      .map((tool) => tool.name)
      .sort();
    expect(names).toEqual([
      'file.delete', 'hook.create', 'mcp.*', 'patch.apply', 'schedule.propose', 'shell.run',
    ]);
  });

  (process.platform === 'linux' ? it : it.skip)('journals every high/critical mutating catalogue family and blocks exact replay', async () => {
    const root = await tempRoot();
    const calls: ToolCallRequest[] = [
      { toolCallId: '1', name: 'file.delete', args: { path: 'x' } },
      { toolCallId: '2', name: 'hook.create', args: { description: 'x', trigger: 'on_pre_tool', body: 'return' } },
      { toolCallId: '3', name: 'mcp.test.mutate', args: { value: 1 } },
      { toolCallId: '4', name: 'patch.apply', args: { format: 'search_replace', patchText: 'x' } },
      { toolCallId: '5', name: 'schedule.propose', args: { name: 'x' } },
      shell('printf applied > effect.txt'),
    ];
    for (const request of calls) {
      let adapterCalls = 0;
      expect((await executeWithEffectJournal(root, request, async () => {
        adapterCalls++;
        return { kind: 'success', output: 'ok' };
      })).kind).toBe('success');
      expect(readEffectRecord(root, request)?.state).toBe('terminal_success');
      const replay = await executeWithEffectJournal(root, { ...request, toolCallId: `${request.toolCallId}-replay` }, async () => {
        adapterCalls++;
        return { kind: 'success', output: 'duplicate' };
      });
      expect(replay).toMatchObject({ kind: 'error', retryable: false });
      expect(adapterCalls).toBe(1);
    }
  });
});

(process.platform === 'linux' ? describe : describe.skip)('D9 Slice D ambiguous shell outcomes', () => {
  // Each case spawns a real shell and waits for an observable file effect plus
  // a timeout/signal/nonzero exit, so wall-clock work exceeds a pure unit spec.
  // Workload-scaled budget; the assertions are unchanged.
  it('timeout after an observable effect remains started_unknown', { timeout: 30_000 }, async () => {
    const root = await tempRoot();
    const effect = join(root, 'timeout-effect.txt');
    const request = shell(`printf applied > ${JSON.stringify(effect)}; sleep 1`, { timeoutMs: 20 });
    const result = await executeWithEffectJournal(root, request, (bound) => runCommand({
      command: String(bound.args.command), cwd: String(bound.args.cwd), timeoutMs: Number(bound.args.timeoutMs),
    }));
    expect(await readFile(effect, 'utf8')).toBe('applied');
    expect(result).toMatchObject({ kind: 'error', outcomeUnknown: true, retryable: false });
    expect(readEffectRecord(root, request)?.state).toBe('started_unknown');
  });

  it('signal termination after an observable effect remains started_unknown', { timeout: 30_000 }, async () => {
    const root = await tempRoot();
    const effect = join(root, 'signal-effect.txt');
    const request = shell(`printf applied > ${JSON.stringify(effect)}; kill -TERM $$`);
    const result = await executeWithEffectJournal(root, request, (bound) => runCommand({
      command: String(bound.args.command), cwd: String(bound.args.cwd),
    }));
    expect(await readFile(effect, 'utf8')).toBe('applied');
    expect(result).toMatchObject({ kind: 'error', outcomeUnknown: true, retryable: false });
    expect(readEffectRecord(root, request)?.state).toBe('started_unknown');
  });

  it('nonzero exit after an observable effect remains started_unknown', { timeout: 30_000 }, async () => {
    const root = await tempRoot();
    const effect = join(root, 'nonzero-effect.txt');
    const request = shell(`printf applied > ${JSON.stringify(effect)}; false`);
    const result = await executeWithEffectJournal(root, request, (bound) => runCommand({
      command: String(bound.args.command), cwd: String(bound.args.cwd),
    }));
    expect(await readFile(effect, 'utf8')).toBe('applied');
    expect(result).toMatchObject({ kind: 'error', outcomeUnknown: true, retryable: false });
    expect(readEffectRecord(root, request)?.state).toBe('started_unknown');
  });
});

(process.platform === 'linux' ? describe : describe.skip)('D9 Slice D dynamic MCP ambiguity', () => {
  it('production MCP registry preserves a thrown transport failure as outcome-unknown', async () => {
    const root = await tempRoot();
    let providerCalls = 0;
    const registry = new McpToolRegistry();
    (registry as any).tools.set('test/mutate', {
      fullName: 'test/mutate', serverName: 'test', toolName: 'mutate', inputSchema: {}, isMcp: true,
    });
    (registry as any).clients.set('test', {
      callTool: vi.fn(async () => { providerCalls++; throw new Error('connection lost after send'); }),
    });
    const manager = { callTool: (name: string, args: Record<string, unknown>) => registry.callTool(name, args) } as any;
    const router = new McpToolRouter(manager);
    const request: ToolCallRequest = { toolCallId: 'mcp', name: 'mcp.test.mutate', args: { value: 1 } };
    const result = await executeWithEffectJournal(root, request, (bound) => router.execute(bound));
    expect(result).toMatchObject({ kind: 'error', outcomeUnknown: true, retryable: false });
    expect(readEffectRecord(root, request)?.state).toBe('started_unknown');
    const replay = await executeWithEffectJournal(root, { ...request, toolCallId: 'mcp-replay' }, (bound) => router.execute(bound));
    expect(replay).toMatchObject({ kind: 'error', outcomeUnknown: true, retryable: false });
    expect(providerCalls).toBe(1);
  });

  it('production MCP isError response remains outcome-unknown for a mutating dynamic tool', async () => {
    const root = await tempRoot();
    const registry = new McpToolRegistry();
    (registry as any).tools.set('test/mutate', {
      fullName: 'test/mutate', serverName: 'test', toolName: 'mutate', inputSchema: {}, isMcp: true,
    });
    (registry as any).clients.set('test', {
      callTool: vi.fn(async () => ({ isError: true, content: [{ type: 'text', text: 'partial apply failed' }] })),
    });
    const manager = { callTool: (name: string, args: Record<string, unknown>) => registry.callTool(name, args) } as any;
    const router = new McpToolRouter(manager);
    const request: ToolCallRequest = { toolCallId: 'mcp-error', name: 'mcp.test.mutate', args: { value: 2 } };
    const result = await executeWithEffectJournal(root, request, (bound) => router.execute(bound));
    expect(result).toMatchObject({ kind: 'error', outcomeUnknown: true, retryable: false });
    expect(readEffectRecord(root, request)?.state).toBe('started_unknown');
  });
});
