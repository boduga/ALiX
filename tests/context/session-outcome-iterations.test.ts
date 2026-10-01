/**
 * One iteration count, not three.
 *
 * T3 finding 7 recorded the same quantity arriving from three emitters with
 * three answers. Measured across the recorded sessions on this branch: mean
 * 3.7 (`agent.decision`) / 4.3 (`contextPressure.totalIterations`) / 1.8
 * (`agent.message` tally), with 52 of 68 sessions disagreeing.
 *
 * The recount was not merely a different number — it was structurally
 * incapable of agreeing. `agent.message` fires for assistant prose, so a
 * tool-only turn contributes zero while a turn that streams several messages
 * contributes several. The loop already records the true count on
 * `session.ended`; re-deriving it from a proxy event is what created the
 * disagreement.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractSessionOutcome } from '../../src/context/session-outcome.js';

let sessionDir: string;

function write(events: Array<Record<string, unknown>>): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));
}

const msg = (text: string) => ({ type: 'agent.message', payload: { text } });
const usage = (inputTokens: number, outputTokens: number) => ({
  type: 'model.usage',
  payload: { inputTokens, outputTokens },
});

describe('extractSessionOutcome iteration count', () => {
  beforeEach(() => { sessionDir = mkdtempSync(join(tmpdir(), 'outcome-')); });
  afterEach(() => { rmSync(sessionDir, { recursive: true, force: true }); });

  it('prefers the loop-reported count over the message tally', async () => {
    // 4 turns, but the loop emitted prose on only 1 of them. The tally says 1;
    // the loop says 4. The loop is right.
    write([
      msg('thinking'),
      { type: 'session.ended', payload: { reason: 'completed', contextPressure: { totalIterations: 4 } } },
    ]);
    assert.equal((await extractSessionOutcome(sessionDir)).iterations, 4);
  });

  it('is not confused by session.ended arriving last', async () => {
    // Ordering is the whole trap: a single pass would count the messages and
    // then have to un-count them.
    write([
      msg('one'), msg('two'),
      { type: 'session.ended', payload: { reason: 'completed', contextPressure: { totalIterations: 7 } } },
    ]);
    assert.equal((await extractSessionOutcome(sessionDir)).iterations, 7);
  });

  it('falls back to the tally for an older trace with no reported count', async () => {
    write([
      msg('a'), msg('b'), msg('c'),
      { type: 'session.ended', payload: { reason: 'completed' } },
    ]);
    assert.equal((await extractSessionOutcome(sessionDir)).iterations, 3);
  });

  it('falls back rather than reporting a confident zero', async () => {
    // `totalIterations: 0` is "not recorded" in every real path. Reading it as
    // authoritative would zero out a session that plainly ran — the
    // absence-as-evidence failure this change is about.
    write([
      msg('a'), msg('b'),
      { type: 'session.ended', payload: { reason: 'completed', contextPressure: { totalIterations: 0 } } },
    ]);
    assert.equal((await extractSessionOutcome(sessionDir)).iterations, 2);
  });

  it('falls back on a missing contextPressure entirely', async () => {
    write([msg('a'), { type: 'session.ended', payload: { reason: 'completed' } }]);
    assert.equal((await extractSessionOutcome(sessionDir)).iterations, 1);
  });

  it('ignores a non-integer or negative reported count', async () => {
    for (const bogus of [-3, 1.5, Number.NaN]) {
      write([
        msg('a'), msg('b'),
        { type: 'session.ended', payload: { reason: 'completed', contextPressure: { totalIterations: bogus } } },
      ]);
      assert.equal((await extractSessionOutcome(sessionDir)).iterations, 2, `totalIterations=${bogus}`);
    }
  });

  it('still derives success, reason, and tokens unchanged', async () => {
    write([
      msg('a'),
      usage(100, 20), usage(50, 10),
      {
        type: 'session.ended',
        payload: {
          reason: 'max_iterations',
          contextPressure: { totalIterations: 9 },
          primaryCount: 2, testCount: 1, supportingCount: 3,
        },
      },
    ]);
    const outcome = await extractSessionOutcome(sessionDir);
    assert.equal(outcome.success, false);
    assert.equal(outcome.reason, 'max_iterations');
    assert.equal(outcome.totalTokens, 180);
    assert.equal(outcome.primaryCount, 2);
    assert.equal(outcome.testCount, 1);
    assert.equal(outcome.supportingCount, 3);
    assert.equal(outcome.iterations, 9);
  });

  it('skips malformed lines instead of losing the count', async () => {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'events.jsonl'),
      [
        JSON.stringify(msg('a')),
        '{ not json',
        JSON.stringify({ type: 'session.ended', payload: { reason: 'completed', contextPressure: { totalIterations: 5 } } }),
      ].join('\n'),
    );
    assert.equal((await extractSessionOutcome(sessionDir)).iterations, 5);
  });

  it('reports zero for a session with no event log', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'outcome-empty-'));
    try {
      const outcome = await extractSessionOutcome(empty);
      assert.equal(outcome.iterations, 0);
      assert.equal(outcome.reason, 'error');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
