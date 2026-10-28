import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonManager } from '../../src/operations/daemon/daemon-manager.js';
import { ApprovalStoreLock } from '../../src/governance/approvals/approval-store-lock.js';

// Real independent metadata publisher, synchronized at the old process's exit.
// Only pong/liveness are simulated: this test must never signal a real PID.
for (const held of [true, false]) {
  test(`finishing stop preserves successor metadata (lifecycle lock ${held ? 'held' : 'released'})`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-stop-publish-'));
    const globalDir = join(root, '.alix');
    await mkdir(globalDir);
    const statusPath = join(globalDir, 'daemon.json'), pidPath = join(globalDir, 'daemon.pid');
    const previous = { pid: 123456789, startedAt: 'old', socketPath: join(root, 'daemon.sock'), status: 'running' as const };
    const successor = { ...previous, pid: 123456790, startedAt: 'successor' };
    await writeFile(statusPath, JSON.stringify(previous));
    await writeFile(pidPath, String(previous.pid));
    const lockModule = new URL('../../src/governance/approvals/approval-store-lock.js', import.meta.url).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { ApprovalStoreLock } from ${JSON.stringify(lockModule)};
      import { writeFile } from 'node:fs/promises';
      const lock = new ApprovalStoreLock(${JSON.stringify(root)}, {
        backend: 'mkdir', lockPath: ${JSON.stringify(join(globalDir, 'daemon-lifecycle.lock'))}
      });
      process.once('message', async () => {
        if (!await lock.acquire(3000)) throw new Error('publisher could not lock');
        await writeFile(${JSON.stringify(pidPath)}, ${JSON.stringify(String(successor.pid))});
        await writeFile(${JSON.stringify(statusPath)}, ${JSON.stringify(JSON.stringify(successor))});
        if (!${held}) lock.release();
        process.send('published');
        process.once('message', () => { lock.release(); process.disconnect(); });
      });
      process.send('ready');
    `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let output = '';
    child.stderr!.on('data', data => { output += data; });
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`publisher exit ${code}: ${output}`)));
    });
    const wait = (expected: string) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`missing ${expected}: ${output}`)), 5000);
      const listener = (message: unknown) => {
        if (message === expected) { clearTimeout(timer); child.off('message', listener); resolve(); }
      };
      child.on('message', listener);
    });
    try {
      await wait('ready');
      const published = wait('published');
      const mgr = new DaemonManager(root);
      mgr['globalDir'] = () => globalDir;
      mgr['socketPong'] = async () => ({ received: true, pid: previous.pid });
      const acquire = ApprovalStoreLock.prototype.acquire;
      t.mock.method(ApprovalStoreLock.prototype, 'acquire', async function (this: ApprovalStoreLock, timeout?: number) {
        await published; // successor publishes between old exit and stop's final publication
        return acquire.call(this, timeout);
      });
      const realKill = process.kill.bind(process);
      t.mock.method(process, 'kill', (pid: number, signal?: string | number) => {
        if (pid !== previous.pid) {
          assert.equal(signal, 0, 'other processes may only receive liveness probes');
          return realKill(pid, 0);
        }
        if (signal === 'SIGTERM') { child.send('publish'); return true; }
        assert.equal(signal, 0);
        throw Object.assign(new Error('old process exited'), { code: 'ESRCH' });
      });
      await mgr.stop();
      assert.deepEqual(JSON.parse(await readFile(statusPath, 'utf8')), successor);
      assert.equal(await readFile(pidPath, 'utf8'), String(successor.pid));
      if (held) assert.equal(JSON.parse(await readFile(join(globalDir, 'daemon-lifecycle.lock/meta.json'), 'utf8')).pid, child.pid, 'finishing stop must not steal a live successor lock');
      child.send('finish');
      await exited;
    } finally {
      t.mock.restoreAll();
      if (child.exitCode === null) { child.kill('SIGKILL'); await exited.catch(() => {}); }
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const pid of [0, -1, 1.5, Number.NaN]) {
  test(`stop refuses unsafe PID ${pid} before any process probe`, async t => {
    const mgr = new DaemonManager('/tmp');
    mgr.status = async () => ({ pid, startedAt: 'old', status: 'running' });
    t.mock.method(process, 'kill', () => { throw new Error('must never signal or probe unsafe PID'); });
    await assert.rejects(mgr.stop(), /Invalid daemon PID/);
  });
}
