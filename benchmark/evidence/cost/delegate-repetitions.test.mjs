/**
 * Repetition summarization is the Gate B honesty mechanism: it must never turn a
 * drifting stratum into a confident point estimate, and it must never report an
 * undefined cost-per-success as zero or infinity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "./summarize-delegate-repetitions.mjs";

const strata = ["multi-file-fix", "verification-repair", "capability-mix", "tool-failure-recovery"];

/** Build a sweep-shaped run where each stratum gets `v/n` and a known cost. */
function run({ outcomes, costUsd = 1, provider = "openai", model = "gpt-4o" }) {
  const perStratum = {};
  for (const s of strata) {
    const [v, n] = outcomes[s] ?? [0, 0];
    perStratum[s] = { verifiedSuccesses: v, cases: n, costUsd };
  }
  return { provider, model, completeness: "complete", perStratum, totals: { costUsd, inputTokens: 10, outputTokens: 1 } };
}

test("a stratum that agrees across repetitions is stable with a pooled figure", () => {
  const a = run({ outcomes: { "tool-failure-recovery": [1, 2] } });
  const b = run({ outcomes: { "tool-failure-recovery": [1, 2] } });
  const s = summarize([a, b]).perStratum["tool-failure-recovery"];
  assert.equal(s.stable, true);
  assert.deepEqual(s.perRepetition, ["1/2", "1/2"]);
  assert.equal(s.verifiedSuccesses, 2);
  assert.equal(s.costPerVerifiedSuccessUsd, 1); // (1+1) / 2 successes
  assert.equal(s.note, null);
});

test("a stratum that drifts across repetitions is UNSTABLE, not averaged into a point estimate", () => {
  const a = run({ outcomes: { "multi-file-fix": [2, 2] } });
  const b = run({ outcomes: { "multi-file-fix": [1, 2] } });
  const s = summarize([a, b]).perStratum["multi-file-fix"];
  assert.equal(s.stable, false);
  assert.deepEqual(s.perRepetition, ["2/2", "1/2"]);
  assert.match(s.note, /UNSTABLE/);
  assert.match(s.note, /single run is not a point estimate/);
});

test("0 verified successes gives a null cost-per-success with an explicit note, never 0 or Infinity", () => {
  const a = run({ outcomes: { "capability-mix": [0, 3] } });
  const b = run({ outcomes: { "capability-mix": [0, 3] } });
  const s = summarize([a, b]).perStratum["capability-mix"];
  assert.equal(s.costPerVerifiedSuccessUsd, null);
  assert.notEqual(s.costPerVerifiedSuccessUsd, 0);
  assert.match(s.note, /undefined, not infinite and not zero/);
});

test("an unpriced repetition makes the stratum cost unknown rather than partial", () => {
  const a = run({ outcomes: { "tool-failure-recovery": [1, 2] }, costUsd: 1 });
  const b = run({ outcomes: { "tool-failure-recovery": [1, 2] }, costUsd: null });
  const s = summarize([a, b]).perStratum["tool-failure-recovery"];
  assert.equal(s.costUsd, null);
  assert.equal(s.costPerVerifiedSuccessUsd, null);
});

test("a mixed completeness across repetitions is reported partial, not complete", () => {
  const a = run({ outcomes: {} });
  const b = { ...run({ outcomes: {} }), completeness: "partial" };
  assert.equal(summarize([a, b]).completeness, "partial");
});
