/**
 * The read-only offer surface had two hand-built copies — `agent-loop.ts` and
 * `session/setup.ts` — and they had drifted: the loop re-added `alix_verify_claim`
 * by hand, the session builder did not. The same route therefore offered
 * different tools depending on which built them. T3 finding 2 recorded the cost:
 * a verification-shaped scope answered by reading, because the tool that would
 * have checked the reading was not offered.
 *
 * These tests pin the single derivation AND the containment boundary it must
 * never cross: `alix_shell_run` stays out of read-only, because arbitrary
 * command execution can mutate the workspace.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReadOnlyToolFilter,
  READ_ONLY_EXCLUDED_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
} from '../../src/execution/run/helpers.js';

describe('read-only tool surface', () => {
  it('withholds alix_shell_run — the containment boundary', () => {
    // Deliberate and load-bearing: `rm`, `sed -i`, and a test suite that
    // writes fixtures all mutate the workspace, which is what --read-only
    // exists to prevent. Widening this needs a decision, not a default.
    expect(READ_ONLY_EXCLUDED_TOOL_NAMES.has('alix_shell_run')).toBe(true);
    expect(READ_ONLY_TOOL_NAMES.has('alix_shell_run')).toBe(true); // kept for the shellTask route
    expect(buildReadOnlyToolFilter().has('alix_shell_run')).toBe(false);
  });

  it('offers alix_verify_claim — it fetches nothing and mutates nothing', () => {
    expect(buildReadOnlyToolFilter().has('alix_verify_claim')).toBe(true);
  });

  it('returns a fresh set each call so a caller cannot mutate the shared one', () => {
    const first = buildReadOnlyToolFilter();
    first.add('alix_patch_apply');
    expect(buildReadOnlyToolFilter().has('alix_patch_apply')).toBe(false);
  });

  it('never carries a write tool into a read-only surface', () => {
    const filter = buildReadOnlyToolFilter();
    for (const write of ['alix_patch_apply', 'alix_file_create', 'alix_file_delete', 'alix_hook_create']) {
      expect(filter.has(write)).toBe(false);
    }
  });

  it('applies route extras without losing the exclusion', () => {
    // agent-loop passes delegate + the read-only coordination/state readers.
    const filter = buildReadOnlyToolFilter([
      'alix_delegate',
      'alix_coordination_status',
      'alix_state_query',
    ]);
    expect(filter.has('alix_delegate')).toBe(true);
    expect(filter.has('alix_coordination_status')).toBe(true);
    expect(filter.has('alix_state_query')).toBe(true);
    // An extra must not be able to re-admit command execution.
    expect(filter.has('alix_shell_run')).toBe(false);
  });
});
