/** D9 R4.2: real SIGKILL durability probe for the approval/effect boundary.
 * This is a focused store-level probe, NOT a full daemon continuation end-to-end test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const storeUrl = new URL('../../src/governance/approvals/approval-store.js', import.meta.url).href;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

for (const point of ['after-consume', 'after-effect'] as const) {
  test(`D9 SIGKILL ${point}: persisted claim cannot authorize replay`, { timeout: 30000 }, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-d9-sigkill-'));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const store = new ApprovalStore(cwd); await store.load();
      const record = await store.requestOrReusePending({
        reason: 'SIGKILL durability', bindingKey: 'd9-key', requestFingerprint: 'd9-fp',
        policyRevision: 'd9-rev', capabilities: ['file.create'], workerId: 'd9-worker', workerAttempt: 1,
      });
      await store.resolve(record.id, 'approved');
      closeAllSharedLedgers();
      const marker = join(cwd, 'checkpoint');
      const effect = join(cwd, 'effect.txt');
      const code = `
        import { writeFile, appendFile } from 'node:fs/promises';
        import { ApprovalStore } from ${JSON.stringify(storeUrl)};
        const [cwd, id, marker, effect, point] = process.argv.slice(1);
        const store = new ApprovalStore(cwd); await store.load();
        const claim = await store.consumeApproved(id, 'd9-key', {workerId:'d9-worker', workerAttempt:1});
        if (!claim.consumed) process.exit(3);
        if (point === 'after-consume') {
          await writeFile(marker, 'claimed');
        } else {
          await appendFile(effect, 'sentinel\\n');
          await writeFile(marker, 'effect-applied');
        }
        setInterval(() => {}, 1000);
      `;
      child = spawn(process.execPath, ['--input-type=module', '-e', code, cwd, record.id, marker, effect, point], { stdio: 'pipe' });
      let stderr = '';
      child.stderr?.on('data', chunk => { stderr += String(chunk); });
      let ready = false;
      for (let i = 0; i < 150; i++) {
        try { await readFile(marker); ready = true; break; } catch { /* wait */ }
        if (child.exitCode !== null) break;
        await sleep(100);
      }
      assert.ok(ready, `child never reached checkpoint: ${stderr}`);
      const exited = new Promise<{signal: NodeJS.Signals | null}>((resolve, reject) => {
        child!.once('exit', (_code, signal) => resolve({signal}));
        child!.once('error', reject);
      });
      assert.equal(child.kill('SIGKILL'), true);
      assert.equal((await exited).signal, 'SIGKILL');
      child = undefined;
      closeAllSharedLedgers();
      const restarted = new ApprovalStore(cwd); await restarted.load();
      assert.equal(restarted.get(record.id)?.status, 'consumed');
      assert.equal(restarted.get(record.id)?.executionOutcome, 'pending');
      assert.equal((await restarted.consumeApproved(record.id, 'd9-key', {workerId:'d9-worker', workerAttempt:1})).consumed, false);
      assert.equal(await restarted.markExecutionUnverified(record.id), 'unverified');
      await restarted.load();
      assert.equal(restarted.get(record.id)?.executionOutcome, 'unverified');
      const observed = await readFile(effect, 'utf8').catch(() => '');
      assert.deepEqual(observed ? observed.trimEnd().split(String.fromCharCode(10)) : [], point === "after-effect" ? ["sentinel"] : []);
      assert.equal((await restarted.consumeApproved(record.id, 'd9-key', {workerId:'d9-worker', workerAttempt:1})).consumed, false);
      assert.equal(await readFile(effect, 'utf8').catch(() => ''), observed);
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL');
      closeAllSharedLedgers();
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
