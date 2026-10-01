/**
 * Verification must see the work it is verifying.
 *
 * `runWithIsolation` stashes the working tree before running a command and pops
 * it afterwards. That is the right shape for a scratch sandbox and the wrong
 * shape everywhere else, and the task loop passed the live workspace root as
 * `"."` — so post-change verification stashed the agent's uncommitted edits and
 * ran the suite against the tree from BEFORE the change.
 *
 * Reproduced directly before this fix: with `marker.txt` modified in the
 * working tree, an isolated run observed the committed content. A check that
 * cannot see the change is not a verification; it reports `passed` for code
 * nobody wrote.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isVerificationSandbox, stashChanges, runWithIsolation } from '../../src/skills/test-isolation.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initRepo(dir: string, marker: string): void {
  // `node -e` with a forward-slash-free relative read: runCommand spawns via
  // /bin/sh, which does not exist on Windows, so the probe must be a plain
  // `node probe.cjs` rather than shell syntax.
  writeFileSync(join(dir, 'probe.cjs'), 'process.stdout.write(require("node:fs").readFileSync("marker.txt","utf8").trim()+"\\n");\n');
  writeFileSync(join(dir, 'marker.txt'), marker);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
}

function stashCount(dir: string): number {
  return git(dir, 'stash', 'list').trim().split('\n').filter(Boolean).length;
}

describe('verification isolation guard', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'alix-verify-'));
    initRepo(dir, 'COMMITTED');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ALIX_VERIFY_ISOLATION_ROOT;
  });

  it('refuses to isolate an ordinary working tree', () => {
    expect(isVerificationSandbox(dir)).toBe(false);
    expect(isVerificationSandbox(process.cwd())).toBe(false);
  });

  it('does not treat a temp directory as a sandbox', () => {
    // A temp dir is not evidence of disposability — this repo runs real agent
    // work and real git repos there, and a workspace may live under /tmp too.
    expect(dir.startsWith(tmpdir())).toBe(true);
    expect(isVerificationSandbox(dir)).toBe(false);
  });

  it('never stashes a real repo, so uncommitted work cannot be captured', async () => {
    writeFileSync(join(dir, 'marker.txt'), 'AGENT_WROTE_THIS');
    const before = stashCount(dir);
    expect(await stashChanges(dir)).toBeNull();
    expect(stashCount(dir)).toBe(before);
    // The work is still exactly where the agent left it.
    expect(readFileSync(join(dir, 'marker.txt'), 'utf8')).toBe('AGENT_WROTE_THIS');
  });

  it('runs the command in place, so it sees the agent edits', async () => {
    writeFileSync(join(dir, 'marker.txt'), 'AGENT_WROTE_THIS');
    const result = await runWithIsolation(dir, 'node probe.cjs', 30_000);
    expect(result.passed).toBe(true);
    // The defect: this read COMMITTED. A post-change check must not.
    expect(result.output).toContain('AGENT_WROTE_THIS');
    expect(result.output).not.toContain('COMMITTED');
    expect(result.isolated).toBe(false);
  });

  it('leaves the working tree untouched after an isolated-mode run', async () => {
    writeFileSync(join(dir, 'marker.txt'), 'AGENT_WROTE_THIS');
    const before = stashCount(dir);
    await runWithIsolation(dir, 'node probe.cjs', 30_000);
    expect(stashCount(dir)).toBe(before);
    expect(readFileSync(join(dir, 'marker.txt'), 'utf8')).toBe('AGENT_WROTE_THIS');
  });

  it('still isolates an explicitly opted-in root', () => {
    process.env.ALIX_VERIFY_ISOLATION_ROOT = dir;
    expect(isVerificationSandbox(dir)).toBe(true);
  });

  it('does not let the opt-in leak to a different root', () => {
    process.env.ALIX_VERIFY_ISOLATION_ROOT = dir;
    expect(isVerificationSandbox(join(dir, 'elsewhere'))).toBe(false);
  });

  /**
   * Separator handling is a real correctness concern, not cosmetics: the
   * matcher originally split on the RUNNING platform's `sep`, so a
   * `\`-separated Windows path matched nothing on a POSIX test host and the
   * `unit-windows` lane reported a real sandbox as unprotected. Both shapes are
   * asserted here so the platform lane and the POSIX lane agree.
   */
  it('matches sandbox markers regardless of path separator', () => {
    expect(isVerificationSandbox('C:\\repo\\node_modules\\pkg')).toBe(true);
    expect(isVerificationSandbox('/repo/node_modules/pkg')).toBe(true);
    expect(isVerificationSandbox('C:\\tmp\\verify-sandbox')).toBe(true);
    expect(isVerificationSandbox('/tmp/verify-sandbox')).toBe(true);
    expect(isVerificationSandbox('C:\\repo\\.alix\\verify')).toBe(true);
  });

  it('still refuses a Windows temp dir and a Windows workspace', () => {
    expect(isVerificationSandbox('C:\\Users\\x\\AppData\\Local\\Temp\\alix-verify-1')).toBe(false);
    expect(isVerificationSandbox('C:\\Users\\x\\Projects\\Monolith')).toBe(false);
  });
});
