/**
 * release-clearance-record.mjs — validate a Q13 / Gate F release-clearance record.
 *
 * WHY THIS EXISTS
 *
 * PRD-R082 states Q13 as a set of *negative* tests: "reject release on
 * missing/expired clearance, absent maintainer approval, mismatched artifact, or
 * technical FAIL". That sentence is the whole reason this file exists — the
 * requirement is written as behaviour that must be observed, so it can be
 * observed by a machine.
 *
 * What this validator CAN do:
 *   - refuse a release whose clearance is missing, expired, or self-issued
 *   - refuse a release with no maintainer decision, or one a model signed
 *   - refuse a release whose technical qualification is FAIL or PARTIAL
 *   - refuse a release whose decisions are not bound to the exact artifact
 *   - refuse an approval that predates the clearance it was granted after
 *   - refuse a clearance or approval whose cited evidence does not exist, or
 *     whose approval artifact does not name the signer
 *   - state the outcome, so "released" is a computed verdict and not a claim
 *
 * What this validator CANNOT do:
 *   - perform the independent security review, or create a second party
 *   - decide to release. Q13's requirement *is* the authority of a named
 *     maintainer. There is therefore no waiver path here: waiving "independent
 *     clearance" would not substitute a different measurement for an
 *     unmeasurable quantity (the Gate B `waived` case); it would delete the
 *     requirement. That distinction is enforced, not documented.
 *
 * A cited path resolves relative to the record file that cites it, exactly like
 * the Gate B waiver `ref`. A record in `docs/audits/` therefore points at a
 * sibling by bare name and at a parent with `../`.
 *
 * Usage:
 *   node benchmark/evidence/release-clearance-record.mjs <record.json>
 *
 * Exit 0 = release authorized (strong, or a labelled maintainer scope decision),
 *      1 = HOLD, 2 = usage / unreadable / malformed input.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkEvidenceFiles,
  checkSignerNamed,
  isEntryPoint,
  isIsoTimestamp,
  nonEmpty,
  normalizeIdentity,
  runRecordCli,
} from './record-validation.mjs';

/**
 * Release outcomes. There is deliberately no `CLOSED-WITH-WAIVER` analogue.
 *
 * `RELEASE-AUTHORIZED-SCOPE-DECISION` is the weaker label: the authorized
 * maintainer determined that no independent publication restriction is
 * applicable. That is a signed scope decision, not independent clearance, and
 * it must be cited as such.
 */
export const RELEASE_OUTCOMES = {
  authorized: 'RELEASE-AUTHORIZED',
  scopeDecision: 'RELEASE-AUTHORIZED-SCOPE-DECISION',
  hold: 'HOLD',
};

/** Technical qualification verdicts. Only `pass` can be released. */
export const TECHNICAL_VERDICTS = ['pass', 'partial', 'fail'];

/**
 * How clearance was obtained.
 *  - `restriction-cleared`        — a designated independent process cleared it.
 *  - `no-restriction-applicable`  — the authorized maintainer determined that
 *                                   no independent restriction applies. Weaker.
 */
export const CLEARANCE_KINDS = ['restriction-cleared', 'no-restriction-applicable'];

/** Who supplied the maintainer decision. `model` is rejected, not merely flagged. */
export const SIGNER_CLASSES = ['operator', 'model'];

export { normalizeIdentity } from './record-validation.mjs';

const COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Validate a release-clearance record. Never throws on record shape; returns
 * problems instead so an operator sees every reason at once.
 */
