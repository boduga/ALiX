import { describe, it, expect } from 'vitest';
import { NativeExecutor } from '../../src/capability/executors.js';
import {
  NativeProviderExecutor, ToolProviderExecutor, UnavailableProviderExecutor,
  isFallbackEligibleKind, classifyErrorKind,
} from '../../src/capability/provider-executor.js';
import type { Capability, CapabilityContext } from '../../src/capability/types.js';
import type { CapabilityProviderBinding } from '../../src/capability/canonical/provider.js';
import type { ToolCallRequest } from '../../src/tools/types.js';
import type { ExecuteResult } from '../../src/tools/executor.js';
import { McpProviderExecutor, ExternalCliProviderExecutor, type SpawnLike } from '../../src/capability/provider-executor.js';

function cap(id = 'core.echo'): Capability {
  return { id, version: '1.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    execution: { strategy: 'native', timeout: 5000, cancellable: true } };
}
function ctx(): CapabilityContext {
  return { invocationId: 'i', requestId: 'r', actor: 'operator', permissions: ['operator'],
    cwd: '/', workspace: '/', sessionId: 's', cancellationToken: new AbortController().signal,
    eventBus: { emit: () => {} } };
}
function binding(over: Partial<CapabilityProviderBinding> = {}): CapabilityProviderBinding {
  return { id: 'gh', type: 'external-cli', ...over };
}

describe('classifyErrorKind — closed R1 taxonomy', () => {
  const err = (code?: string) => Object.assign(new Error('boom'), code ? { code } : {});
  it('classifies process spawn codes', () => {
    expect(classifyErrorKind(err('ENOENT'))).toBe('unavailable');       // executable missing
    expect(classifyErrorKind(err('ETIMEDOUT'))).toBe('timeout');
    expect(classifyErrorKind(err('ABORT_ERR'))).toBe('timeout');
  });
  it('classifies tool-retryable vs tool-fatal (ToolProviderExecutor path)', () => {
    expect(classifyErrorKind(err(), undefined, true)).toBe('unavailable');
    expect(classifyErrorKind(err(), undefined, false)).toBe('fatal');
  });
  it('classifies CLI exit stderr', () => {
    expect(classifyErrorKind(err(), 'HTTP 429 Too Many Requests')).toBe('rate-limit');
    expect(classifyErrorKind(err(), '500 Internal Server Error')).toBe('http-5xx');
    expect(classifyErrorKind(err(), 'boom')).toBe('fatal');
  });
  it('defaults an unclassified error to fatal (fail-closed)', () => {
    expect(classifyErrorKind(err())).toBe('fatal');
  });
});

describe('isFallbackEligibleKind', () => {
  it('classifies timeout/rate-limit/http-5xx/unavailable as fallback-eligible', () => {
    for (const k of ['timeout', 'rate-limit', 'http-5xx', 'unavailable'] as const) {
      expect(isFallbackEligibleKind(k)).toBe(true);
    }
  });
  it('classifies bad-request/auth/contract/configuration/fatal as fatal', () => {
    for (const k of ['bad-request', 'auth', 'contract', 'configuration', 'fatal'] as const) {
      expect(isFallbackEligibleKind(k)).toBe(false);
    }
  });
  it('classifies undefined as fatal (no fallback on an unclassified error)', () => {
    expect(isFallbackEligibleKind(undefined)).toBe(false);
  });
});

describe('NativeProviderExecutor', () => {
  it('delegates to the native handler keyed by capability.id', async () => {
    const native = new NativeExecutor();
    native.registerHandler('core.echo', async () => ({ output: 'hello' }));
    const exec = new NativeProviderExecutor(native);
    const result = await exec.run(binding({ type: 'native' }), cap(), ctx(), {});
    expect(result).toEqual({ output: 'hello' });
  });
});

describe('ToolProviderExecutor', () => {
  function makeTool(run: (req: ToolCallRequest) => Promise<ExecuteResult>) {
    return new ToolProviderExecutor({ execute: run });
  }
  it('uses binding.config.toolName and maps success output', async () => {
    const exec = makeTool(async (req) => {
      expect(req.name).toBe('file.read');
      return { kind: 'success', output: 'content' };
    });
    const result = await exec.run(binding({ type: 'tool', config: { toolName: 'file.read' } }), cap(), ctx(), {});
    expect(result).toEqual({ output: 'content' });
  });
  it('maps a retryable error to fallback-eligible unavailable', async () => {
    const exec = makeTool(async () => ({ kind: 'error', message: 'upstream', retryable: true }));
    const result = await exec.run(binding({ type: 'tool' }), cap(), ctx(), {});
    expect(result.errorKind).toBe('unavailable');
  });
  it('maps a non-retryable error to fatal', async () => {
    const exec = makeTool(async () => ({ kind: 'error', message: 'bad args' }));
    const result = await exec.run(binding({ type: 'tool' }), cap(), ctx(), {});
    expect(result.errorKind).toBe('fatal');
  });
});

describe('UnavailableProviderExecutor', () => {
  it('returns a fallback-eligible provider_unavailable for an unimplemented class', async () => {
    const result = await new UnavailableProviderExecutor('daemon').run(binding({ type: 'daemon' }), cap(), ctx(), {});
    expect(result.error).toMatch(/not implemented/i);
    expect(result.errorKind).toBe('unavailable');
  });
});

describe('McpProviderExecutor', () => {
  it('calls the MCP tool and returns output', async () => {
    const calls: string[] = [];
    const exec = new McpProviderExecutor({ callTool: async (name, _args) => { calls.push(name); return { kind: 'success', output: 'ok' }; } });
    const result = await exec.run(binding({ type: 'mcp', id: 'mcp:github', config: { toolName: 'github.issue.create' } }), cap(), ctx(), {});
    expect(calls).toEqual(['github.issue.create']);
    expect(result.output).toBe('ok');
  });
  it('falls back to binding.id as the tool name when config.toolName is absent', async () => {
    const calls: string[] = [];
    const exec = new McpProviderExecutor({ callTool: async (name) => { calls.push(name); return { kind: 'success' }; } });
    await exec.run(binding({ type: 'mcp', id: 'mcp:github' }), cap(), ctx(), {});
    expect(calls).toEqual(['mcp:github']);
  });
  it('maps an error result to fatal (or unavailable when retryable)', async () => {
    const fatal = new McpProviderExecutor({ callTool: async () => ({ kind: 'error', message: 'denied' }) });
    expect((await fatal.run(binding({ type: 'mcp' }), cap(), ctx(), {})).errorKind).toBe('fatal');
    const retryable = new McpProviderExecutor({ callTool: async () => ({ kind: 'error', message: 'busy', retryable: true }) });
    expect((await retryable.run(binding({ type: 'mcp' }), cap(), ctx(), {})).errorKind).toBe('unavailable');
  });
});

describe('ExternalCliProviderExecutor', () => {
  function fakeSpawn(record: { cmd: string; args: string[] }[]) {
    const spawn: SpawnLike = async (cmd, args, opts) => { record.push({ cmd, args }); return { exitCode: 0, stdout: 'out', stderr: '' }; };
    return spawn;
  }
  it('spawns the executable with operation args and a --json invocation payload', async () => {
    const record: { cmd: string; args: string[] }[] = [];
    const exec = new ExternalCliProviderExecutor(fakeSpawn(record));
    const result = await exec.run(
      binding({ type: 'external-cli', id: 'gitnexus', config: { executable: 'gitnexus', operation: ['impact'] } }),
      cap('code.repository.impact'), ctx(), { file: 'src/x.ts' });
    expect(record[0]).toEqual({ cmd: 'gitnexus', args: ['impact', '--json', JSON.stringify({ file: 'src/x.ts' })] });
    expect(result.output).toBe('out');
  });
  it('gh implements github.issue.create with its operation', async () => {
    const record: { cmd: string; args: string[] }[] = [];
    const exec = new ExternalCliProviderExecutor(fakeSpawn(record));
    await exec.run(binding({ type: 'external-cli', id: 'gh', config: { executable: 'gh', operation: ['issue', 'create'] } }), cap('github.issue.create'), ctx(), { title: 'x' });
    expect(record[0]!.cmd).toBe('gh');
    expect(record[0]!.args[0]).toBe('issue');
    expect(record[0]!.args[1]).toBe('create');
  });
  it('ENOENT (executable missing) is fallback-eligible provider_unavailable', async () => {
    const spawn: SpawnLike = async () => { const e = new Error('spawn gh ENOENT') as Error & { code: string }; e.code = 'ENOENT'; throw e; };
    const exec = new ExternalCliProviderExecutor(spawn);
    const result = await exec.run(binding({ type: 'external-cli', id: 'gh', config: { executable: 'gh' } }), cap(), ctx(), {});
    expect(result.errorKind).toBe('unavailable');
    expect(result.error).toMatch(/ENOENT|not found/i);
  });
  it('a missing config.executable is a fatal configuration error', async () => {
    const record: { cmd: string; args: string[] }[] = [];
    const exec = new ExternalCliProviderExecutor(fakeSpawn(record));
    const result = await exec.run(binding({ type: 'external-cli', id: 'gh' }), cap(), ctx(), {});
    expect(result.errorKind).toBe('configuration');
    expect(record).toHaveLength(0);   // nothing spawned
  });
  it('a timeout is a fallback-eligible timeout', async () => {
    const spawn: SpawnLike = async () => { const e = new Error('timed out') as Error & { code: string }; e.code = 'ETIMEDOUT'; throw e; };
    const result = await new ExternalCliProviderExecutor(spawn).run(binding({ type: 'external-cli', id: 'gh', config: { executable: 'gh' } }), cap(), ctx(), {});
    expect(result.errorKind).toBe('timeout');
  });
});
