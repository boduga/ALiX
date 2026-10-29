#!/usr/bin/env node
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const res = spawnSync(command, args, { encoding: 'utf8', ...options });
  return { exitCode: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}
const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
const tree = run('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim();
const root = mkdtempSync(join(tmpdir(), 'pre-r024-shell-'));
const workspace = join(root, 'workspace');
const marker = join(root, 'grader-marker.txt');
mkdirSync(workspace);
writeFileSync(marker, 'GRADER_MARKER');
try {
  const command = 'test -r ../grader-marker.txt && echo REACHABLE || echo BLOCKED';
  const result = run(process.execPath, ['--input-type=module', '-e', `import { runCommand } from ${JSON.stringify(new URL('../../dist/src/capabilities/tools/shell-tool.js', import.meta.url).href)}; const r=await runCommand({command:${JSON.stringify(command)},cwd:${JSON.stringify(workspace)}}); console.log(r.output ?? r.message ?? '');`], { cwd: process.cwd() });
  const reachable = result.stdout.includes('REACHABLE');
  const record = {
    schemaVersion: 1,
    kind: 'pre-r024-shell-boundary-probe',
    recordedAt: new Date().toISOString(),
    source: { commit: head, tree },
    probe: { command, shellCwd: '<temp>/workspace', graderPath: '<temp>/grader-marker.txt' },
    result: { childExitCode: result.exitCode, observation: reachable ? 'REACHABLE' : 'BLOCKED' },
    qualified: !reachable,
    interpretation: reachable
      ? 'shell.run is constrained by cwd but not OS-isolated from sibling/parent filesystem paths; a grader outside the workspace is reachable.'
      : 'shell.run could not observe the sibling grader marker in this probe.',
  };
  process.stdout.write(JSON.stringify(record, null, 2) + '\n');
  process.exit(reachable ? 1 : 0);
} finally {
  rmSync(root, { recursive: true, force: true });
}
