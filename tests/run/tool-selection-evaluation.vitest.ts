/**
 * T2-d: selection evaluation without counterfactual overclaim.
 *
 * The invariant under test: no selector receives a quality label from a
 * counterfactual that was never observed, replayed, or operator-labelled. Every
 * alternative is either observed, replayed, or unknown with a reason.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateToolSelection,
  replayabilityOf,
  replayabilityOfCandidate,
  selectionOutcomeFromObservation,
  type CounterfactualReplayRunner,
} from '../../src/decision/tool-selection-evaluation.js';
import type { ToolSelectionScope } from '../../src/decision/tool-selection-replay.js';
import {
  builtinCandidateId,
  candidateIdFor,
  freezeToolCandidates,
} from '../../src/decision/tool-selection-candidates.js';

const frozen = freezeToolCandidates({
  builtin: [
    { name: 'alix_file_read', description: 'Read a file' },
    { name: 'alix_grep_search', description: 'Search file contents' },
    { name: 'alix_patch_apply', description: 'Apply a patch' },
  ],
  mcp: [{ name: 'mcp__abc', serverName: 'demo', toolName: 'echo' }],
});

const id = builtinCandidateId;
const mcpId = candidateIdFor('mcp__abc');

const scope: ToolSelectionScope = {
  scopeId: 'scope_7',
  iteration: 7,
  candidates: frozen.candidates,
  bindings: frozen.bindings,
  offered: frozen.candidates.map(candidate => candidate.candidateId),
  requirementCandidates: [],
  scoperRanking: [
    { candidateId: id('alix_grep_search'), score: 3 },
    { candidateId: id('alix_file_read'), score: 1 },
    { candidateId: id('alix_patch_apply'), score: 0 },
  ],
  actualCandidateIds: [id('alix_file_read')],
};

const observedOutcome = { execution: 'success' as const, selection: 'novel' as const, evidence: 'none' as const };

describe('replayabilityOf', () => {
  it('classifies read-only tools as hermetic, mutating tools as snapshot-bound, and the rest as external', () => {
    expect(replayabilityOf('alix_file_read')).toBe('hermetic');
    expect(replayabilityOf('alix_grep_search')).toBe('hermetic');
    expect(replayabilityOf('alix_patch_apply')).toBe('mutating');
    expect(replayabilityOf('alix_coordination_run')).toBe('mutating');
    expect(replayabilityOf('alix_shell_run')).toBe('mutating');
    expect(replayabilityOf('alix_web_fetch')).toBe('external');
    // Unknown tools are never assumed harmless.
    expect(replayabilityOf('alix_something_new')).toBe('external');
  });

  it('classifies a frozen MCP candidate as external from its domain, not its handle', () => {
    expect(replayabilityOfCandidate(scope, mcpId)).toBe('external');
    expect(replayabilityOfCandidate(scope, id('alix_file_read'))).toBe('hermetic');
    expect(replayabilityOfCandidate(scope, id('alix_patch_apply'))).toBe('mutating');
  });
});

describe('evaluateToolSelection', () => {
  it('reports the executed choice from observation, keeping the three dimensions separate', async () => {
    const comparison = await evaluateToolSelection({ scope, actualOutcome: observedOutcome });

    expect(comparison.actual).toEqual({
      basis: 'observed',
      candidateId: id('alix_file_read'),
      label: 'alix_file_read',
      domain: 'builtin',
      outcome: { execution: 'success', selection: 'novel', evidence: 'none' },
    });
    // "successful call, no demonstrated evidence contribution" — not "useful".
    expect(comparison.notes).toContain('actual selection: execution recorded without demonstrated evidence contribution');
    expect(JSON.stringify(comparison)).not.toMatch(/better|worse|useful/);
  });

  it('reuses the observed outcome when an alternative ordering agrees with the executed choice', async () => {
    const replay = vi.fn<CounterfactualReplayRunner>();
    const comparison = await evaluateToolSelection({
      scope: { ...scope, scoperRanking: [{ candidateId: id('alix_file_read'), score: 5 }] },
      actualOutcome: observedOutcome,
      replay,
    });

    expect(comparison.scoperTop).toEqual({
      basis: 'observed',
      candidateId: id('alix_file_read'),
      label: 'alix_file_read',
      domain: 'builtin',
      outcome: observedOutcome,
    });
    expect(replay).not.toHaveBeenCalled();
  });

  it('replays a hermetic alternative through the supplied runner', async () => {
    const replay: CounterfactualReplayRunner = vi.fn(async () => ({
      replayId: 'replay_1',
      outcome: { execution: 'success' as const, selection: 'novel' as const, evidence: 'contributed' as const },
    }));
    const comparison = await evaluateToolSelection({ scope, actualOutcome: observedOutcome, replay });

    expect(comparison.scoperTop).toEqual({
      basis: 'replayed',
      candidateId: id('alix_grep_search'),
      label: 'alix_grep_search',
      domain: 'builtin',
      outcome: { execution: 'success', selection: 'novel', evidence: 'contributed' },
      replayId: 'replay_1',
    });
    expect(replay).toHaveBeenCalledWith({
      scopeId: 'scope_7',
      candidateId: id('alix_grep_search'),
      domain: 'builtin',
    });
  });

  it('refuses to replay a mutating alternative, even when a runner exists', async () => {
    const replay = vi.fn<CounterfactualReplayRunner>();
    const comparison = await evaluateToolSelection({
      scope: { ...scope, scoperRanking: [{ candidateId: id('alix_patch_apply'), score: 9 }] },
      actualOutcome: observedOutcome,
      replay,
    });

    expect(comparison.scoperTop).toEqual({
      basis: 'unknown',
      candidateId: id('alix_patch_apply'),
      label: 'alix_patch_apply',
      domain: 'builtin',
      reason: 'mutating tool: replay requires an isolated snapshot',
    });
    expect(replay).not.toHaveBeenCalled();
  });

  it('leaves an external alternative unknown rather than reaching the network', async () => {
    const comparison = await evaluateToolSelection({
      scope: { ...scope, scoperRanking: [{ candidateId: mcpId, score: 4 }] },
      actualOutcome: observedOutcome,
    });

    expect(comparison.scoperTop).toEqual({
      basis: 'unknown',
      candidateId: mcpId,
      label: 'demo/echo',
      domain: 'mcp',
      reason: 'external tool: replay requires fixtures or recorded responses',
    });
  });

  it('marks the actual choice unknown when the trace carries no outcome', async () => {
    const comparison = await evaluateToolSelection({ scope });
    expect(comparison.actual).toEqual({
      basis: 'unknown',
      candidateId: id('alix_file_read'),
      label: 'alix_file_read',
      domain: 'builtin',
      reason: 'no recorded outcome for the executed choice',
    });
  });

  it('records agreement between the scoper and selector orderings without ranking them', async () => {
    const comparison = await evaluateToolSelection({
      scope,
      actualOutcome: observedOutcome,
      selectorRanking: [id('alix_grep_search'), id('alix_file_read')],
      selectorId: 'jev-stub',
    });

    expect(comparison.notes).toContain(
      `scoper and jev-stub orderings agree on ${id('alix_grep_search')}`,
    );
    expect(comparison.selectorTop?.basis).toBe('unknown'); // no runner supplied
    expect(comparison.selectorId).toBe('jev-stub');
  });

  it('records disagreement factually', async () => {
    const comparison = await evaluateToolSelection({
      scope,
      actualOutcome: observedOutcome,
      selectorRanking: [id('alix_file_read'), id('alix_grep_search')],
      selectorId: 'jev-stub',
    });
    expect(comparison.notes).toContain(
      `orderings differ: scoper top ${id('alix_grep_search')} (relevance, not next-tool preference), jev-stub top ${id('alix_file_read')}`,
    );
  });
});

describe('selectionOutcomeFromObservation', () => {
  it('maps a recorded observation payload and rejects incomplete ones', () => {
    expect(selectionOutcomeFromObservation({
      execution: { status: 'success' },
      selection: { outcome: 'novel' },
      evidence: { contribution: 'contributed' },
    })).toEqual({ execution: 'success', selection: 'novel', evidence: 'contributed' });

    expect(selectionOutcomeFromObservation({ execution: { status: 'success' } })).toBeUndefined();
    expect(selectionOutcomeFromObservation({
      execution: { status: 'exploded' },
      selection: { outcome: 'novel' },
      evidence: { contribution: 'none' },
    })).toBeUndefined();
  });
});
