import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellToolRouter } from '../../src/capabilities/tools/tool-router.js';
import { runCommand } from '../../src/capabilities/tools/shell-tool.js';
import { isSafeShellCommand } from '../../src/capabilities/tools/safe-shell.js';
import { CommandClassifier } from '../../src/governance/policy/command-classifier.js';

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'alix-d9-shell-'));
  tempRoots.push(root);
  return root;
}

describe('D9 Phase F shell counterexamples', () => {
  // Spawns a real persistent shell with a deliberate 0.2s delayed effect.
  // Workload-scaled budget; assertions unchanged.
  it('F1: persistent-shell completion cannot be forged by consuming and echoing harness stdin', { timeout: 30_000 }, async () => {
    const root = await tempRoot();
    const effect = join(root, 'effect.txt');
    const router = new ShellToolRouter(root);
    // The command attempts to consume a hypothetical next stdin line before a
    // delayed effect. Routed execution must not expose a harness completion
    // trailer on stdin, and success must mean the command actually completed.
    const result = await router.execute({
      toolCallId: 'f1',
      name: 'shell.run',
      args: { command: `IFS= read -r trailer || true; printf '%s\\n' "\${trailer:-}"; sleep 0.2; printf applied > ${JSON.stringify(effect)}`, persistent: true },
    });
    expect(result.kind).toBe('success');
    expect(existsSync(effect)).toBe(true);
  });

  // POSIX-only: `kill -TERM $$` signals the shell itself, which POSIX spawn
  // reports as `closeSignal`, and Node only sets that on platforms with real
  // signal semantics. Windows has no equivalent here, so this case would assert
  // a signal name that cannot be produced.
  it.skipIf(process.platform === 'win32')('F2: signal termination is never classified as successful exit 0', { timeout: 30_000 }, async () => {
    const root = await tempRoot();
    const result = await runCommand({ command: 'printf EFFECT_OBSERVED; kill -TERM $$', cwd: root });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(/signal|SIGTERM|terminated/i);
  });

  // Windows counterpart for the same safety property. This asserts only that a
  // nonzero exit is never a success — it is NOT evidence of signal termination:
  // `process.exit(143)` is a plain exit code, and 143's conventional meaning on
  // POSIX (128+15) does not make Windows report a signal. The effect must also
  // stay uncertain, because a non-zero exit cannot prove no mutation happened.
  //
  // The exit code comes from a script FILE, not `node -e "..."`: `runCommand`
  // spawns with `shell: true`, so on Windows the command is interpolated into
  // `cmd.exe /d /s /c "<command>"`. Embedded double quotes only survive because
  // of cmd's `/s` first/last-quote stripping, which is fragile. A file path has
  // no quotes to mangle.
  it.skipIf(process.platform !== 'win32')('F2 (Windows): a nonzero exit is never classified as success', { timeout: 30_000 }, async () => {
    const root = await tempRoot();
    const script = join(root, 'exit143.cjs');
    await writeFile(script, 'process.exit(143);\n', 'utf8');
    const result = await runCommand({ command: 'node exit143.cjs', cwd: root });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/exited with code 143/i);
      expect(result.message).not.toMatch(/signal/i);
      expect(result.outcomeUnknown).toBe(true);
      expect(result.retryable).toBe(false);
    }
  });

  it('F4: git show output-writing syntax is not approval-exempt safe shell', () => {
    // git accepts --output <path>; this form can create/overwrite a file even
    // though the command family is normally a read operation.
    expect(isSafeShellCommand('git show --output HEAD')).toBe(false);
  });

  it('F4: git diff output-writing syntax is not approval-exempt safe shell', () => {
    expect(isSafeShellCommand('git diff --output --stat')).toBe(false);
    expect(isSafeShellCommand('git diff --stat')).toBe(true);
  });

  it('F4: quoted rg --pre cannot receive safe-shell approval exemption', () => {
    expect(isSafeShellCommand(`rg '--pre' sh script.txt script.txt`)).toBe(false);
    expect(isSafeShellCommand(`rg 'needle' script.txt`)).toBe(false);
  });

  it('F4: rg preprocessors are not classified as read-only', () => {
    const classification = new CommandClassifier().classify('rg --pre cat "needle" .');
    expect(classification.tags).not.toContain('read-only');
  });
});
