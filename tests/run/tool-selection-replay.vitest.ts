/**
 * T2-c / T2-f1: offline tool-selection replay. Replay-only — these tests use
 * stub selectors, so nothing here depends on Jev being reachable, and nothing in
 * the live loop imports the replay module.
 *
 * Identity is the frozen `candidateId`; an MCP candidate is `mcp:<short hash>`
 * and its opaque handle lives only in the local binding.
 */
import { describe, it, expect } from 'vitest';
import {
  bindingForCandidate,
  createEngineToolSelector,
  extractToolSelectionScopes,
  replayToolSelection,
  toolSelectionDomain,
  TOOL_SELECTION_EXPERIMENT,
  type ToolSelectionScope,
  type ToolSelectionSelector,
} from '../../src/planning/decision/tool-selection-replay.js';
import { buildSelectionObservation } from '../../src/operations/observability/tool-selection-observation.js';
import {
  builtinNameOf,
  builtinCandidateId,
  candidateIdDomain,
  candidateIdFor,
  freezeToolCandidates,
} from '../../src/planning/decision/tool-selection-candidates.js';

const frozen = freezeToolCandidates({
  builtin: [
    { name: 'alix_file_read', description: 'Read a file' },
    { name: 'alix_grep_search', description: 'Search file contents' },
    { name: 'alix_shell_run', description: 'Run a shell command' },
  ],
  mcp: [{ name: 'mcp__abc', serverName: 'demo', toolName: 'echo', description: 'Echo text' }],
});

const scope: ToolSelectionScope = {
  scopeId: 'scope_7',
  iteration: 7,
  candidates: frozen.candidates,
  bindings: frozen.bindings,
  offered: frozen.candidates.map(candidate => candidate.candidateId),
  requirementCandidates: [
    { candidateId: builtinCandidateId('alix_shell_run'), reasons: ['requirement:verification'] },
  ],
  scoperRanking: [
    { candidateId: builtinCandidateId('alix_shell_run'), score: 3 },
    { candidateId: builtinCandidateId('alix_grep_search'), score: 2 },
    { candidateId: builtinCandidateId('alix_file_read'), score: 0 },
    { candidateId: candidateIdFor('mcp__abc'), score: 0 },
  ],
  actualCandidateIds: [builtinCandidateId('alix_grep_search'), builtinCandidateId('alix_shell_run')],
};

function rankingSelector(id: string, values: Record<string, number>): ToolSelectionSelector {
  return {
    id,
    async rank(request) {
      const value = values[request.candidateId];
      return value === undefined
        ? { error: `no ranking value for ${request.candidateId}` }
        : { rankValue: value };
    },
  };
}

describe('toolSelectionDomain', () => {
  it('separates the reserved mcp__ namespace from builtins', () => {
    expect(toolSelectionDomain('mcp__abc')).toBe('mcp');
    expect(toolSelectionDomain('alix_file_read')).toBe('builtin');
  });
});

describe('freezeToolCandidates', () => {
  it('freezes identities and keeps handles in the local binding only', () => {
    const mcpCandidate = frozen.candidates.find(candidate => candidate.domain === 'mcp');
    expect(mcpCandidate).toMatchObject({ domain: 'mcp', label: 'demo/echo' });
    expect(mcpCandidate?.tool).toBeUndefined();
    expect(mcpCandidate?.candidateId).toMatch(/^mcp:[0-9a-f]{6}$/);
    // The handle is reachable locally, and only locally.
    expect(
      frozen.bindings.find(entry => entry.candidateId === mcpCandidate?.candidateId)?.modelName,
    ).toBe('mcp__abc');
    expect(JSON.stringify({ candidates: frozen.candidates }).includes('mcp__abc')).toBe(false);
  });

  it('treats the same offered name twice as one candidate', () => {
    // The model-facing list is a set for selection purposes: the same tool
    // offered twice (a fixture artifact, or a re-admitted tool) is one
    // candidate, not a surface that grew.
    const surface = freezeToolCandidates({
      builtin: [{ name: 'alix_file_read' }, { name: 'alix_file_read' }],
    });
    expect(surface.candidates).toHaveLength(1);
    expect(surface.bindings).toHaveLength(1);
  });

  it('keeps two distinct handles apart', () => {
    const surface = freezeToolCandidates({
      builtin: [],
      mcp: [
        { name: 'mcp__abc', serverName: 'demo', toolName: 'echo' },
        { name: 'mcp__def', serverName: 'demo', toolName: 'echo' },
      ],
    });
    expect(new Set(surface.candidates.map(candidate => candidate.candidateId)).size).toBe(2);
  });

  it('exposes inverse lookups so callers never hand-parse a candidate id', () => {
    expect(candidateIdDomain(builtinCandidateId('alix_file_read'))).toBe('builtin');
    expect(candidateIdDomain(candidateIdFor('mcp__abc'))).toBe('mcp');
    expect(builtinNameOf(builtinCandidateId('alix_file_read'))).toBe('alix_file_read');
    // An MCP id carries a digest only — the handle lives in the binding.
    expect(builtinNameOf(candidateIdFor('mcp__abc'))).toBeUndefined();
  });
});

