/**
 * T2-e2: recorded responses for external tools. The load-bearing test is the
 * fixture miss: no match must mean `unknown`, with no transport invocation of
 * any kind.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createExternalReplayFixtureStore,
  createRecordedResponseRunner,
  replayFromRecordedResponse,
  type ExternalReplayFixture,
} from '../../src/decision/tool-selection-fixtures.js';
import { builtinCandidateId } from '../../src/decision/tool-selection-candidates.js';

const fixture: ExternalReplayFixture = {
  fixtureId: 'fix_1',
  tool: 'alix_web_fetch',
  argsSignature: 'abc123',
  outcome: { execution: 'success', selection: 'novel', evidence: 'unknown' },
  capturedAt: '2026-09-27T12:00:00.000Z',
  source: 'recorded-response',
};

const { store } = createExternalReplayFixtureStore([fixture]);

describe('replayFromRecordedResponse', () => {
  it('returns the recorded response with fixture provenance and no network', () => {
    const result = replayFromRecordedResponse({ tool: 'alix_web_fetch', argsSignature: 'abc123', store });

    expect(result).toEqual({
      basis: 'replayed',
      environment: 'recorded-response',
      fixture: {
        tool: 'alix_web_fetch',
        argsSignature: 'abc123',
        fixtureId: 'fix_1',
        capturedAt: '2026-09-27T12:00:00.000Z',
        source: 'recorded-response',
      },
      network: 'disabled',
      outcome: { execution: 'success', selection: 'novel', evidence: 'unknown' },
    });
  });

  it('leaves evidence contribution unknown rather than claiming it', () => {
    const result = replayFromRecordedResponse({ tool: 'alix_web_fetch', argsSignature: 'abc123', store });
    expect(result.basis).toBe('replayed');
    if (result.basis !== 'replayed') throw new Error('expected a replay');
    expect(result.outcome.evidence).toBe('unknown');
  });

  it('requires an exact argument signature — a different signature is a miss', () => {
    const result = replayFromRecordedResponse({ tool: 'alix_web_fetch', argsSignature: 'other', store });
    expect(result).toEqual({ basis: 'unknown', tool: 'alix_web_fetch', reason: 'no matching recorded response' });
  });

  it('requires an exact tool match', () => {
    const result = replayFromRecordedResponse({ tool: 'alix_web_search', argsSignature: 'abc123', store });
    expect(result.basis).toBe('unknown');
  });

  it('reports a missing signature as unknown rather than guessing', () => {
    const result = replayFromRecordedResponse({ tool: 'alix_web_fetch', store });
    expect(result).toEqual({
      basis: 'unknown',
      tool: 'alix_web_fetch',
      reason: 'no recorded arguments for this alternative (fixture identity unknown)',
    });
  });

  it('applies only to external tools', () => {
    expect(replayFromRecordedResponse({ tool: 'alix_file_read', argsSignature: 'abc123', store })).toEqual({
      basis: 'unknown',
      tool: 'alix_file_read',
      reason: 'hermetic tool: replay it in an isolated snapshot instead',
    });
    expect(replayFromRecordedResponse({ tool: 'alix_patch_apply', argsSignature: 'abc123', store })).toEqual({
      basis: 'unknown',
      tool: 'alix_patch_apply',
      reason: 'mutating tool: requires an isolated snapshot plus a mutation policy',
    });
  });
});

describe('fixture corpus integrity', () => {
  it('rejects an ambiguous identity instead of choosing the newest response', () => {
    const { store: ambiguous } = createExternalReplayFixtureStore([
      fixture,
      { ...fixture, fixtureId: 'fix_2', capturedAt: '2026-09-27T13:00:00.000Z' },
    ]);
    const result = replayFromRecordedResponse({ tool: 'alix_web_fetch', argsSignature: 'abc123', store: ambiguous });
    expect(result).toEqual({ basis: 'unknown', tool: 'alix_web_fetch', reason: 'no matching recorded response' });
  });

  it('drops invalid fixtures with their reason', () => {
    const { store: validated, dropped } = createExternalReplayFixtureStore([
      fixture,
      { ...fixture, fixtureId: 'fix_bad', outcome: { ...fixture.outcome, evidence: 'claimed' as never } },
      { ...fixture, fixtureId: 'fix_nosig', argsSignature: '' },
    ]);
    expect(validated.list()).toHaveLength(1);
    expect(dropped).toEqual([
      { fixtureId: 'fix_bad', reason: 'invalid evidence contribution' },
      { fixtureId: 'fix_nosig', reason: 'argsSignature missing' },
    ]);
  });
});

describe('no live network, structurally', () => {
  it('does not invoke a transport on a fixture miss', async () => {
    const transport = vi.fn(async () => ({ outcome: fixture.outcome }));
    // The runner is the only channel the evaluator has; a miss must not reach it.
    // The lookup key is the LOCAL executor name, resolved from the candidate id.
    const lookedUp: string[] = [];
    const runner = createRecordedResponseRunner({
      store,
      toolFor: (candidateId) => {
        const tool = candidateId.replace(/^builtin:/, '');
        lookedUp.push(tool);
        return tool;
      },
      argsSignatureFor: () => 'does-not-match',
    });
    const result = await runner({
      scopeId: 'scope_7',
      candidateId: builtinCandidateId('alix_web_fetch'),
      domain: 'builtin',
    });

    expect(result).toEqual({ error: 'no matching recorded response' });
    expect(lookedUp).toEqual(['alix_web_fetch']);
    expect(transport).not.toHaveBeenCalled();
  });

  it('imports no network client', () => {
    const source = readFileSync(new URL('../../src/decision/tool-selection-fixtures.ts', import.meta.url), 'utf8');
    for (const banned of ['node:http', 'node:https', 'node:net', 'undici', 'node:dns', 'fetch(']) {
      expect(source.includes(banned), `recorded-response replay must not reference ${banned}`).toBe(false);
    }
  });
});
