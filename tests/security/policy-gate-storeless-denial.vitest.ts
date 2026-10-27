/** LEAN-G01 isolated real PolicyGate denial; no tool invocation or side effect. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PolicyGate } from '../../src/governance/policy/policy-gate.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';

const config = {
  ...DEFAULT_CONFIG,
  permissions: { ...DEFAULT_CONFIG.permissions, sessionMode: 'ask' as const, default: 'ask' as const, tools: { 'file.create': 'ask' as const } },
};

describe('LEAN-G01 actual PolicyGate with no approval store', () => {
  it('denies ask-mode file.create with explicit missing-store reason and no target file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-g01-gate-'));
    const path = join(cwd, 'must-not-exist.txt');
    try {
      const gate = new PolicyGate(config);
      const decision = await gate.evaluateToolCall({
        requestId: 'storeless-tool', toolName: 'file.create', capability: 'file.create',
        args: { path, content: 'never written' }, cwd, sessionMode: 'ask', source: 'tool',
      });
      expect(decision.decision).toBe('deny');
      expect(decision.matchedRuleId).toBe('approval-store-missing');
      await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
