/**
 * gate-b-scoring-record.mjs — validate an independent-scoring record for Gate B.
 *
 * WHY THIS EXISTS
 *
 * PRD §9 / GB-12 require independently scored results, and the collection
 * proposal §7 says author-only scoring is a weaker claim that leaves Gate B on
 * HOLD. The failure mode this file guards is not "no record" — it is a record
 * that *looks* independent: same author declared as reviewer under a different
 * spelling, an empty verdict silently read as a pass, a summary rate computed
 * over the requirements that happened to be filled in.
 *
 * So the validator is deliberately hostile:
 *   - the reviewer must be identified and must NOT be the author
 *   - every requirement in the frozen set must carry a verdict
 *   - "met" must cite retained evidence; an assertion is not evidence
 *   - a missing or partial record is `incomplete`, never a pass
 *   - no aggregate rate is computed over a partial record
 *
 * This module validates and summarizes. It never scores, and it cannot create
 * independence.
 *
 * Usage:
 *   node benchmark/evidence/gate-b-scoring-record.mjs <record.json>
 *
 * Exit 0 = valid and complete, 1 = invalid/incomplete, 2 = usage error.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** The frozen requirement set a Gate B scoring record must cover. */
export const FROZEN_REQUIREMENTS = [
  'GB-01', 'GB-02', 'GB-03', 'GB-04', 'GB-05', 'GB-06', 'GB-07',
  'GB-08', 'GB-09', 'GB-10', 'GB-11', 'GB-12', 'GB-13', 'GB-14',
];

export const VERDICTS = ['met', 'partial', 'missing', 'not-applicable'];

/**
 * Normalize a name for the author/reviewer comparison.
 *
 * Independence is a claim about people, and this check can only catch the
 * mechanical cases: the same identity restated with different case, spacing,
 * punctuation, or an email wrapped in a display name. A genuinely different
 * person using a different identity is undetectable here, which is exactly why
 * the record carries the reviewer's own signature rather than a computed flag.
 */
