import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { effectIdentity, executeWithEffectJournal, readEffectRecord } from '../../src/capabilities/tools/effect-journal.js';
import type { ToolCallRequest, ToolResult } from '../../src/capabilities/tools/types.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root(): Promise<string> { const p = await mkdtemp(join(tmpdir(), 'alix-effect-journal-')); roots.push(p); return p; }
function req(command = 'printf applied > effect.txt'): ToolCallRequest { return { toolCallId: 't1', name: 'shell.run', args: { command } }; }

(process.platform === 'linux' ? describe : describe.skip)('D9 durable effect journal', () => {
  it('persists terminal_success and blocks exact replay without re-entering the adapter', async () => {
    const cwd = await root(); let calls = 0;
    const request = req();
    const first = await executeWithEffectJournal(cwd, request, async () => { calls++; return { kind: 'success', output: 'ok' }; });
    expect(first.kind).toBe('success');
    expect(readEffectRecord(cwd, request)?.state).toBe('terminal_success');
    const second = await executeWithEffectJournal(cwd, request, async () => { calls++; return { kind: 'success', output: 'duplicate' }; });
    expect(second.kind).toBe('error');
    expect(calls).toBe(1);
  });

  it('retains started_unknown for an indeterminate adapter result', async () => {
    const cwd = await root(); const request = req('touch maybe-applied');
    const result = await executeWithEffectJournal(cwd, request, async () => ({ kind: 'error', message: 'lost response', outcomeUnknown: true }));
    expect(result).toMatchObject({ kind: 'error', outcomeUnknown: true, retryable: false });
    expect(readEffectRecord(cwd, request)?.state).toBe('started_unknown');
  });

  it('records terminal_failure for a definite adapter failure', async () => {
    const cwd = await root(); const request = req('false');
    const result = await executeWithEffectJournal(cwd, request, async () => ({ kind: 'error', message: 'definite failure' }));
    expect(result).toMatchObject({ kind: 'error', retryable: false });
    expect(readEffectRecord(cwd, request)?.state).toBe('terminal_failure');
  });

  it('retains started_unknown when the adapter throws', async () => {
    const cwd = await root(); const request = req('touch then-throw');
    await expect(executeWithEffectJournal(cwd, request, async () => { throw new Error('transport broke'); })).rejects.toThrow('transport broke');
    expect(readEffectRecord(cwd, request)?.state).toBe('started_unknown');
  });

  it('never stores raw command arguments in the journal record', async () => {
    const cwd = await root(); const secret = 'TOKEN_DO_NOT_PERSIST'; const request = req(`printf ${secret} > out.txt`);
    await executeWithEffectJournal(cwd, request, async () => ({ kind: 'success', output: 'ok' }));
    const path = effectIdentity(cwd, request).path;
    expect(await readFile(path, 'utf8')).not.toContain(secret);
  });

  it('allows repeat execution for conservatively safe-shell reads without creating a record', async () => {
    const cwd = await root(); let calls = 0; const request = req('pwd');
    const execute = async (): Promise<ToolResult> => { calls++; return { kind: 'success', output: cwd }; };
    expect((await executeWithEffectJournal(cwd, request, execute)).kind).toBe('success');
    expect((await executeWithEffectJournal(cwd, request, execute)).kind).toBe('success');
    expect(calls).toBe(2);
    expect(readEffectRecord(cwd, request)).toBeUndefined();
  });


  it('deep-snapshots nested mutating arguments so adapter effect identity cannot drift after dispatch', async () => {
    const cwd = await root();
    const request: ToolCallRequest = {
      toolCallId: 'nested-mcp', name: 'mcp.provider.charge', args: { payment: { id: 'A', amount: 10 } },
    };
    let observed: unknown;
    const pending = executeWithEffectJournal(cwd, request, async (bound) => {
      observed = (bound.args.payment as { id: string }).id;
      return { kind: 'success', output: 'applied' };
    });
    // Mutate immediately after dispatch, while executeWithEffectJournal has
    // yielded at its first lock await. The adapter must still receive the
    // exact deep snapshot whose identity was claimed before that await.
    (request.args.payment as { id: string }).id = 'B';
    expect((await pending).kind).toBe('success');
    expect(observed).toBe('A');
    const original: ToolCallRequest = { toolCallId: 'original', name: request.name, args: { payment: { id: 'A', amount: 10 } } };
    const mutated: ToolCallRequest = { toolCallId: 'mutated', name: request.name, args: { payment: { id: 'B', amount: 10 } } };
    expect(readEffectRecord(cwd, original)?.state).toBe('terminal_success');
    expect(readEffectRecord(cwd, mutated)).toBeUndefined();
  });

  it('binds the canonical shell cwd used for identity to the adapter request', async () => {
    const cwd = await root();
    const sub = join(cwd, 'sub');
    await mkdir(sub);
    const request: ToolCallRequest = { ...req('printf applied > effect.txt'), args: { command: 'printf applied > effect.txt', cwd: 'sub' } };
    let observedCwd: unknown;
    const result = await executeWithEffectJournal(cwd, request, async (bound) => {
      observedCwd = bound.args.cwd;
      return { kind: 'success', output: 'ok' };
    });
    expect(result.kind).toBe('success');
    expect(observedCwd).toBe(await realpath(sub));
    expect(readEffectRecord(cwd, request)?.state).toBe('terminal_success');
  });

  it('fails closed when the journal namespace is redirected through a symlink', async () => {
    const cwd = await root();
    const outside = await root();
    await symlink(outside, join(cwd, '.alix'), 'dir');
    let calls = 0;
    const result = await executeWithEffectJournal(cwd, req('touch should-not-run'), async () => {
      calls++;
      return { kind: 'success', output: 'bad' };
    });
    expect(result).toMatchObject({ kind: 'error', retryable: false });
    if (result.kind === 'error') expect(result.message).toMatch(/namespace|journal/i);
    expect(calls).toBe(0);
  });

  it('serializes same-key concurrent entry before either adapter can run twice', async () => {
    const cwd = await root(); let calls = 0; const request = req('sleep 0.01; touch one');
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = executeWithEffectJournal(cwd, request, async () => { calls++; await gate; return { kind: 'success', output: 'ok' }; });
    const secondPending = executeWithEffectJournal(cwd, request, async () => { calls++; return { kind: 'success', output: 'duplicate' }; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(calls).toBe(1);
    release();
    expect((await first).kind).toBe('success');
    expect((await secondPending).kind).toBe('error');
    expect(calls).toBe(1);
  });
});

(process.platform === 'linux' ? describe : describe.skip)('D9 effect journal crash-order injection', () => {
  for (const [point, expected] of [
    ['after_claim', 'claimed'],
    ['before_adapter', 'started_unknown'],
    ['after_adapter', 'started_unknown'],
  ] as const) {
    it(`${point} preserves ${expected}`, async () => {
      const cwd = await root(); const request = req(`printf ${point} > point.txt`);
      const execute = async (): Promise<ToolResult> => ({ kind: 'success', output: 'ok' });
      await expect(executeWithEffectJournal(cwd, request, execute, {
        onPoint: (seen) => { if (seen === point) throw new Error(`fault:${point}`); },
      })).rejects.toThrow(`fault:${point}`);
      expect(readEffectRecord(cwd, request)?.state).toBe(expected);
    });
  }

  it('after_terminal leaves durable terminal_success even if the host dies immediately after persistence', async () => {
    const cwd = await root(); const request = req('printf done > terminal.txt');
    await expect(executeWithEffectJournal(cwd, request, async () => ({ kind: 'success', output: 'ok' }), {
      onPoint: (seen) => { if (seen === 'after_terminal') throw new Error('fault:after_terminal'); },
    })).rejects.toThrow('fault:after_terminal');
    expect(readEffectRecord(cwd, request)?.state).toBe('terminal_success');
  });
});


(process.platform === 'linux' ? describe : describe.skip)('D9 effect journal cancellation boundary', () => {
  it('already-aborted request neither journals nor enters the adapter', async () => {
    const cwd = await root(); const controller = new AbortController(); controller.abort('cancel-before-claim');
    const request = { ...req('touch never'), signal: controller.signal };
    let calls = 0;
    await expect(executeWithEffectJournal(cwd, request, async () => { calls++; return { kind: 'success', output: 'bad' }; })).rejects.toThrow(/cancel/i);
    expect(calls).toBe(0);
    expect(readEffectRecord(cwd, request)).toBeUndefined();
  });

  it('abort observed after adapter return cannot become terminal_success', async () => {
    const cwd = await root();
    const controller = new AbortController();
    const request = { ...req('touch may-have-applied'), signal: controller.signal };
    await expect(executeWithEffectJournal(cwd, request, async () => {
      controller.abort('cancel-during-adapter');
      return { kind: 'success', output: 'adapter-returned' };
    })).rejects.toThrow(/cancel/i);
    expect(readEffectRecord(cwd, request)?.state).toBe('started_unknown');
  });

  it('abort observed after durable started_unknown prevents adapter entry', async () => {
    const cwd = await root(); const controller = new AbortController();
    const request = { ...req('touch never-after-journal'), signal: controller.signal };
    let calls = 0;
    await expect(executeWithEffectJournal(cwd, request, async () => { calls++; return { kind: 'success', output: 'bad' }; }, {
      onPoint: (point) => { if (point === 'before_adapter') controller.abort('cancel-at-boundary'); },
    })).rejects.toThrow(/cancel/i);
    expect(calls).toBe(0);
    expect(readEffectRecord(cwd, request)?.state).toBe('started_unknown');
  });
});
