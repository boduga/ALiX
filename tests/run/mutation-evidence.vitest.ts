/**
 * A mutation TOOL is not mutation EVIDENCE.
 *
 * `file.create` reports `changed: false` when the target already exists with
 * identical content, and `patch.apply` can resolve with an empty
 * `changedFiles`. Both are successful calls that wrote nothing. The old
 * predicate counted the tool name alone, so an agent could satisfy "a
 * successful workspace mutation" by rewriting a file with the content it had
 * already written — indefinitely, with no workspace change — and then declare
 * the task complete.
 *
 * That is T3 finding 6 (`changed=false` unobservable) with teeth: the no-op was
 * not merely unrecorded, it was accepted as proof.
 */
import { describe, it, expect } from 'vitest';
import {
  objectiveEvidenceGaps,
  VERIFICATION_EVIDENCE_GAP,
  type SuccessfulToolEvidence,
} from '../../src/run/task-loop/predicates.js';

function evidence(item: Partial<SuccessfulToolEvidence> & { name: string }): SuccessfulToolEvidence {
  return { args: {}, ordinal: 0, ...item };
}

describe('mutation evidence for the completion gate', () => {
  const MUTATING_TASK = 'create a file containing the summary';
  const VERIFYING_TASK = 'implement the fix and run the tests';

  it('accepts a create that reported a change', () => {
    expect(objectiveEvidenceGaps(MUTATING_TASK, 'feature', [
      evidence({ name: 'file.create', mutated: true }),
    ])).not.toContain('a successful workspace mutation');
  });

  it('REJECTS a create that reported no change', () => {
    // The defect. `already_exists_identical` is a success with `changed: false`;
    // it wrote nothing, so it cannot be the proof that the workspace changed.
    expect(objectiveEvidenceGaps(MUTATING_TASK, 'feature', [
      evidence({ name: 'file.create', mutated: false }),
    ])).toContain('a successful workspace mutation');
  });

  it('rejects a patch that resolved with no changed files', () => {
    expect(objectiveEvidenceGaps(MUTATING_TASK, 'feature', [
      evidence({ name: 'patch.apply', mutated: false }),
    ])).toContain('a successful workspace mutation');
  });

  it('cannot be satisfied by repeating the same no-op', () => {
    // The attack the gate exists to stop: loop the identical write, then claim
    // completion. Ordinals advance, so a name-only predicate sees plenty of
    // "mutation" and never complains.
    const repeated = Array.from({ length: 5 }, (_, i) =>
      evidence({ name: 'file.create', mutated: false, ordinal: i }));
    expect(objectiveEvidenceGaps(MUTATING_TASK, 'feature', repeated))
      .toContain('a successful workspace mutation');
  });

  it('still accepts a delete, which reports no `changed` field at all', () => {
    // `file.delete` returns `{ kind: "success", deletedPath }` with no `changed`
    // key, so an absent flag is UNDECIDED, not a denial. Reading absence as
    // "no mutation" would have broken every legitimate delete.
    expect(objectiveEvidenceGaps('delete the temporary file', 'docs', [
      evidence({ name: 'file.delete' }),
    ])).not.toContain('a successful workspace mutation');
  });

  it('still requires verification AFTER the real mutation', () => {
    // A no-op create must not launder a verification gap either: the gate is
    // "a successful verification command after the mutation", and with no
    // mutation there is nothing to have verified.
    const gaps = objectiveEvidenceGaps(VERIFYING_TASK, 'bugfix', [
      evidence({ name: 'file.create', mutated: false, ordinal: 0 }),
      evidence({ name: 'shell.run', args: { command: 'pnpm test' }, ordinal: 1 }),
    ]);
    expect(gaps).toContain(VERIFICATION_EVIDENCE_GAP);
  });

  it('accepts a real mutation followed by verification', () => {
    const gaps = objectiveEvidenceGaps(VERIFYING_TASK, 'bugfix', [
      evidence({ name: 'file.create', mutated: true, ordinal: 0 }),
      evidence({ name: 'shell.run', args: { command: 'pnpm test' }, ordinal: 1 }),
    ]);
    expect(gaps).toEqual([]);
  });

  it('still requires a coordination run to have happened at all', () => {
    // The coordination gap is an ABSENCE rule, not a `mutated` rule: a
    // coordination objective with no successful `coordination.run` is a gap
    // whatever else ran. Pinned so the mutation path above does not relax it.
    const task = 'coordinate two workers to write the files';
    expect(objectiveEvidenceGaps(task, 'feature', [
      evidence({ name: 'file.read' }),
    ])).toContain('a successful coordination run with worker outcomes');
    expect(objectiveEvidenceGaps(task, 'feature', [
      evidence({ name: 'coordination.run' }),
    ])).not.toContain('a successful coordination run with worker outcomes');
  });

  it('accepts a delegated run whose workers wrote files as mutation evidence', () => {
    // A coordinator told not to do its workers' tasks never mutates itself, so
    // `mutated: true` on the coordination call is what satisfies the mutation
    // requirement. The tri-state must not break this.
    expect(objectiveEvidenceGaps(MUTATING_TASK, 'feature', [
      evidence({ name: 'coordination.run', mutated: true }),
    ])).not.toContain('a successful workspace mutation');
  });

  it('ignores non-mutation tools entirely', () => {
    expect(objectiveEvidenceGaps(MUTATING_TASK, 'feature', [
      evidence({ name: 'file.read' }),
      evidence({ name: 'grep.search' }),
      evidence({ name: 'shell.run', args: { command: 'ls' } }),
    ])).toContain('a successful workspace mutation');
  });
});
