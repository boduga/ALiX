/** Real OS host exercising ApprovalStoreLock liveness and mutual exclusion.
 * No sockets, providers, or model calls. Each invocation is a separate process
 * so the OS-managed lock and (for the mkdir fallback) `process.pid` are genuine
 * OS identities the parent can probe or signal.
 */
import { ApprovalStoreLock } from '../../src/governance/approvals/approval-store-lock.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [cwd, mode, budget, backend] = process.argv.slice(2);
if (!process.send || !cwd || !mode) throw new Error('Expected isolated lock host');

function send(event: string, data: object = {}) { process.send!({ event, pid: process.pid, ...data }); }

const lock = new ApprovalStoreLock(cwd, backend === 'mkdir' || backend === 'flock' ? { backend } : undefined);

void (async () => {
  if (mode === 'hold') {
    // Acquire and hold until the parent releases us, so the parent can probe a
    // REAL live holder (SIGSTOP) or kill us (SIGKILL). The interval keeps the
    // event loop (and the process) alive.
    const acquired = await lock.acquire(5_000);
    send('held', { acquired });
    if (!acquired) { process.disconnect!(); return; }
    process.once('message', () => { lock.release(); send('released'); process.disconnect!(); });
    setInterval(() => {}, 1000);
  } else if (mode === 'contend') {
    // Try to acquire within a short budget; report the verdict.
    const acquired = await lock.acquire(Number(budget ?? '300'));
    send('contended', { acquired });
    if (acquired) lock.release();
    process.disconnect!();
  } else if (mode === 'mutate') {
    // Critical-section read-modify-write. A short sleep widens the overlap so a
    // broken lock (two hosts inside at once) yields a lost update and a final
    // counter less than the number of hosts.
    const acquired = await lock.acquire(10_000);
    send('mutate-acquired', { acquired });
    if (!acquired) { process.disconnect!(); return; }
    const counter = join(cwd, 'counter.txt');
    const current = existsSync(counter) ? parseInt(readFileSync(counter, 'utf8') || '0', 10) : 0;
    await new Promise(r => setTimeout(r, 25));
    writeFileSync(counter, String(current + 1));
    lock.release();
    send('mutated');
    process.disconnect!();
  } else {
    throw new Error(`Unknown lock host mode: ${mode}`);
  }
})();
