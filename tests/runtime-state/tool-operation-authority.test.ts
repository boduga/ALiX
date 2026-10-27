import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolOperationAuthority, toolOperationId } from '../../src/runtime-state/runtime/tool-operation-authority.js';

describe('durable tool operation authority', () => {
  it('blocks ambiguous replay across instances and preserves identity', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-tool-op-'));
    try {
      const id = toolOperationId('run-1', 'logical-effect-1');
      assert.equal(id, toolOperationId('run-1', 'logical-effect-1'));
      assert.notEqual(id, toolOperationId('run-2', 'logical-effect-1'));
      const first = new ToolOperationAuthority(cwd);
      assert.equal(first.claim(id, 'hash-1').kind, 'execute');
      const recovered = new ToolOperationAuthority(cwd);
      assert.equal(recovered.claim(id, 'hash-1').kind, 'unknown');
      assert.equal(recovered.claim(id, 'hash-2').kind, 'mismatch');
      assert.equal(first.finish(id, 'hash-1', 'succeeded', { ok: true }).state, 'succeeded');
      assert.equal(recovered.claim(id, 'hash-1').kind, 'completed');
      assert.throws(() => first.finish(id, 'hash-1', 'failed', null));
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
  it('competing claims never both execute', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-tool-op-race-'));
    try {
      const id = toolOperationId('scope', 'effect');
      const a = new ToolOperationAuthority(cwd);
      const b = new ToolOperationAuthority(cwd);
      assert.deepEqual([a.claim(id, 'hash').kind, b.claim(id, 'hash').kind], ['execute', 'unknown']);
      assert.equal(b.finish(id, 'hash', 'failed', 'error').state, 'failed');
      assert.equal(a.claim(id, 'hash').kind, 'completed');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