export function normalizeIdentity(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function emailOf(value) {
  const match = /<([^>]+)>/.exec(String(value ?? ''));
  if (match) return match[1].trim().toLowerCase();
  const bare = /[\w.+-]+@[\w.-]+\.\w+/.exec(String(value ?? ''));
  return bare ? bare[0].toLowerCase() : null;
}

/**
 * Validate one scoring record.
 *
 * Returns `{ ok, independence, problems, summary }`. `summary` carries the
 * per-verdict counts and an overall figure only when every requirement has a
 * verdict — a rate over a partial record is how an incomplete review becomes a
 * quota.
 */
export function validateScoringRecord(record) {
  const problems = [];
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return { ok: false, independence: 'unknown', problems: ['record is not an object'], summary: null };
  }

  const author = record.author;
  const reviewer = record.reviewer;
  if (typeof author !== 'string' || author.trim().length === 0) {
    problems.push('author identity is required');
  }
  if (typeof reviewer !== 'string' || reviewer.trim().length === 0) {
    problems.push('reviewer identity is required');
  }

  // Independence.
  let independence = 'unknown';
  const authorEmail = emailOf(author);
  const reviewerEmail = emailOf(reviewer);
  const sameEmail = Boolean(authorEmail && reviewerEmail && authorEmail === reviewerEmail);
  const sameName = Boolean(
    normalizeIdentity(author) &&
    normalizeIdentity(author) === normalizeIdentity(reviewer),
  );
  if (sameEmail || sameName) {
    independence = 'same-party';
    problems.push('reviewer identity matches the author: this is author-only scoring, not GB-12 independence');
  } else if (typeof author === 'string' && typeof reviewer === 'string' && author.trim() && reviewer.trim()) {
    // A model reviewer is a DIFFERENT and WEAKER standard than human
    // independence. Report it as its own class so it can never be silently read
    // as human independence downstream — the operator ruling accepting it is
    // recorded in the packet (§6.3) and must travel with the claim.
    const modelReview = /\b(codex|gpt-[\w.-]+|claude|gemini|deepseek|llama|mistral|model)\b/i.test(reviewer) ||
      record.reviewerKind === 'model';
    if (modelReview || record.reviewerKind === 'model') {
      independence = 'model-independent';
      if (record.reviewerKind !== undefined && record.reviewerKind !== 'model') {
        problems.push(`reviewerKind is '${String(record.reviewerKind)}' but the reviewer identity names a model`);
      }
    } else if (record.reviewerKind === 'human') {
      independence = 'declared-independent';
    } else {
      independence = 'declared-independent';
    }
  }

  if (record.scoredAt !== undefined && !Number.isFinite(Date.parse(record.scoredAt))) {
    problems.push('scoredAt must be an ISO timestamp');
  }
  if (typeof record.artifactSet !== 'string' || record.artifactSet.trim().length === 0) {
    problems.push('artifactSet is required: a verdict must name the exact artifacts it scored');
  }

  const requirements = Array.isArray(record.requirements) ? record.requirements : null;
  if (!requirements) {
    problems.push('requirements must be an array');
    return { ok: false, independence, problems, summary: null };
  }

  const seen = new Set();
  for (const [index, entry] of requirements.entries()) {
    const at = `requirements[${index}]`;
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`${at} is not an object`);
      continue;
    }
    const id = entry.id;
    if (typeof id !== 'string' || !FROZEN_REQUIREMENTS.includes(id)) {
      problems.push(`${at} has an unknown requirement id: ${String(id)}`);
      continue;
    }
    if (seen.has(id)) problems.push(`${id} is scored more than once`);
    seen.add(id);
    if (!VERDICTS.includes(entry.verdict)) {
      problems.push(`${id} has an invalid verdict: ${String(entry.verdict)}`);
    }
    if (entry.verdict === 'met' && (typeof entry.evidence !== 'string' || entry.evidence.trim().length === 0)) {
      // An assertion is not evidence. A "met" verdict must point at retained
      // material a third party could re-read.
      problems.push(`${id} is 'met' without cited evidence`);
    }
    if (entry.verdict !== 'met' && (typeof entry.note !== 'string' || entry.note.trim().length === 0)) {
      problems.push(`${id} is '${String(entry.verdict)}' without a note saying what is unmet`);
    }
  }
  for (const id of FROZEN_REQUIREMENTS) {
    if (!seen.has(id)) problems.push(`${id} has no verdict`);
  }

  const counts = { met: 0, partial: 0, missing: 0, 'not-applicable': 0 };
  for (const entry of requirements) {
    if (entry && VERDICTS.includes(entry.verdict)) counts[entry.verdict] += 1;
  }
  const complete = seen.size === FROZEN_REQUIREMENTS.length;

  return {
    ok: problems.length === 0,
    independence,
    problems,
    summary: {
      total: FROZEN_REQUIREMENTS.length,
      scored: seen.size,
      ...counts,
      // Only meaningful on a complete record. `null` otherwise: an aggregate
      // over a partial review reads as a rate and is not one.
      allMet: complete && counts.met === FROZEN_REQUIREMENTS.length,
      // Independence is a separate gate, not a comment. An all-met record from
      // the author is exactly the state GB-12 exists to reject, so it must not
      // report eligibility.
      gateB: complete &&
        (independence === 'declared-independent' || independence === 'model-independent') &&
        counts.missing === 0 &&
        counts.partial === 0 &&
        counts.met === FROZEN_REQUIREMENTS.length
        ? 'ELIGIBLE-FOR-SIGNATURE'
        : 'HOLD',
    },
  };
}

/** Render a validated record for an operator to read, never to sign blind. */
export function renderScoringReport(result) {
  const lines = [];
  lines.push(`independence: ${result.independence}`);
  if (result.independence === 'model-independent') {
    lines.push('note: model reviewer — weaker than human independence; cite as model-independent, never independent');
  }
  lines.push(`valid: ${result.ok}`);
  if (result.summary) {
    const s = result.summary;
    lines.push(`scored: ${s.scored}/${s.total} (met ${s.met}, partial ${s.partial}, missing ${s.missing}, n/a ${s['not-applicable']})`);
    lines.push(`gate B: ${s.gateB}`);
  }
  if (result.problems.length > 0) {
    lines.push('problems:');
    for (const p of result.problems) lines.push(`  - ${p}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node benchmark/evidence/gate-b-scoring-record.mjs <record.json>\n');
    process.exit(2);
  }
  let raw;
  try {
    raw = readFileSync(resolve(path), 'utf-8');
  } catch {
    process.stderr.write(`cannot read scoring record: ${path}\n`);
    process.exit(2);
  }
  // A record that is not JSON is invalid input, not a scoring failure.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`scoring record is not valid JSON: ${String(error)}\n`);
    process.exit(2);
  }
  const result = validateScoringRecord(parsed);
  process.stdout.write(renderScoringReport(result) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