export function validateReleaseClearanceRecord(record, options = {}) {
  const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();
  // This record resolves citations beside itself. Declared explicitly rather
  // than defaulted deeper in, so the base is visible where it is used.
  const pathBase = 'record';
  const problems = [];
  const notes = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {
      ok: false,
      problems: ['record must be an object'],
      notes,
      summary: null,
      outcome: RELEASE_OUTCOMES.hold,
    };
  }

  // Q13 has no waiver path. This is not a policy preference; it is the shape of
  // the requirement. Gate B could waive M-1 because the quantity (human minutes)
  // is unmeasurable and a waiver was an honest disposition of the *measurement*.
  // Q13 requires the clearance and the maintainer decision themselves, so a
  // waiver removes the requirement rather than substituting for it.
  if (record.waiver !== undefined && record.waiver !== null) {
    problems.push(
      'Gate F has no waiver path: Q13 requires documented clearance and an explicit maintainer decision. Waiving them deletes the requirement instead of substituting a measurement for it',
    );
  }

  // ── Exact artifact identity ─────────────────────────────────────
  const artifact = record.artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    problems.push('artifact is required: both decisions must bind to an exact release artifact');
  } else {
    if (!COMMIT_RE.test(String(artifact.commit ?? ''))) {
      problems.push(
        'artifact.commit must be a full 40-character commit sha: an abbreviated or missing commit cannot bind a release decision',
      );
    }
    if (!nonEmpty(artifact.version)) {
      problems.push('artifact.version is required');
    }
    if (artifact.sha256 !== undefined && artifact.sha256 !== null && !SHA256_RE.test(String(artifact.sha256))) {
      problems.push('artifact.sha256 must be a 64-character sha256, or null when no packaged artifact was hashed');
    }
  }
  const artifactCommit = artifact && nonEmpty(artifact.commit) ? String(artifact.commit).toLowerCase() : null;
  const artifactSha = artifact && artifact.sha256 ? String(artifact.sha256).toLowerCase() : null;

  // ── Technical qualification ─────────────────────────────────────
  const technical = record.technical;
  if (!technical || typeof technical !== 'object' || Array.isArray(technical)) {
    problems.push('technical qualification is missing: Q13 requires documented technical qualification before any release decision');
  } else {
    if (!TECHNICAL_VERDICTS.includes(technical.verdict)) {
      problems.push(`technical.verdict must be one of ${TECHNICAL_VERDICTS.join('|')}; got ${String(technical.verdict)}`);
    }
    if (technical.verdict === 'fail') {
      problems.push('technical qualification FAILED: a failed qualification cannot be released, and other passing tests are not a substitute');
    }
    if (technical.verdict === 'partial') {
      problems.push('technical qualification is PARTIAL: a partial qualification is not a documented technical PASS');
    }
    if (!isIsoTimestamp(technical.qualifiedAt)) {
      problems.push('technical.qualifiedAt must be an ISO timestamp');
    }
    if (artifactCommit && String(technical.commit ?? '').toLowerCase() !== artifactCommit) {
      problems.push(
        `technical qualification is bound to a different artifact (${String(technical.commit ?? 'none')} != ${artifactCommit})`,
      );
    }
    checkEvidenceFiles('technical.evidence', technical.evidence, baseDir, pathBase, problems);
  }

  // ── Independent security publication clearance ──────────────────
  const clearance = record.clearance;
  if (!clearance || typeof clearance !== 'object' || Array.isArray(clearance)) {
    problems.push(
      'security clearance is MISSING: Q13 requires documented clearance of every applicable independent security publication restriction through its designated process',
    );
  } else {
    if (!CLEARANCE_KINDS.includes(clearance.kind)) {
      problems.push(`clearance.kind must be one of ${CLEARANCE_KINDS.join('|')}; got ${String(clearance.kind)}`);
    }
    for (const field of ['authority', 'process', 'scope']) {
      if (!nonEmpty(clearance[field])) {
        problems.push(`clearance.${field} is required: a clearance with no named ${field} is not a clearance`);
      }
    }
    if (!isIsoTimestamp(clearance.grantedAt)) {
      problems.push('clearance.grantedAt must be an ISO timestamp');
    }
    if (clearance.expiresAt !== undefined && clearance.expiresAt !== null) {
      if (!isIsoTimestamp(clearance.expiresAt)) {
        problems.push('clearance.expiresAt must be an ISO timestamp, or null when the clearance does not expire');
      } else if (Date.parse(clearance.expiresAt) <= Date.now()) {
        problems.push(`clearance EXPIRED at ${clearance.expiresAt}: an expired clearance cannot authorize a release`);
      }
    }
    checkEvidenceFiles('clearance.evidence', clearance.evidence, baseDir, pathBase, problems);
  }

  // ── Maintainer decision ─────────────────────────────────────────
  const approval = record.approval;
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    problems.push('maintainer approval is ABSENT: Q13 requires an explicit decision by the authorized repository maintainer');
  } else {
    if (!SIGNER_CLASSES.includes(approval.signerClass)) {
      problems.push(`approval.signerClass must be one of ${SIGNER_CLASSES.join('|')}; got ${String(approval.signerClass)}`);
    }
    if (approval.signerClass === 'model') {
      problems.push(
        'a MODEL cannot supply maintainer approval: Q13 requires the authorized repository maintainer, and a model is not that authority. Record a model as a model, never in the maintainer field',
      );
    }
    if (!nonEmpty(approval.identity)) {
      problems.push('approval.identity is required');
    }
    if (!isIsoTimestamp(approval.approvedAt)) {
      problems.push('approval.approvedAt must be an ISO timestamp');
    }
    if (!nonEmpty(approval.scope)) {
      problems.push('approval.scope is required: an approval with no stated scope is not a scoped decision');
    }
    if (artifactCommit && String(approval.commit ?? '').toLowerCase() !== artifactCommit) {
      problems.push(
        `maintainer approval is bound to a different artifact (${String(approval.commit ?? 'none')} != ${artifactCommit})`,
      );
    }
    if (artifactSha && approval.sha256 !== undefined && approval.sha256 !== null && String(approval.sha256).toLowerCase() !== artifactSha) {
      problems.push('maintainer approval sha256 does not match the release artifact');
    }
    checkEvidenceFiles('approval.evidence', approval.evidence, baseDir, pathBase, problems);
    checkSignerNamed('approval.evidence', approval.evidence, approval.identity, baseDir, pathBase, problems);

    // Q13: approval comes *after* clearance. An approval written first is
    // approval of an unresolved restriction.
    if (clearance && isIsoTimestamp(approval.approvedAt) && isIsoTimestamp(clearance.grantedAt) && Date.parse(approval.approvedAt) < Date.parse(clearance.grantedAt)) {
      problems.push('maintainer approval PREDATES clearance: Q13 requires approval after restrictions are cleared, not before');
    }

    // Q13: a maintainer cannot clear their own restriction. Same-party
    // clearance is not independent clearance, whatever it is labelled.
    if (
      clearance &&
      clearance.kind === 'restriction-cleared' &&
      nonEmpty(clearance.authority) &&
      normalizeIdentity(clearance.authority) === normalizeIdentity(approval.identity)
    ) {
      problems.push('clearance authority and maintainer approver are the SAME PARTY: self-cleared restrictions are not independent clearance');
    }
  }

  const independentClearance =
    !!clearance &&
    !!approval &&
    clearance.kind === 'restriction-cleared' &&
    nonEmpty(clearance.authority) &&
    normalizeIdentity(clearance.authority) !== normalizeIdentity(approval.identity);

  if (clearance && clearance.kind === 'no-restriction-applicable') {
    notes.push(
      'clearance is a maintainer scope decision: no independent publication restriction was determined applicable. That is a signed scope decision, not independent clearance',
    );
  }

  let outcome = RELEASE_OUTCOMES.hold;
  if (problems.length === 0) {
    outcome = clearance.kind === 'no-restriction-applicable'
      ? RELEASE_OUTCOMES.scopeDecision
      : RELEASE_OUTCOMES.authorized;
  }

  return {
    ok: problems.length === 0,
    problems,
    notes,
    outcome,
    summary: {
      artifactCommit,
      artifactSha,
      technicalVerdict: technical?.verdict ?? null,
      clearanceKind: clearance?.kind ?? null,
      clearanceAuthority: clearance?.authority ?? null,
      clearanceExpiresAt: clearance?.expiresAt ?? null,
      approver: approval?.identity ?? null,
      approverClass: approval?.signerClass ?? null,
      approvedAt: approval?.approvedAt ?? null,
      independentClearance,
      outcome,
    },
  };
}

