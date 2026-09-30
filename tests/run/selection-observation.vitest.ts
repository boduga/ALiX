/**
 * T0-b: shadow tool-selection observation. Instrumentation only — these tests
 * pin the labels a later selector comparison depends on.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRequirementCandidates,
  buildSelectionObservation,
  rankingOutsideOffered,
  unexplainedRequirementCandidates,
} from '../../src/run/task-loop/predicates.js';
import {
  builtinCandidateId,
  freezeToolCandidates,
} from '../../src/decision/tool-selection-candidates.js';

const frozen = freezeToolCandidates({
  builtin: [
    { name: 'alix_file_read', description: 'Read a file' },
    { name: 'alix_grep_search', description: 'Search file contents' },
    { name: 'alix_shell_run', description: 'Run a shell command' },
    { name: 'alix_coordination_run', description: 'Run coordinated workers' },
  ],
});

const id = builtinCandidateId;

function observe(overrides: Partial<Parameters<typeof buildSelectionObservation>[0]> = {}) {
  return buildSelectionObservation({
    scopeId: 'scope_1',
    iteration: 0,
    invocationId: 'inv-1',
    candidates: frozen.candidates,
    candidateBindings: frozen.bindings,
    chosen: 'alix_file_read',
    chosenCandidateId: id('alix_file_read'),
    executor: 'file.read',
    argsSignature: 'file.read:{"path":"a.ts"}',
    seenSignatures: new Map(),
    executorSuccess: true,
    hasContent: true,
    ...overrides,
  });
}

describe('buildSelectionObservation', () => {
  it('records the frozen surface, the choice, and the executor', () => {
    const observation = observe();
    // Replay joins scopes to selector results on scopeId, not on iteration.
    expect(observation.scopeId).toBe('scope_1');
    expect(observation.offered).toEqual(frozen.candidates.map(candidate => candidate.candidateId));
    expect(observation.candidates).toHaveLength(4);
    expect(observation.chosen).toBe('alix_file_read');
    expect(observation.chosenCandidateId).toBe(id('alix_file_read'));
    expect(observation.executor).toBe('file.read');
    expect(observation.invocationId).toBe('inv-1');
  });

  it('records an MCP candidate as an identity plus label, never as a handle', () => {
    const withMcp = freezeToolCandidates({
      builtin: [{ name: 'alix_file_read' }],
      mcp: [{ name: 'mcp__opaque', serverName: 'github', toolName: 'search.code', description: 'Search code' }],
    });
    const observation = observe({
      candidates: withMcp.candidates,
      candidateBindings: withMcp.bindings,
      chosen: 'alix_file_read',
      chosenCandidateId: id('alix_file_read'),
    });
    const mcpId = withMcp.candidates.find(candidate => candidate.domain === 'mcp')?.candidateId;
    expect(observation.offered).toContain(mcpId);
    expect(JSON.stringify(observation.candidates).includes('mcp__opaque')).toBe(false);
    // The handle survives only in the local binding.
    expect(observation.candidateBindings?.find(entry => entry.candidateId === mcpId)?.modelName)
      .toBe('mcp__opaque');
  });

  it('masks a chosen MCP handle, not just a candidate one', () => {
    // The F4 invariant is "raw mcp__ handle -> never serialized into a frozen
    // scope". `chosen` is the field that carried the handle the model actually
    // emitted, so masking only `candidates` left the real leak in place.
    const withMcp = freezeToolCandidates({
      builtin: [{ name: 'alix_file_read' }],
      mcp: [{ name: 'mcp__opaque', serverName: 'github', toolName: 'search.code', description: 'Search code' }],
    });
    const mcpId = withMcp.candidates.find(candidate => candidate.domain === 'mcp')!.candidateId;
    const observation = observe({
      candidates: withMcp.candidates,
      candidateBindings: withMcp.bindings,
      chosen: 'mcp__opaque',
      chosenCandidateId: mcpId,
    });

    expect(observation.chosen).toBe(mcpId);
    expect(observation.chosen).not.toContain('mcp__');
    // No field outside the LOCAL-ONLY binding may carry the handle.
    const { candidateBindings: _localOnly, ...projected } = observation;
    expect(JSON.stringify(projected).includes('mcp__opaque')).toBe(false);
    // ...and the handle is still recoverable locally.
    expect(observation.candidateBindings?.find(entry => entry.candidateId === mcpId)?.modelName)
      .toBe('mcp__opaque');
  });

  it('leaves a chosen builtin name readable', () => {
    // The grounded route's `chosen` is the provider-facing name it normalised
    // to; masking every domain would destroy that.
    const observation = observe({ chosen: 'alix_file_read', chosenCandidateId: id('alix_file_read') });
    expect(observation.chosen).toBe('alix_file_read');
  });

  it('separates mechanical outcome, selection outcome, and evidence contribution', () => {
    const observation = observe();
    expect(observation.execution.status).toBe('success');
    expect(observation.selection).toEqual({ outcome: 'novel', repeatCount: 1 });
    expect(observation.evidence.contribution).toBe('contributed');
  });

  it('labels a repeated identical call redundant without claiming contribution', () => {
    const seen = new Map<string, number>();
    observe({ seenSignatures: seen });
    const second = observe({ seenSignatures: seen });
    expect(second.selection).toEqual({ outcome: 'redundant', repeatCount: 2 });
    expect(second.execution.status).toBe('success');
    // Repeat is a selection property, not an evidence claim.
    expect(second.evidence.contribution).toBe('contributed');
  });

  it('reports a repaired call as a repaired execution, not a success', () => {
    expect(observe({ repaired: true }).execution.status).toBe('repaired');
  });

  it('reports failures and provable no-ops as no evidence contribution', () => {
    const seen = new Map<string, number>([['file.read:{"path":"a.ts"}', 1]]);
    const observation = observe({ seenSignatures: seen, executorSuccess: false });
    expect(observation.execution.status).toBe('failed');
    expect(observation.evidence.contribution).toBe('none');

    expect(observe({ noOp: true }).evidence.contribution).toBe('none');
  });

  it('says unknown when a successful call carried no content to judge', () => {
    expect(observe({ hasContent: false }).evidence.contribution).toBe('unknown');
  });
});

describe('buildRequirementCandidates', () => {
  it('maps each detected requirement to the tools that could close it', () => {
    const candidates = buildRequirementCandidates({ mutation: true, verification: true, coordination: true });
    const byTool = new Map(candidates.map(candidate => [candidate.tool, candidate.reasons]));
    expect(byTool.get('alix_file_create')).toEqual(['requirement:mutation']);
    expect(byTool.get('alix_patch_apply')).toEqual(['requirement:mutation']);
    expect(byTool.get('alix_file_delete')).toEqual(['requirement:mutation']);
    expect(byTool.get('alix_verify_claim')).toEqual(['requirement:verification']);
    expect(byTool.get('alix_shell_run')).toEqual(['requirement:verification']);
    expect(byTool.get('alix_coordination_run')).toEqual(['requirement:coordination']);
  });

  it('returns nothing when no requirement was detected', () => {
    expect(buildRequirementCandidates({ mutation: false, verification: false, coordination: false })).toEqual([]);
  });

  it('merges reasons when one tool closes two requirements', () => {
    // shell.run is the default verification command; a mutation+verification
    // objective must not duplicate the entry.
    const candidates = buildRequirementCandidates({ mutation: true, verification: true, coordination: false });
    expect(candidates.filter(candidate => candidate.tool === 'alix_shell_run')).toHaveLength(1);
  });
});

describe('requirement-closing tools cannot vanish without provenance', () => {
  const requirementCandidates = buildRequirementCandidates({ mutation: false, verification: false, coordination: true });

  it('reports a candidate missing from the offered surface with no recorded exclusion', () => {
    const observation = observe({
      candidates: frozen.candidates.filter(candidate => candidate.tool !== 'alix_coordination_run'),
      requirementCandidates,
      scoping: {
        admitted: [{ candidateId: id('alix_file_read'), reasons: ['core'] }],
        fallbackFull: false,
      },
    });
    expect(unexplainedRequirementCandidates(observation)).toEqual([id('alix_coordination_run')]);
  });

  it('accepts a documented exclusion (debug mode) as provenance', () => {
    const observation = observe({
      candidates: frozen.candidates.filter(candidate => candidate.tool !== 'alix_coordination_run'),
      requirementCandidates,
      scoping: {
        admitted: [{ candidateId: id('alix_file_read'), reasons: ['core'] }],
        fallbackFull: false,
        excluded: [{ candidateId: id('alix_coordination_run'), reasons: ['not_relevant'] }],
      },
    });
    expect(unexplainedRequirementCandidates(observation)).toEqual([]);
  });

  it('accepts an offered candidate, and merges requirement reasons into scoping', () => {
    const observation = observe({
      requirementCandidates,
      scoping: {
        admitted: [
          { candidateId: id('alix_file_read'), reasons: ['core'] },
          { candidateId: id('alix_coordination_run'), reasons: ['relevance_match'] },
        ],
        fallbackFull: false,
      },
    });
    expect(unexplainedRequirementCandidates(observation)).toEqual([]);
    expect(observation.scoping.admitted.find(entry => entry.candidateId === id('alix_coordination_run'))?.reasons)
      .toEqual(['relevance_match', 'requirement:coordination']);
  });
});

describe('recorded deterministic ranking', () => {
  it('carries the production ordering and scores', () => {
    const observation = observe({
      ranking: {
        scoper: [
          { candidateId: id('alix_grep_search'), score: 3 },
          { candidateId: id('alix_file_read'), score: 0 },
        ],
        mcpSelector: [{ candidateId: 'mcp:abc123', score: 7 }],
      },
    });
    expect(observation.ranking.scoper).toEqual([
      { candidateId: id('alix_grep_search'), score: 3 },
      { candidateId: id('alix_file_read'), score: 0 },
    ]);
    // MCP scores come from a different scorer and are never interleaved.
    expect(observation.ranking.mcpSelector).toEqual([{ candidateId: 'mcp:abc123', score: 7 }]);
    // The subset invariant applies to the deterministic ranking only: MCP
    // entries beyond the offered surface are expected (selector truncation) and
    // are a separate question from a builtin ranked but never offered.
    expect(rankingOutsideOffered(observation)).toEqual([]);
  });

  it('defaults to an empty ranking when the caller records none', () => {
    expect(observe().ranking).toEqual({ scoper: [] });
  });

  it('flags a candidate ranked but never offered (the recorded surface must be real)', () => {
    const observation = observe({
      candidates: frozen.candidates.filter(candidate => candidate.tool !== 'alix_grep_search'),
      ranking: { scoper: [{ candidateId: id('alix_grep_search'), score: 2 }] },
    });
    expect(rankingOutsideOffered(observation)).toEqual([id('alix_grep_search')]);
  });
});
