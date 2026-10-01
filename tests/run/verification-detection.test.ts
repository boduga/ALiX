/**
 * T3 finding 1: verification requirement detection is silent.
 *
 * Measured on cohort `t3d-2026-09-28-c` as 0 of 8 verification-shaped scopes,
 * while mutation fired 7 of 8 and coordination 7 of 8. The cause was one
 * character of logic: `verification = mutation && <regex>`. A verification-only
 * objective names no file-write verb, so `mutation` was false, so no
 * verification requirement existed, so the completion gate never demanded
 * verification evidence.
 *
 * The practical hole: "run the tests and confirm the suite passes" could be
 * declared complete without a single test executed. That contradicts the
 * durable contract "Completion requires executed evidence", which requires
 * verification evidence precisely for objectives that explicitly ask for it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  objectiveEvidenceRequirements,
  buildRequirementCandidates,
} from '../../src/run/task-loop/predicates.js';

const verificationTools = (task: string, taskType = 'other'): string[] =>
  buildRequirementCandidates(objectiveEvidenceRequirements(task, taskType))
    .map(candidate => candidate.tool)
    .filter(tool => tool === 'alix_verify_claim' || tool === 'alix_shell_run');

describe('verification requirement detection (T3 finding 1)', () => {
  it('detects a verification-only objective — no mutation needed', () => {
    // The defect. None of these name a file-write verb, so `mutation` is false.
    for (const task of [
      'run the tests and confirm the suite passes',
      'Run pnpm typecheck:unused and report whether it passes',
      'verify the change compiles',
      'perform the verification steps',
    ]) {
      assert.equal(objectiveEvidenceRequirements(task, 'other').verification, true, task);
      assert.deepEqual(verificationTools(task), ['alix_verify_claim', 'alix_shell_run'], task);
    }
  });

  it('detects verification on a mutating objective too', () => {
    assert.equal(
      objectiveEvidenceRequirements('Create a file named report.md and run tests to verify', 'docs').verification,
      true,
    );
  });

  it('leaves genuinely non-verification objectives alone', () => {
    // Widening detection must not make every objective demand a test run.
    for (const task of [
      'Read the config file and summarize what it does.',
      'explain how the scheduler works',
      'search the repo for the symbol',
      'write documentation about the test suite',
    ]) {
      assert.equal(objectiveEvidenceRequirements(task, 'research').verification, false, task);
    }
  });

  it('does not demand verification the operator declined', () => {
    // "do not run the tests" contains `run ... tests`. Without a negation guard
    // the widened detection demands evidence the operator explicitly refused.
    for (const task of [
      'do not run the tests, just read the file',
      "dont verify, just read the file",
      'without running the tests explain the code',
      'never run the build',
    ]) {
      assert.equal(objectiveEvidenceRequirements(task, 'research').verification, false, task);
    }
  });

  it('lets a later affirmative override the negation', () => {
    // Regression for a logic slip: the negation and the override were OR-ed, so
    // "but verify" DEEPENED the decline instead of cancelling it.
    assert.equal(
      objectiveEvidenceRequirements('do not run the tests but verify the claim', 'other').verification,
      true,
    );
  });

  it('does not change mutation or coordination detection', () => {
    const cases: Array<[string, string, boolean, boolean]> = [
      ['Create a file named report.md', 'docs', true, false],
      ['coordinate two workers to write docs', 'feature', false, true],
      ['explain how the scheduler works', 'research', false, false],
    ];
    for (const [task, taskType, mutation, coordination] of cases) {
      const required = objectiveEvidenceRequirements(task, taskType);
      assert.equal(required.mutation, mutation, `mutation: ${task}`);
      assert.equal(required.coordination, coordination, `coordination: ${task}`);
    }
  });
});