/** Render a validated record for an operator to read, never to sign blind. */
export function renderReleaseReport(result) {
  const lines = [];
  lines.push(`valid: ${result.ok}`);
  lines.push(`release: ${result.outcome}`);
  if (result.summary) {
    const s = result.summary;
    lines.push(`artifact: ${s.artifactCommit ?? 'none'} (${s.artifactSha ?? 'no packaged sha256'})`);
    lines.push(`technical: ${s.technicalVerdict ?? 'none'}`);
    lines.push(`clearance: ${s.clearanceKind ?? 'none'}${s.clearanceAuthority ? ` by ${s.clearanceAuthority}` : ''}`);
    lines.push(`approval: ${s.approver ? `${s.approver} (${s.approverClass})` : 'none'}`);
    if (s.outcome === RELEASE_OUTCOMES.scopeDecision) {
      lines.push(
        'note: release rests on a MAINTAINER SCOPE DECISION, not independent clearance — cite the scope decision every time',
      );
    }
    if (!s.independentClearance) {
      lines.push('note: no independent clearance is recorded; this is not independent security qualification');
    }
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
    usage: 'node benchmark/evidence/release-clearance-record.mjs <record.json>',
    render: renderReleaseReport,
    validate: validateReleaseClearanceRecord,
    exitCodeFor: (result) => (result.ok ? 0 : 1),
  });
}
