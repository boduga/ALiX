/**
 * approval-lock-liveness.test.ts — Real OS-process liveness and mutual-exclusion
 * tests for ApprovalStoreLock. Each case spawns independent processes so the
 * OS-managed `flock` is held by a genuine OS identity that the test can signal
 * (SIGSTOP / SIGCONT / SIGKILL) or kill, then asserts the exclusivity and
 * automatic-release guarantees against it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalStoreLock } from '../../src/governance/approvals/approval-store-lock.js';

const childScript = fileURLToPath(new URL('../fixtures/d9-approval-lock-child.js', import.meta.url));
const LOCK_DIR = ['.alix', 'approvals', 'approvals.lock'];
const metaPath = (cwd: string) => join(cwd, ...LOCK_DIR, 'meta.json');

type Message = { event: string; pid: number; acquired?: boolean };

function host(cwd: string, mode: string, budget?: number, backend?: 'flock' | 'mkdir') {
  const child = spawn(process.execPath, [childScript, cwd, mode, String(budget ?? ''), backend ?? ''], {
    cwd, env: { PATH: process.env.PATH, HOME: cwd }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages: Message[] = [];
  let output = '';
  child.stdout!.on('data', d => { output += String(d); });
  child.stderr!.on('data', d => { output += String(d); });
  child.on('message', m => messages.push(m as Message));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  async function wait(event: string, timeoutMs = 15_000): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = messages.find(m => m.event === event);
      if (m) { assert.equal(m.pid, child.pid); return m; }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Host died before ${event}: ${output}`);
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`Host timeout at ${event}: ${output}`);
  }
  return { child, wait, exited,
    go: () => child.send({ release: true }),
    stop: () => child.kill('SIGSTOP'),
    cont: () => child.kill('SIGCONT'),
    kill: () => child.kill('SIGKILL') };
}

async function workspace() {
  return mkdtemp(join(tmpdir(), 'aplock-proc-'));
}
async function cleanup(cwd: string, hosts: ReturnType<typeof host>[]) {
  for (const h of hosts) if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill('SIGKILL');
  for (const h of hosts) await h.exited.catch(() => {});
  await rm(cwd, { recursive: true, force: true });
}

test('a paused (SIGSTOP) holder keeps its lock — a contender never steals it', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    const holder = host(cwd, 'hold'); hosts.push(holder);
    const held = await holder.wait('held');
    assert.equal(held.acquired, true);

    // Freeze the holder mid-hold. SIGSTOP does not close its fd, so the
    // kernel keeps the flock. A contender must observe the lock held — never
    // steal it on any timer.
    holder.stop();
    await new Promise(r => setTimeout(r, 200));
    const contender = new ApprovalStoreLock(cwd);
    assert.equal(await contender.acquire(400), false, 'a paused live owner must not be stolen');

    // Resume, release, and the lock is genuinely free.
    holder.cont();
    holder.go(); await holder.wait('released');
    assert.equal(await contender.acquire(2_000), true);
    contender.release();
  } finally { await cleanup(cwd, hosts); }
});

test('a SIGKILLed holder releases immediately; a successor needs no stale recovery', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    const holder = host(cwd, 'hold'); hosts.push(holder);
    const held = await holder.wait('held');
    assert.equal(held.acquired, true);

    holder.kill();
    assert.deepEqual(await holder.exited, { code: null, signal: 'SIGKILL' });

    const started = Date.now();
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(2_000), true, 'the OS must release the lock on SIGKILL');
    assert.ok(Date.now() - started < 1_000, 'recovery must not wait for any age or reclaim step');
    successor.release();
  } finally { await cleanup(cwd, hosts); }
});

test('concurrent contenders never overlap inside the critical section', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    const count = 6;
    for (let i = 0; i < count; i++) hosts.push(host(cwd, 'mutate'));
    await Promise.all(hosts.map(h => h.wait('mutate-acquired')));
    await Promise.all(hosts.map(h => h.wait('mutated')));
    for (const h of hosts) assert.deepEqual(await h.exited, { code: 0, signal: null });
    const value = parseInt((await readFile(join(cwd, 'counter.txt'), 'utf8')).trim(), 10);
    assert.equal(value, count, 'mutual exclusion must serialize the read-modify-write');
  } finally { await cleanup(cwd, hosts); }
});

test('a daemon restart acquires immediately with no stale-lock recovery', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    // First daemon acquires and is killed without releasing.
    const daemon = host(cwd, 'hold'); hosts.push(daemon);
    assert.equal((await daemon.wait('held')).acquired, true);
    daemon.kill();
    assert.deepEqual(await daemon.exited, { code: null, signal: 'SIGKILL' });

    // A restarted daemon must acquire immediately — there is no orphan lock
    // state to detect, probe, or reclaim.
    const restarted = host(cwd, 'hold'); hosts.push(restarted);
    const held = await restarted.wait('held', 3_000);
    assert.equal(held.acquired, true, 'the restarted daemon must acquire without recovery');
    restarted.go(); await restarted.wait('released');
  } finally { await cleanup(cwd, hosts); }
});

test('mkdir fallback: a dead owner is reclaimed immediately, and concurrent reclaimers never double-steal', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    // Seed a stale mkdir lock: a valid, dead PID with a recent timestamp.
    const lockDir = join(cwd, ...LOCK_DIR);
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, 'meta.json'), JSON.stringify({
      pid: 2 ** 30, token: 'dead-owner', acquiredAt: new Date().toISOString(),
    }));
    const count = 6;
    for (let i = 0; i < count; i++) hosts.push(host(cwd, 'mutate', undefined, 'mkdir'));
    await Promise.all(hosts.map(h => h.wait('mutate-acquired')));
    await Promise.all(hosts.map(h => h.wait('mutated')));
    for (const h of hosts) assert.deepEqual(await h.exited, { code: 0, signal: null });
    const value = parseInt((await readFile(join(cwd, 'counter.txt'), 'utf8')).trim(), 10);
    assert.equal(value, count, 'an atomic reclaim must not let two hosts both enter the critical section');
  } finally { await cleanup(cwd, hosts); }
});

test('mkdir fallback: a metadata-less lock is never stolen by age', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    const lockDir = join(cwd, ...LOCK_DIR);
    await mkdir(lockDir, { recursive: true });
    assert.equal(await new ApprovalStoreLock(cwd, { backend: 'mkdir' }).acquire(200), false);
    const old = new Date(Date.now() - 70_000);
    await utimes(lockDir, old, old);
    const successor = new ApprovalStoreLock(cwd, { backend: 'mkdir' });
    assert.equal(await successor.acquire(250), false, 'age cannot prove an owner is dead');
    successor.release();
  } finally { await cleanup(cwd, hosts); }
});
