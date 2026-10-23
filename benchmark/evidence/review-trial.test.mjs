import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_FIXTURES, scoreReviewTrial, aggregateReviewTrials } from './review-trial.mjs';
const trial = (overrides = {}) => ({ participant: 'reviewer_01', fixtureId: 'scope-claim-v1', presentation: 'text', evidenceHash: REVIEW_FIXTURES['scope-claim-v1'].evidenceHash, answers: ['false-success', 'unverified-outcome'], startedAtMs: 100, endedAtMs: 60100, activeIntervals: [{ startMs: 100, endMs: 30100 }], waitingIntervals: [{ startMs: 30100, endMs: 60100 }], approvalTouches: 0, interruptions: 1, independentlyVerifiedSuccess: true, confidence: 1, ...overrides });
test('golden scoring and joint-coverage denominator includes failed-review time', () => {
  const result = aggregateReviewTrials([trial(), trial({ participant: 'reviewer_02', independentlyVerifiedSuccess: false, answers: ['unverified-outcome'], confidence: 0.5 })]);
  assert.equal(result.overall.activeMinutesPerVerifiedSuccess, 1);
  assert.equal(result.overall.exactAccuracy, 0.5);
  assert.equal(result.overall.missedCriticalCount, 1);
  assert.equal(result.overall.activeMs.total, 60000);
  assert.equal(result.rows[1].brierScore, 0.25);
  assert.deepEqual(result.rows[1].missedCritical, ['false-success']);
});
test('absent observations remain null; elapsed never substitutes active', () => {
  const result = aggregateReviewTrials([trial({ activeIntervals: null, waitingIntervals: null, approvalTouches: null, interruptions: null })]);
  assert.equal(result.rows[0].activeMs, null);
  assert.equal(result.rows[0].elapsedMs, 60000);
  assert.equal(result.overall.activeMs.total, null);
  assert.equal(result.overall.activeMinutesPerVerifiedSuccess, null);
  assert.equal(result.overall.jointActiveAndVerificationCoverage, 0);
});
test('source mismatch, overlap, malformed and negative observations fail closed', () => {
  for (const change of [ { evidenceHash: 'wrong' }, { activeIntervals: [{ startMs: 100, endMs: 200 }, { startMs: 150, endMs: 300 }] }, { waitingIntervals: [{ startMs: 200, endMs: 400 }] }, { endedAtMs: 99 }, { interruptions: -1 }, { approvalTouches: 0.5 }, { activeIntervals: [{ startMs: 0, endMs: 200 }] }, { confidence: 1.1 }, { answers: ['false-success', 'false-success'] }, { fixtureId: 'toString' } ]) assert.throws(() => scoreReviewTrial(trial(change)));
});
test('false positives and omitted critical risks reduce accuracy separately', () => {
  const result = scoreReviewTrial(trial({ answers: ['unverified-outcome', 'invented-risk'] }));
  assert.equal(result.recall, 0.5);
  assert.equal(result.precision, 0.5);
  assert.equal(result.falsePositives, 1);
  assert.equal(result.exactAccuracy, 0);
  assert.equal(result.missedCriticalCount, 1);
});
test('presentation uses same immutable evidence; repeats rejected', () => {
  assert.equal(scoreReviewTrial(trial({ presentation: 'diagram' })).evidenceHash, scoreReviewTrial(trial()).evidenceHash);
  assert.throws(() => aggregateReviewTrials([trial(), trial()]), /duplicate/);
  assert.equal(aggregateReviewTrials([trial({ independentlyVerifiedSuccess: null })]).overall.activeMinutesPerVerifiedSuccess, null);
});
