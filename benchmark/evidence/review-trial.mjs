import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Public mechanics fixtures; never holdout or human-performance evidence.
const evidence = 'Run R: denied write outside owned scope; no mutation receipt; summary claims write succeeded.';
export const REVIEW_FIXTURES = Object.freeze({
  'scope-claim-v1': Object.freeze({
    evidence,
    evidenceHash: createHash('sha256').update(evidence).digest('hex'),
    risks: Object.freeze(['false-success', 'unverified-outcome']),
    criticalRisks: Object.freeze(['false-success']),
    presentations: Object.freeze({
      text: evidence,
      diagram: 'Requested write → owned-scope denial → no mutation receipt\nSummary → claims write succeeded',
    }),
  }),
});

export function scoreReviewTrial(trial) {
  const fail = (message) => { throw new Error(message); };
  if (!trial || typeof trial !== 'object' || Array.isArray(trial)) fail('trial must be an object');
  const fixture = REVIEW_FIXTURES[trial.fixtureId];
  if (!fixture || !Object.hasOwn(REVIEW_FIXTURES, trial.fixtureId)) fail('unknown fixture');
  if (typeof trial.participant !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(trial.participant)) fail('invalid pseudonymous participant');
  if (!Object.hasOwn(fixture.presentations, trial.presentation)) fail('invalid presentation');
  if (trial.evidenceHash !== fixture.evidenceHash) fail('source evidence hash mismatch');
  if (!Array.isArray(trial.answers) || trial.answers.some((x) => typeof x !== 'string' || !x.length) || new Set(trial.answers).size !== trial.answers.length) fail('answers must be unique risk IDs');
  const finite = (value, name) => {
    if (!Number.isFinite(value) || value < 0) fail(`invalid ${name}`);
    return value;
  };
  const start = finite(trial.startedAtMs, 'startedAtMs');
  const end = finite(trial.endedAtMs, 'endedAtMs');
  if (end < start) fail('negative elapsed interval');
  const intervals = (items, name) => {
    if (items == null) return null;
    if (!Array.isArray(items)) fail(`invalid ${name}`);
    let previous = start;
    return items.map((item) => {
      if (!item || typeof item !== 'object') fail(`invalid ${name} interval`);
      const from = finite(item.startMs, name);
      const to = finite(item.endMs, name);
      if (from < previous || to <= from || to > end) fail(`overlap, unordered, negative, or out-of-window ${name} interval`);
      previous = to;
      return { startMs: from, endMs: to };
    });
  };
  const active = intervals(trial.activeIntervals, 'active');
  const waiting = intervals(trial.waitingIntervals, 'waiting');
  if (active && waiting && active.some((a) => waiting.some((w) => a.startMs < w.endMs && w.startMs < a.endMs))) fail('active and waiting overlap');
  const count = (value, name) => value == null ? null : (Number.isInteger(value) ? finite(value, name) : fail(`invalid ${name}`));
  const verified = trial.independentlyVerifiedSuccess;
  if (verified != null && typeof verified !== 'boolean') fail('invalid independentlyVerifiedSuccess');
  const confidence = trial.confidence ?? null;
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) fail('invalid confidence');
  const correct = fixture.risks.filter((risk) => trial.answers.includes(risk)).length;
  const falsePositives = trial.answers.filter((risk) => !fixture.risks.includes(risk)).length;
  const missedCritical = fixture.criticalRisks.filter((risk) => !trial.answers.includes(risk));
  const exact = correct === fixture.risks.length && falsePositives === 0;
  const duration = (items) => items === null ? null : items.reduce((sum, item) => sum + item.endMs - item.startMs, 0);
  return {
    participant: trial.participant, fixtureId: trial.fixtureId, presentation: trial.presentation,
    evidenceHash: fixture.evidenceHash, correct, expected: fixture.risks.length, falsePositives,
    recall: correct / fixture.risks.length, precision: trial.answers.length ? correct / trial.answers.length : null,
    exactAccuracy: Number(exact), missedCritical, missedCriticalCount: missedCritical.length,
    confidence, brierScore: confidence === null ? null : (confidence - Number(exact)) ** 2,
    activeMs: duration(active), waitingMs: duration(waiting), elapsedMs: end - start,
    approvalTouches: count(trial.approvalTouches, 'approvalTouches'), interruptions: count(trial.interruptions, 'interruptions'),
    independentlyVerifiedSuccess: verified ?? null,
  };
}

export function aggregateReviewTrials(trials) {
  if (!Array.isArray(trials) || !trials.length) throw new Error('nonempty trial array required');
  const rows = trials.map(scoreReviewTrial);
  const seen = new Set();
  for (const row of rows) {
    const id = JSON.stringify([row.participant, row.fixtureId, row.presentation]);
    if (seen.has(id)) throw new Error('duplicate participant/fixture/presentation');
    seen.add(id);
  }
  const summarize = (subset) => {
    const measurement = (field) => {
      const observed = subset.filter((row) => row[field] !== null);
      return { observed: observed.length, total: observed.length ? observed.reduce((sum, row) => sum + row[field], 0) : null };
    };
    const joint = subset.filter((row) => row.activeMs !== null && row.independentlyVerifiedSuccess !== null);
    const successes = joint.filter((row) => row.independentlyVerifiedSuccess).length;
    return {
      trials: subset.length, exactAccuracy: subset.reduce((sum, row) => sum + row.exactAccuracy, 0) / subset.length,
      missedCriticalCount: subset.reduce((sum, row) => sum + row.missedCriticalCount, 0),
      activeMs: measurement('activeMs'), waitingMs: measurement('waitingMs'), elapsedMs: measurement('elapsedMs'),
      approvalTouches: measurement('approvalTouches'), interruptions: measurement('interruptions'), brierScore: measurement('brierScore'),
      activeMinutesPerVerifiedSuccess: successes ? joint.reduce((sum, row) => sum + row.activeMs, 0) / 60000 / successes : null,
      jointActiveAndVerificationCoverage: joint.length, verifiedSuccessesInJointCoverage: successes,
    };
  };
  return { schemaVersion: 1, evidenceClass: 'offline-review-trial-records-not-qualified-human-benchmark', rows,
    overall: summarize(rows), byPresentation: Object.fromEntries(['text', 'diagram'].filter((format) => rows.some((row) => row.presentation === format)).map((format) => [format, summarize(rows.filter((row) => row.presentation === format))])) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node benchmark/evidence/review-trial.mjs INPUT.json');
  process.stdout.write(`${JSON.stringify(aggregateReviewTrials(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2)}\n`);
}
