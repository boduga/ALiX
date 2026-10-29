import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
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
  it('F1: persistent-shell completion cannot be forged by consuming and echoing harness stdin', async () => {
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

  it('F2: signal termination is never classified as successful exit 0', async () => {
    const root = await tempRoot();
    const result = await runCommand({ command: 'printf EFFECT_OBSERVED; kill -TERM $$', cwd: root });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(/signal|SIGTERM|terminated/i);
  });

  it('F4: git show output-writing syntax is not approval-exempt safe shell', () => {
    // git accepts --output <path>; this form can create/overwrite a file even
    // though the command family is normally a read operation.
    expect(isSafeShellCommand('git show --output HEAD')).toBe(false);
  });

  it('F4: rg preprocessors are not classified as read-only', () => {
    const classification = new CommandClassifier().classify('rg --pre cat "needle" .');
    expect(classification.tags).not.toContain('read-only');
  });
});
