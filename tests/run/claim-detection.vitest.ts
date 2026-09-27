/**
 * Claim detection must not flag the tooling's own vocabulary or a denial.
 *
 * Live failure (session 1790487158363): a fully successful four-worker run
 * ended completed_unverified because the coordinator's summary used the word
 * "Scheduling" as a table heading ("Scheduling: workers 1-3 ran in parallel").
 * The re-prompt named alix_schedule_propose, the model explained the flag
 * ("no scheduling was requested", "I never promised a schedule proposal"), and
 * that rebuttal re-armed the detector until the attempts ran out.
 */
import { describe, it, expect } from 'vitest';
import { findUnsubstantiatedClaims } from '../../src/run/task-loop/predicates.js';

const LABEL = 'scheduling a job';

describe('findUnsubstantiatedClaims scheduling entry', () => {
  it('ignores the coordination scheduler described in a summary', () => {
    const text = '**Scheduling:** workers 1–3 had no dependencies and ran in parallel.';
    expect(findUnsubstantiatedClaims(text, new Set())).not.toContain(LABEL);
  });

  it('ignores a denial of the claim', () => {
    const text = 'No scheduling was requested at any point, so there is no `alix_schedule_*` call to make.';
    expect(findUnsubstantiatedClaims(text, new Set())).not.toContain(LABEL);
  });

  it('ignores a hypothetical object in a rebuttal', () => {
    const text = 'The flag is a mismatch: the objective involved no scheduling, I never promised a schedule proposal, '
      + 'and creating an unsolicited recurring job would add an unwanted side effect.';
    expect(findUnsubstantiatedClaims(text, new Set())).not.toContain(LABEL);
  });

  it('still flags a first-person scheduling claim', () => {
    for (const text of [
      'I scheduled a nightly job to refresh the report.',
      "I've set up a cron job for the export.",
      'I will create a recurring task that runs each morning.',
    ]) {
      expect(findUnsubstantiatedClaims(text, new Set())).toContain(LABEL);
    }
  });

  it('accepts the claim once the tool was actually used, under either name', () => {
    const text = 'I scheduled a nightly job to refresh the report.';
    // `usedTools` carries model-facing names; the map is keyed by executor ids.
    expect(findUnsubstantiatedClaims(text, new Set(['alix_schedule_propose']))).not.toContain(LABEL);
    expect(findUnsubstantiatedClaims(text, new Set(['schedule.propose']))).not.toContain(LABEL);
  });

  it('accepts a shell-run claim after alix_shell_run', () => {
    const text = 'I compiled the project and the build passed.';
    expect(findUnsubstantiatedClaims(text, new Set())).toContain('verifying compilation');
    expect(findUnsubstantiatedClaims(text, new Set(['alix_shell_run']))).not.toContain('verifying compilation');
  });
});
