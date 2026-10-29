import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeWithEffectJournal, readEffectRecord } from '../../src/capabilities/tools/effect-journal.js';
import type { ToolCallRequest } from '../../src/capabilities/tools/types.js';

function request(effect: string): ToolCallRequest {
  return { toolCallId: 'sigkill', name: 'shell.run', args: { command: `printf applied > ${JSON.stringify(effect)}` } };
}

function runCrashChild(cwd: string, effect: string): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const moduleUrl = new URL('../../src/capabilities/tools/effect-journal.js', import.meta.url).href;
  const code = `
    import { writeFile } from 'node:fs/promises';
    import { executeWithEffectJournal } from ${JSON.stringify(moduleUrl)};
    const [cwd,effect] = process.argv.slice(1);
    const request = { toolCallId:'child', name:'shell.run', args:{ command:'printf applied > '+JSON.stringify(effect) } };
    await executeWithEffectJournal(cwd, request, async () => { await writeFile(effect, 'applied'); return {kind:'success',output:'ok'}; }, {
      onPoint(point) { if (point === 'after_adapter') process.kill(process.pid, 'SIGKILL'); }
    });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, cwd, effect], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      if (exitCode !== null && exitCode !== 0) reject(new Error(`child exit ${exitCode}: ${stderr}`));
      else resolve({ code: exitCode, signal });
    });
  });
}

describe('D9 effect journal fresh-process crash recovery', () => {
  it('SIGKILL after applied effect but before terminal receipt quarantines exact replay', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-effect-kill-'));
    try {
      const effect = join(cwd, 'effect.txt');
      const req = request(effect);
      const stopped = await runCrashChild(cwd, effect);
      assert.equal(stopped.code, null);
      assert.equal(stopped.signal, 'SIGKILL');
      assert.equal(await readFile(effect, 'utf8'), 'applied');
      assert.equal(readEffectRecord(cwd, req)?.state, 'started_unknown');

      let replayCalls = 0;
      const replay = await executeWithEffectJournal(cwd, req, async () => {
        replayCalls++;
        return { kind: 'success', output: 'duplicate' };
      });
      assert.equal(replay.kind, 'error');
      assert.equal(replayCalls, 0);
      assert.equal(existsSync(effect), true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