describe('replayToolSelection', () => {
  it('produces a counterfactual ordering over the recorded candidate set', async () => {
    const selector = rankingSelector('jev-stub', {
      [builtinCandidateId('alix_file_read')]: 0.2,
      [builtinCandidateId('alix_grep_search')]: 0.1,
      [builtinCandidateId('alix_shell_run')]: 0.9,
      [candidateIdFor('mcp__abc')]: 0.5,
    });

    const replay = await replayToolSelection(scope, selector);

    expect(replay.scopeId).toBe('scope_7');
    expect(replay.actualCandidateId).toBe(builtinCandidateId('alix_grep_search'));
    expect(replay.scoperRanking).toEqual([
      builtinCandidateId('alix_shell_run'),
      builtinCandidateId('alix_grep_search'),
      builtinCandidateId('alix_file_read'),
      candidateIdFor('mcp__abc'),
    ]);
    expect(replay.domains).toHaveLength(2);
    // Domains are ranked separately: builtin values never order MCP candidates.
    expect(replay.domains[0]).toEqual({
      domain: 'builtin',
      ranking: [
        builtinCandidateId('alix_shell_run'),
        builtinCandidateId('alix_file_read'),
        builtinCandidateId('alix_grep_search'),
      ],
      candidateSetPreserved: true,
    });
    expect(replay.domains[1]).toEqual({
      domain: 'mcp',
      ranking: [candidateIdFor('mcp__abc')],
      candidateSetPreserved: true,
    });
    expect(replay.candidateSetPreserved).toBe(true);
    expect(replay.invalidReason).toBeUndefined();
  });

  it('breaks ties in the offered order so equal values stay deterministic', async () => {
    const selector = rankingSelector('ties', {
      [builtinCandidateId('alix_file_read')]: 0.5,
      [builtinCandidateId('alix_grep_search')]: 0.5,
      [builtinCandidateId('alix_shell_run')]: 0.5,
      [candidateIdFor('mcp__abc')]: 0.5,
    });
    const replay = await replayToolSelection(scope, selector);
    expect(replay.domains[0].ranking).toEqual([
      builtinCandidateId('alix_file_read'),
      builtinCandidateId('alix_grep_search'),
      builtinCandidateId('alix_shell_run'),
    ]);
  });

  it('invalidates the attempt when a candidate cannot be ranked', async () => {
    const selector = rankingSelector('partial', {
      [builtinCandidateId('alix_file_read')]: 0.1,
      [builtinCandidateId('alix_grep_search')]: 0.1,
      [candidateIdFor('mcp__abc')]: 0.1,
    });

    const replay = await replayToolSelection(scope, selector);

    expect(replay.candidateSetPreserved).toBe(false);
    expect(replay.invalidReason).toMatch(/builtin:alix_shell_run/);
    // No partial ordering is offered as a result — including the domain that
    // scored cleanly, which must not read as a complete ordering.
    expect(replay.domains[0].ranking).toEqual([]);
    expect(replay.domains[1].ranking).toEqual([]);
    expect(replay.domains[1].candidateSetPreserved).toBe(false);
    expect(replay.selectorRanking).toEqual([]);
  });

  it('invalidates a selector that returns a non-finite ranking value', async () => {
    const selector: ToolSelectionSelector = {
      id: 'nan',
      async rank() {
        return { rankValue: Number.NaN };
      },
    };
    const replay = await replayToolSelection(scope, selector);
    expect(replay.candidateSetPreserved).toBe(false);
    expect(replay.invalidReason).toMatch(/non-finite/);
  });
});

