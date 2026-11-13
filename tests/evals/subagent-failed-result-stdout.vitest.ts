/** Compiled legacy worker entries must refuse; stdout is no longer a parent protocol. */
import {describe, it, expect} from 'vitest';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entries = [
  {label: 'standalone worker', file: 'agents/subagent-cli.js', args: ['--subagent', 'worker', '--prompt', 'must not execute']},
  {label: 'agent command', file: 'cli.js', args: ['agent', 'worker', 'must not execute']},
  {label: 'run worker', file: 'cli.js', args: ['run', '--subagent', 'worker', '--prompt', 'must not execute']},
  {label: 'run equals flag', file: 'cli.js', args: ['run', '--subagent=worker', '--prompt', 'must not execute']},
  {label: 'run trailing worker flag', file: 'cli.js', args: ['run', 'must not execute', '--subagent', 'worker']},
];
function run(file: string, args: string[], cwd: string): Promise<{code: number | null; stdout: string; stderr: string}> {
  return new Promise((yes, no) => {
    const child = spawn(process.execPath, [file, ...args], {cwd, stdio: ['ignore', 'pipe', 'pipe'],
      env: {PATH: process.env.PATH ?? '', HOME: cwd, USERPROFILE: cwd, XDG_CONFIG_HOME: cwd,
        ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {}), ALIX_NO_BANNER: '1'}});
    let stdout = '', stderr = '';
    // A startup diagnostic bound, not an agent lifetime limit: no worker may start.
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', chunk => {stdout += String(chunk);});
    child.stderr.on('data', chunk => {stderr += String(chunk);});
    child.once('error', error => {clearTimeout(timer); no(error);});
    child.once('close', code => {clearTimeout(timer); yes({code, stdout, stderr});});
  });
}
describe('compiled legacy entries refuse without configuration or model execution', () => {
  // The 20s per-case allowance covers cold module startup on supported CI hosts.
  it.each(entries)('$label is held before execution', async ({file, args}) => {
    const entry = join(root, 'dist', 'src', file);
    expect(existsSync(entry), 'fresh compiled output is required').toBe(true);
    const cwd = mkdtempSync(join(tmpdir(), 'alix-entry-hold-'));
    try {
      const result = await run(entry, args, cwd);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('SECURITY HOLD');
      expect(result.stdout).not.toContain('"status":"success"');
    } finally {rmSync(cwd, {recursive: true, force: true});}
  }, 20000);
});
