/**
 * gate-e-qualification-record.mjs — validate a Gate E execution/security record.
 *
 * WHY THIS EXISTS
 *
 * Gate E asks for five things — "F8b, authority, crash/recovery, ownership and
 * denied-action negatives qualified independently" — and the acceptance matrix
 * has never had a record to check. The failure mode is not "no record". It is a
 * record that counts a test file as a qualified control, or drops the word
 * "independently" because the tests pass.
 *
 * So this validator is deliberately hostile in three specific ways:
 *   - every clause must be present; four of five is a HOLD, not 80%
 *   - every clause must cite evidence files that EXIST
 *   - every clause must state the NEGATIVE case, because a positive assertion
 *     does not catch the regression the control exists to prevent
 *   - declared gaps are preserved, never counted as covered
 *   - independence is a separate axis. Author-side tests cannot close it, and
 *     the outcome label says so instead of hiding it in a footnote.
 *
 * What this cannot do: create a second party. `QUALIFIED-AUTHOR-ONLY` is the
 * honest ceiling for a record this repository can produce alone.
 *
 * Usage:
 *   node benchmark/evidence/gate-e-qualification-record.mjs <record.json>
 *
 * Exit codes distinguish "the record is sound" from "the gate is cleared", which
 * are different questions:
 *   0 = qualified INDEPENDENTLY (gate closed)
 *   3 = sound record, author-only coverage (gate NOT closed)
 *   1 = HOLD, 2 = usage error
 *
 * Collapsing 3 into 0 would let a CI step read a passing exit code as a cleared
 * security gate. The distinction is the whole point of the label.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PATH_BASES,
  isEntryPoint,
  isIsoTimestamp,
  nonEmpty,
  resolveCited,
  runRecordCli,
} from './record-validation.mjs';

/**
 * The five clauses of Gate E, frozen from PRD §9.
 * An unknown clause is a validation error, not an extra credit.
 */
export const GATE_E_CLAUSES = ['F8b', 'authority', 'crash/recovery', 'ownership', 'denied-action negatives'];

/**
 * Independence classes. There is no `independent` value in this vocabulary:
 * a record cannot certify its own independence, so a record that claimed it
 * would have to be trusted on the one point it cannot establish.
 */
export const INDEPENDENCE_CLASSES = ['author-only', 'model-independent', 'declared-independent'];

/** Per-clause observation states. */
export const COMPONENT_STATES = ['qualified', 'partial', 'unqualified'];

/** Gate E outcomes. Independence upgrades the label; it never upgrades coverage. */
export { PATH_BASES } from './record-validation.mjs';

export const GATE_E_OUTCOMES = {
  independent: 'QUALIFIED-INDEPENDENT',
  authorOnly: 'QUALIFIED-AUTHOR-ONLY',
  hold: 'HOLD',
};

/** D9: what may stand as evidence for a control. */
export const EVIDENCE_PATH_PATTERN = /\.(test|spec)\.(ts|mts|js|mjs)$|\.vitest\.ts$|^src\//;

/**
 * Validate a Gate E qualification record.
 *
 * `problems` are reasons the record cannot be used at all.
 * `declaredGaps` are accepted limitations and never produce a problem — they are
 * the opposite: hiding one WOULD.
 */
