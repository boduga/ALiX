/**
 * T2-c: offline tool-selection replay. Replay-only — these tests use stub
 * selectors, so nothing here depends on Jev being reachable, and nothing in the
 * live loop imports the replay module.
 */
import { describe, it, expect } from 'vitest';
import {
  createEngineToolSelector,
  extractToolSelectionScopes,
  replayToolSelection,
  toolSelectionDomain,
  TOOL_SELECTION_EXPERIMENT,
  type ToolSelectionScope,
  type ToolSelectionSelector,
} from '../../src/decision/tool-selection-replay.js';

const scope: ToolSelectionScope = {
  scopeId: 'scope_7',
  iteration: 7,
  offered: ['alix_file_read', 'alix_grep_search', 'alix_shell_run', 'mcp__abc'],
  requirementCandidates: [{ tool: 'alix_shell_run', reasons: ['requirement:verification'] }],
  deterministicRanking: [
    { tool: 'alix_shell_run', score: 3 },
    { tool: 'alix_grep_search', score: 2 },
    { tool: 'alix_file_read', score: 0 },
    { tool: 'mcp__abc', score: 0 },
  ],
  actualChoices: ['alix_grep_search', 'alix_shell_run'],
};

function scoringSelector(id: string, scores: Record<string, number>): ToolSelectionSelector {
  return {
    id,
    async score(request) {
      const score = scores[request.tool];
      return score === undefined ? { error: `no score for ${request.tool}` } : { score };
    },
  };
}

describe('toolSelectionDomain', () => {
  it('separates the reserved mcp__ namespace from builtins', () => {
    expect(toolSelectionDomain('mcp__abc')).toBe('mcp');
    expect(toolSelectionDomain('alix_file_read')).toBe('builtin');
  });
});

describe('replayToolSelection', () => {
  it('produces a counterfactual ordering over the recorded candidate set', async () => {
    const selector = scoringSelector('jev-stub', {
      alix_file_read: 0.2,
      alix_grep_search: 0.1,
      alix_shell_run: 0.9,
      mcp__abc: 0.5,
    });

    const replay = await replayToolSelection(scope, selector);

    expect(replay.scopeId).toBe('scope_7');
    expect(replay.actualChoice).toBe('alix_grep_search');
    expect(replay.deterministicRanking).toEqual(['alix_shell_run', 'alix_grep_search', 'alix_file_read', 'mcp__abc']);
    expect(replay.domains).toHaveLength(2);
    // Domains are ranked separately: builtin scores never order MCP handles.
    expect(replay.domains[0]).toEqual({
      domain: 'builtin',
      ranking: ['alix_shell_run', 'alix_file_read', 'alix_grep_search'],
      candidateSetPreserved: true,
    });
    expect(replay.domains[1]).toEqual({ domain: 'mcp', ranking: ['mcp__abc'], candidateSetPreserved: true });
    expect(replay.candidateSetPreserved).toBe(true);
    expect(replay.invalidReason).toBeUndefined();
  });

  it('breaks ties in the offered order so equal scores stay deterministic', async () => {
    const selector = scoringSelector('ties', {
      alix_file_read: 0.5,
      alix_grep_search: 0.5,
      alix_shell_run: 0.5,
      mcp__abc: 0.5,
    });
    const replay = await replayToolSelection(scope, selector);
    expect(replay.domains[0].ranking).toEqual(['alix_file_read', 'alix_grep_search', 'alix_shell_run']);
  });

  it('invalidates the attempt when a candidate cannot be scored', async () => {
    const selector = scoringSelector('partial', {
      alix_file_read: 0.1,
      alix_grep_search: 0.1,
      mcp__abc: 0.1,
    });

    const replay = await replayToolSelection(scope, selector);

    expect(replay.candidateSetPreserved).toBe(false);
    expect(replay.invalidReason).toMatch(/alix_shell_run/);
    // No partial ordering is offered as a result.
    expect(replay.domains[0].ranking).toEqual([]);
  });

  it('invalidates a selector that returns a non-finite score', async () => {
    const selector: ToolSelectionSelector = {
      id: 'nan',
      async score() {
        return { score: Number.NaN };
      },
    };
    const replay = await replayToolSelection(scope, selector);
    expect(replay.candidateSetPreserved).toBe(false);
    expect(replay.invalidReason).toMatch(/non-finite/);
  });
});

describe('extractToolSelectionScopes', () => {
  it('joins observations by scopeId and keeps the choice sequence', () => {
    const events = [
      { type: 'agent.message', payload: { text: 'ignored' } },
      {
        type: 'tool.selection.observed',
        payload: { scopeId: 'scope_7', iteration: 7, offered: ['a', 'b'], chosen: 'b' },
      },
      { type: 'tool.selection.observed', payload: { scopeId: 'scope_7', iteration: 7, chosen: 'a' } },
      { type: 'tool.selection.observed', payload: { scopeId: 'scope_8', iteration: 9, offered: ['c'], chosen: 'c' } },
      { type: 'tool.selection.observed', payload: { iteration: 9, chosen: 'd' } },
    ];

    const scopes = extractToolSelectionScopes(events);

    expect(scopes.map(entry => entry.scopeId)).toEqual(['scope_7', 'scope_8']);
    expect(scopes[0].actualChoices).toEqual(['b', 'a']);
    // The first observation of a scope is authoritative for the frozen surface.
    expect(scopes[0].offered).toEqual(['a', 'b']);
    expect(scopes[1].iteration).toBe(9);
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

    const result = await selector.score({
      scopeId: 'scope_7',
      iteration: 7,
      tool: 'alix_file_read',
      domain: 'builtin',
      requirementCandidates: [],
    });

    expect(result).toEqual({ score: 0.7 });
    expect((seen[0] as { sealed?: string }).sealed).toBe('remote');
    // The seal identifies the experiment, not a runtime decision.
    expect((seen[0] as { decision?: string }).decision).toBe(`experiment:${TOOL_SELECTION_EXPERIMENT}`);
  });

  it('refuses a choice-shaped answer instead of coercing it into a score', async () => {
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

    const result = await selector.score({
      scopeId: 'scope_7',
      iteration: 7,
      tool: 'alix_file_read',
      domain: 'builtin',
      requirementCandidates: [],
    });

    expect(result).toEqual({ error: 'selector returned choice, expected a bounded score' });
  });
});
