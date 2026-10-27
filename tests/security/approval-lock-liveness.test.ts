/**
 * approval-lock-liveness.test.ts — Real OS-process liveness and mutual-exclusion
 * tests for ApprovalStoreLock. Each case spawns independent processes so the
 * recorded `pid` is a genuine OS identity, then asserts the staleness decision
 * and the atomic-reclaim guarantee against it.
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

function host(cwd: string, mode: string, budget?: number) {
  const child = spawn(process.execPath, [childScript, cwd, mode, String(budget ?? '')], {
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
    kill: () => child.kill('SIGKILL') };
}

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'aplock-proc-'));
  return cwd;
}
async function cleanup(cwd: string, hosts: ReturnType<typeof host>[]) {
  for (const h of hosts) if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill('SIGKILL');
  for (const h of hosts) await h.exited.catch(() => {});
  await rm(cwd, { recursive: true, force: true });
}

test('live holder older than the stale ceiling is never stolen', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    const holder = host(cwd, 'hold'); hosts.push(holder);
    const held = await holder.wait('held');
    assert.equal(held.acquired, true);
    // Age the metadata out while the real owner stays alive: the stale ceiling
    // alone must not justify stealing a live lock.
    const meta = JSON.parse(await readFile(metaPath(cwd), 'utf8')) as { pid: number; token: string; acquiredAt: string };
    await writeFile(metaPath(cwd), JSON.stringify({ ...meta, acquiredAt: new Date(Date.now() - 120_000).toISOString() }));
    const contender = new ApprovalStoreLock(cwd);
    assert.equal(await contender.acquire(400), false, 'a provably-alive owner must not be stolen on age alone');
    // The holder is still alive and still owns the lock.
    assert.equal(holder.child.kill(0), true);
    holder.go(); await holder.wait('released');
    // Once released, the lock is genuinely free and acquirable.
    assert.equal(await contender.acquire(2_000), true);
    contender.release();
  } finally { await cleanup(cwd, hosts); }
});

test('dead PID with a young lock is reclaimed immediately', { timeout: 30_000 }, async () => {
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
    assert.equal(await successor.acquire(2_000), true, 'a dead owner must not hold the lock');
    assert.ok(Date.now() - started < 1_000, 'recovery must not wait for the age ceiling');
    successor.release();
  } finally { await cleanup(cwd, hosts); }
});

test('concurrent hosts never overlap inside the critical section', { timeout: 30_000 }, async () => {
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

test('concurrent reclaimers of one dead-owner lock never double-steal', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    // Seed a stale lock: a valid, dead PID with a recent timestamp. Several
    // hosts must all observe it stale and race to reclaim it atomically.
    const lockDir = join(cwd, ...LOCK_DIR);
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, 'meta.json'), JSON.stringify({
      pid: 2 ** 30, token: 'dead-owner', acquiredAt: new Date().toISOString(),
    }));
    const count = 6;
    for (let i = 0; i < count; i++) hosts.push(host(cwd, 'mutate'));
    await Promise.all(hosts.map(h => h.wait('mutate-acquired')));
    await Promise.all(hosts.map(h => h.wait('mutated')));
    for (const h of hosts) assert.deepEqual(await h.exited, { code: 0, signal: null });
    const value = parseInt((await readFile(join(cwd, 'counter.txt'), 'utf8')).trim(), 10);
    assert.equal(value, count, 'an atomic reclaim must not let two hosts both enter the critical section');
  } finally { await cleanup(cwd, hosts); }
});


test('a metadata-less orphan ages out but a young live writer does not', { timeout: 30_000 }, async () => {
  const cwd = await workspace();
  const hosts: ReturnType<typeof host>[] = [];
  try {
    const lockDir = join(cwd, ...LOCK_DIR);
    await mkdir(lockDir, { recursive: true });
    // Young: respect the writer's mkdir→write window.
    assert.equal(await new ApprovalStoreLock(cwd).acquire(200), false);
    // Orphan: age the directory out and the lock is reclaimable.
    const old = new Date(Date.now() - 70_000);
    await utimes(lockDir, old, old);
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(2_000), true);
    successor.release();
  } finally { await cleanup(cwd, hosts); }
});