export function validateGateERecord(record, options = {}) {
  const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();
  const problems = [];
  const notes = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {
      ok: false,
      problems: ['record must be an object'],
      notes,
      summary: null,
      outcome: GATE_E_OUTCOMES.hold,
    };
  }

  // ── Artifact pin ────────────────────────────────────────────────
  const artifact = record.artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    problems.push('artifact is required: a qualification must name the commit it qualified');
  } else if (!/^[0-9a-f]{40}$/.test(String(artifact.commit ?? ''))) {
    problems.push('artifact.commit must be a full 40-character commit sha');
  }
  if (!Number.isFinite(Date.parse(record.observedAt))) {
    problems.push('observedAt must be an ISO timestamp: a stale record is not a qualification');
  }

  // A record must declare how its citations resolve. Guessing is how a path
  // check becomes decorative: it either rejects valid citations or accepts
  // nonexistent ones, and both look like a working check.
  const pathBase = record.pathBase;
  if (!PATH_BASES.includes(pathBase)) {
    problems.push(
      `pathBase must be one of ${PATH_BASES.join('|')} and must be explicit: cited paths resolve either beside the record ("record") or from the repository root ("repo-root")`,
    );
  }

  // ── Runs ────────────────────────────────────────────────────────
  // A record with no runs is a description of intent. It must carry what was
  // actually executed, with counts, so a failing suite cannot hide behind prose.
  const runs = Array.isArray(record.runs) ? record.runs : null;
  if (!runs || runs.length === 0) {
    problems.push('runs is required: a qualification must record what was executed, not what exists');
  } else {
    let totalTests = 0;
    let totalPassed = 0;
    for (const [index, run] of runs.entries()) {
      const at = `runs[${index}]`;
      if (!run || typeof run !== 'object') {
        problems.push(`${at} is not an object`);
        continue;
      }
      if (!nonEmpty(run.runner)) problems.push(`${at}.runner is required`);
      // D9: a runner NAME proves nothing — the review's probe passed
      // "IMAGINARY-RUNNER" and was accepted. Requiring the exact command makes
      // the claim falsifiable: a third party can re-run it and compare counts.
      if (!nonEmpty(run.command)) {
        problems.push(
          `${at}.command is required: a runner name is not reproducible, the exact invocation is`,
        );
      } else {
        for (const file of Array.isArray(run.files) ? run.files : []) {
          if (!nonEmpty(file)) continue;
          // Compare stem + extension, because a compiled run names
          // `dist/tests/x.test.js` for a source file `tests/x.test.ts`.
          const stem = file.replace(/\.(ts|mts)$/, "");
          if (!run.command.includes(stem) && !run.command.includes(file)) {
            problems.push(
              `${at}.command does not reference ${file}: the command must be the one that ran those files`,
            );
          }
        }
      }
      if (!Array.isArray(run.files) || run.files.length === 0) {
        problems.push(`${at}.files is required: name the files that ran`);
      } else {
        for (const file of run.files) {
          if (!nonEmpty(file)) {
            problems.push(`${at}.files contains an empty path`);
          } else if (pathBase && !existsSync(resolveCited(file, baseDir, pathBase))) {
            problems.push(`${at}.files cites a path that does not exist: ${file}`);
          }
        }
      }
      if (!Number.isInteger(run.tests) || run.tests <= 0) {
        problems.push(`${at}.tests must be a positive integer`);
      }
      if (!Number.isInteger(run.passed) || run.passed < 0) {
        problems.push(`${at}.passed must be a non-negative integer`);
      }
      if (run.failed !== 0) {
        problems.push(`${at}.failed is ${String(run.failed)}: a qualification cannot be built on a failing suite`);
      }
      if (!Number.isInteger(run.passed) || (Number.isInteger(run.tests) && Number.isInteger(run.passed) && run.passed !== run.tests)) {
        problems.push(`${at}: passed (${String(run.passed)}) does not equal tests (${String(run.tests)})`);
      }
      if (Number.isInteger(run.tests)) totalTests += run.tests;
      if (Number.isInteger(run.passed)) totalPassed += run.passed;
    }
    if (totalTests > 0) notes.push(`observed: ${totalPassed}/${totalTests} tests passed in this run`);
  }

  // ── Components: all five clauses, each with a negative case and real evidence
  const components = Array.isArray(record.components) ? record.components : null;
  const seen = new Set();
  const counts = { qualified: 0, partial: 0, unqualified: 0 };
  if (!components) {
    problems.push('components must be an array: Gate E is five clauses, not one verdict');
  } else {
    for (const [index, component] of components.entries()) {
      const at = `components[${index}]`;
      if (!component || typeof component !== 'object') {
        problems.push(`${at} is not an object`);
        continue;
      }
      const clause = component.clause;
      if (!GATE_E_CLAUSES.includes(clause)) {
        // A near-miss is the interesting failure: "denied action" vs
        // "denied-action negatives" would silently drop a required clause.
        problems.push(`${at} has an unknown Gate E clause: ${String(clause)}`);
        continue;
      }
      if (seen.has(clause)) problems.push(`clause ${clause} is recorded more than once`);
      seen.add(clause);

      if (!COMPONENT_STATES.includes(component.observed)) {
        problems.push(`${clause} has an invalid observed state: ${String(component.observed)}`);
      } else {
        counts[component.observed] += 1;
      }

      if (!nonEmpty(component.question)) {
        problems.push(`${clause} has no question: a control must state what it is being asked to prove`);
      }

      // The negative case is the whole point of a security control. Without it
      // the record asserts that something works, not that removing it would fail.
      if (!nonEmpty(component.negativeCase)) {
        problems.push(
          `${clause} does not state its negative case: a positive assertion does not catch the regression the control exists to prevent`,
        );
      }

      if (!Array.isArray(component.evidence) || component.evidence.length === 0) {
        problems.push(`${clause} cites no evidence files`);
      } else {
        for (const file of component.evidence) {
          if (!nonEmpty(file)) {
            problems.push(`${clause} cites an empty evidence path`);
          } else if (pathBase && !existsSync(resolveCited(file, baseDir, pathBase))) {
            problems.push(`${clause} cites a path that does not exist: ${file}`);
          } else if (!EVIDENCE_PATH_PATTERN.test(file)) {
            // D9: the probe used package.json as every clause's evidence and was
            // accepted. Evidence for a control must be code that can assert it —
            // a test or the implementation under test.
            problems.push(
              `${clause} cites ${file}, which cannot assert a control: evidence must be a test or source file`,
            );
          }
        }
      }
    }
    for (const clause of GATE_E_CLAUSES) {
      if (!seen.has(clause)) problems.push(`clause ${clause} has no entry: Gate E requires all five`);
    }
  }

  // ── Declared gaps ───────────────────────────────────────────────
  // Presence is required. An empty list is legitimate; an ABSENT list usually
  // means gaps were dropped rather than none found.
  if (!Array.isArray(record.declaredGaps)) {
    problems.push(
      'declaredGaps must be present (may be empty): a record that reports no gaps must say so explicitly, not by omission',
    );
  } else {
    for (const [index, gap] of record.declaredGaps.entries()) {
      if (!gap || typeof gap !== 'object') {
        problems.push(`declaredGaps[${index}] is not an object`);
        continue;
      }
      if (!nonEmpty(gap.id)) problems.push(`declaredGaps[${index}] has no id`);
      if (!nonEmpty(gap.gap)) problems.push(`declaredGaps[${index}] has no gap description`);
    }
    if (record.declaredGaps.length > 0) {
      notes.push(
        `gaps preserved, NOT covered: ${record.declaredGaps.map(g => g.id).join(', ')}`,
      );
    }
  }

  // ── Independence ────────────────────────────────────────────────
  const independence = record.independence;
  let independenceClass = 'unknown';
  if (!independence || typeof independence !== 'object' || Array.isArray(independence)) {
    problems.push('independence is required: Gate E specifies "qualified independently" and the class must be stated');
  } else {
    if (!INDEPENDENCE_CLASSES.includes(independence.class)) {
      problems.push(`independence.class must be one of ${INDEPENDENCE_CLASSES.join('|')}; got ${String(independence.class)}`);
    } else {
      independenceClass = independence.class;
    }
    if (independenceClass !== 'author-only' && !nonEmpty(independence.note)) {
      problems.push('independence.note is required when independence is claimed: say how it was obtained');
    }
    // Independent review D9: changing `class` to `declared-independent` plus a
    // free-text note produced QUALIFIED-INDEPENDENT, so the strongest label in
    // the vocabulary was reachable by typing it. Independence must be a CITED
    // artifact that exists and names the qualifier — the same rule Gate B's
    // waiver and Gate F's approval already enforce.
    if (independenceClass !== 'author-only') {
      const qualifier = independence.qualifier;
      if (!qualifier || typeof qualifier !== 'object' || Array.isArray(qualifier)) {
        problems.push(
          `${independenceClass} requires independence.qualifier {ref, identity, reviewedAt}: a record may not declare its own independence from free text`,
        );
      } else {
        if (!nonEmpty(qualifier.identity)) {
          problems.push('independence.qualifier.identity is required: an independent qualifier must be named');
        }
        if (!Number.isFinite(Date.parse(qualifier.reviewedAt))) {
          problems.push('independence.qualifier.reviewedAt must be an ISO timestamp');
        }
        if (!nonEmpty(qualifier.ref)) {
          problems.push('independence.qualifier.ref is required: name the artifact holding the review');
        } else if (pathBase) {
          const qualifierPath = resolveCited(qualifier.ref, baseDir, pathBase);
          if (!existsSync(qualifierPath)) {
            problems.push(`independence.qualifier.ref does not exist: ${qualifier.ref}`);
          } else if (nonEmpty(qualifier.identity)) {
            let body = '';
            try {
              body = readFileSync(qualifierPath, 'utf-8');
            } catch {
              problems.push(`independence.qualifier.ref is unreadable: ${qualifier.ref}`);
            }
            if (body && !body.includes(qualifier.identity.trim())) {
              problems.push(
                `independence.qualifier.ref does not contain the named qualifier: ${qualifier.identity}`,
              );
            }
          }
        }
      }
    }
  }

  // ── Outcome ─────────────────────────────────────────────────────
  // Coverage and independence are separate axes. A perfect author-side record is
  // still author-only, and the label must carry that rather than implying more.
  const allQualified =
    !!components &&
    seen.size === GATE_E_CLAUSES.length &&
    counts.qualified === GATE_E_CLAUSES.length;

  let outcome = GATE_E_OUTCOMES.hold;
  if (problems.length === 0 && allQualified) {
    outcome = independenceClass === 'author-only'
      ? GATE_E_OUTCOMES.authorOnly
      : GATE_E_OUTCOMES.independent;
  }

  if (outcome === GATE_E_OUTCOMES.authorOnly) {
    notes.push(
      'author-side qualification only: Gate E requires independent qualification, and passing tests authored with the code are not a second party',
    );
    notes.push('this does not clear Gate E; it records the coverage an independent qualifier would review');
  }

  return {
    ok: problems.length === 0,
    problems,
    notes,
    outcome,
    summary: {
      clauses: GATE_E_CLAUSES.length,
      recorded: seen.size,
      ...counts,
      declaredGaps: Array.isArray(record.declaredGaps) ? record.declaredGaps.length : null,
      independence: independenceClass,
      outcome,
    },
  };
}