describe('extractToolSelectionScopes', () => {
  it('ignores not-applicable coverage records for selector statistics', () => {
    const scopes = extractToolSelectionScopes([
      {
        type: 'tool.selection.not_applicable',
        payload: {
          scopeId: 'coverage_only',
          iteration: 4,
          route: 'grounded',
          reason: 'no_tool_call',
        },
      },
      {
        type: 'tool.selection.observed',
        payload: {
          scopeId: 'selector_sample',
          iteration: 4,
          offered: ['builtin:alix_file_read'],
          chosenCandidateId: 'builtin:alix_file_read',
        },
      },
    ]);

    expect(scopes.map(entry => entry.scopeId)).toEqual(['selector_sample']);
  });

  it('joins observations by scopeId and keeps the choice sequence', () => {
    const candidates = freezeToolCandidates({
      builtin: [{ name: 'alix_file_read' }, { name: 'alix_grep_search' }],
    });
    const [first, second] = candidates.candidates.map(candidate => candidate.candidateId);
    const events = [
      { type: 'agent.message', payload: { text: 'ignored' } },
      {
        type: 'tool.selection.observed',
        payload: {
          scopeId: 'scope_7',
          iteration: 7,
          candidates: candidates.candidates,
          candidateBindings: candidates.bindings,
          offered: [first, second],
          chosenCandidateId: second,
        },
      },
      {
        type: 'tool.selection.observed',
        payload: { scopeId: 'scope_7', iteration: 7, chosenCandidateId: first },
      },
      {
        type: 'tool.selection.observed',
        payload: {
          scopeId: 'scope_8',
          iteration: 9,
          offered: ['builtin:other'],
          chosenCandidateId: 'builtin:other',
        },
      },
      { type: 'tool.selection.observed', payload: { iteration: 9, chosenCandidateId: 'builtin:orphan' } },
    ];

    const scopes = extractToolSelectionScopes(events);

    expect(scopes.map(entry => entry.scopeId)).toEqual(['scope_7', 'scope_8']);
    expect(scopes[0].actualCandidateIds).toEqual([second, first]);
    // The first observation of a scope is authoritative for the frozen surface.
    expect(scopes[0].offered).toEqual([first, second]);
    expect(scopes[0].candidates).toHaveLength(2);
    expect(scopes[1].iteration).toBe(9);
  });

  it('recovers MCP bindings from a scope built by the real emitter', () => {
    // The emitter serialises bindings as `candidateBindings`. This round-trips
    // an ACTUAL `buildSelectionObservation` payload through the reader so the
    // two field names can never drift apart again — a hand-built payload with
    // the reader's own field name would pass even while the reader was wrong.
    const observed = buildSelectionObservation({
      scopeId: 'scope_mcp',
      iteration: 1,
      candidates: frozen.candidates,
      candidateBindings: frozen.bindings,
      chosen: 'mcp__abc',
      chosenCandidateId: candidateIdFor('mcp__abc'),
      executor: 'mcp.demo.echo',
      argsSignature: 'mcp.demo.echo:sig',
      seenSignatures: new Map<string, number>(),
      executorSuccess: true,
    });

    const [rebuilt] = extractToolSelectionScopes([
      { type: 'tool.selection.observed', payload: observed },
    ]);

    const mcpId = candidateIdFor('mcp__abc');
    expect(rebuilt.bindings).toBeDefined();
    // Only the binding can turn a digest id back into a handle: the candidate
    // itself deliberately carries no handle.
    expect(rebuilt.candidates.find(c => c.candidateId === mcpId)?.tool).toBeUndefined();
    expect(bindingForCandidate(rebuilt, mcpId)?.modelName).toBe('mcp__abc');
  });
});

describe('createEngineToolSelector', () => {
  it('accepts bounded score outcomes and seals each request', async () => {
    const seen: unknown[] = [];
    const executor = {
      engineId: 'jev-stub',
      async execute(input: { sealed: unknown }) {
        seen.push(input.sealed);
        return { kind: 'score' as const, score: 0.7, provenance: { engineId: 'jev-stub' } };
      },
    };
    const selector = createEngineToolSelector(executor as never, {
      subject: { kind: 'experiment', experimentId: TOOL_SELECTION_EXPERIMENT },
      projectorVersion: 'test-1',
    });

    const result = await selector.rank({
      scopeId: 'scope_7',
      iteration: 7,
      candidateId: builtinCandidateId('alix_file_read'),
      domain: 'builtin',
      requirementCandidates: [],
    });

    expect(result).toEqual({ rankValue: 0.7 });
    expect((seen[0] as { sealed?: string }).sealed).toBe('remote');
    // The seal identifies the experiment, not a runtime decision.
    expect((seen[0] as { decision?: string }).decision).toBe(`experiment:${TOOL_SELECTION_EXPERIMENT}`);
  });

  it('refuses a choice-shaped answer instead of coercing it into a ranking value', async () => {
    const executor = {
      engineId: 'choice-only',
      async execute() {
        return { kind: 'choice' as const, choice: 'alix_file_read', provenance: { engineId: 'choice-only' } };
      },
    };
    const selector = createEngineToolSelector(executor as never, {
      subject: { kind: 'experiment', experimentId: TOOL_SELECTION_EXPERIMENT },
      projectorVersion: 'test-1',
    });

    const result = await selector.rank({
      scopeId: 'scope_7',
      iteration: 7,
      candidateId: builtinCandidateId('alix_file_read'),
      domain: 'builtin',
      requirementCandidates: [],
    });

    expect(result).toEqual({ error: 'selector returned choice, expected a bounded score' });
  });
});