/** Render a validated record for an operator to read, never to sign blind. */
export function renderGateEReport(result) {
  const lines = [];
  lines.push(`valid: ${result.ok}`);
  lines.push(`gate E: ${result.outcome}`);
  if (result.summary) {
    const s = result.summary;
    lines.push(
      `clauses: ${s.recorded}/${s.clauses} (qualified ${s.qualified}, partial ${s.partial}, unqualified ${s.unqualified})`,
    );
    lines.push(`independence: ${s.independence}`);
    if (s.declaredGaps !== null) lines.push(`declared gaps: ${s.declaredGaps}`);
  }
  for (const note of result.notes) lines.push(`note: ${note}`);
  if (result.problems.length > 0) {
    lines.push('problems:');
    for (const problem of result.problems) lines.push(`  - ${problem}`);
  }
  return lines.join('\n');
}

if (isEntryPoint(import.meta.url, process.argv)) {
  runRecordCli({
    argv: process.argv,
    usage: 'node benchmark/evidence/gate-e-qualification-record.mjs <record.json>',
    render: renderGateEReport,
    validate: validateGateERecord,
    // Exit codes must never collapse "valid" into "cleared": a HOLD is non-zero
    // whether or not the record itself is well-formed, and a sound author-only
    // record is 3 so a pipeline cannot read it as a cleared gate.
    exitCodeFor: (result) =>
      result.outcome === GATE_E_OUTCOMES.hold
        ? 1
        : !result.ok
          ? 1
          : result.outcome === GATE_E_OUTCOMES.authorOnly
            ? 3
            : 0,
  });
}
