/**
 * T2-f: experiment-only Jev scorer. The load-bearing invariants are the
 * projection's anti-leakage rule and the strictness of the score contract.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  POST_SELECTION_FIELDS,
  TOOL_SELECTION_PROJECTOR_VERSION,
  assertNoPostSelectionFields,
  createJevExperimentScorer,
  projectToolSelectionCandidate,
  TOOL_SELECTION_JEV_MAPPING,
  TOOL_SELECTION_JEV_QUESTION_ID,
  createJevToolSelectionScorer,
  readToolSelectionProjection,
  renderToolSelectionState,
  type ExperimentScoreRecord,
  type ToolSelectionProjection,
} from '../../src/decision/tool-selection-experiment.js';
import {
  TOOL_SELECTION_EXPERIMENT,
  replayToolSelection,
  type ToolSelectionScope,
} from '../../src/decision/tool-selection-replay.js';
import { sealForRemote } from '../../src/decision/boundary.js';
import { createJevExecutor } from '../../src/decision/engines/jev.js';

const scope: ToolSelectionScope = {
  scopeId: 'scope_7',
  iteration: 7,
  offered: ['alix_file_read', 'alix_grep_search', 'alix_shell_run'],
  requirementCandidates: [{ tool: 'alix_shell_run', reasons: ['requirement:verification'] }],
  deterministicRanking: [
    { tool: 'alix_shell_run', score: 3 },
    { tool: 'alix_grep_search', score: 1 },
    { tool: 'alix_file_read', score: 0 },
  ],
  actualChoices: ['alix_file_read'],
  scoping: {
    admitted: [
      { tool: 'alix_file_read', reasons: ['core'] },
      { tool: 'alix_shell_run', reasons: ['relevance_match', 'requirement:verification'] },
    ],
    fallbackFull: false,
  },
};

function scoreExecutor(scores: Record<string, number | string>) {
  return {
    engineId: 'jev',
    async execute(input: { sealed: { payload: { candidate?: { tool?: string } } } }) {
      const tool = input.sealed.payload.candidate?.tool ?? '';
      const value = scores[tool];
      if (value === 'failure') return { kind: 'failure' as const, error: 'engine down' };
      if (value === 'choice') return { kind: 'choice' as const, choice: tool, provenance: { engineId: 'jev' } };
      if (value === 'noul') return { kind: 'noul' as const, probability: 0.5, provenance: { engineId: 'jev' } };
      if (value === undefined) return { kind: 'score' as const, score: 0.5, provenance: { engineId: 'jev' } };
      return { kind: 'score' as const, score: value as number, provenance: { engineId: 'jev' } };
    },
  };
}

describe('projectToolSelectionCandidate', () => {
  it('carries selection-time fields only', () => {
    const projection = projectToolSelectionCandidate({
      scope,
      tool: 'alix_shell_run',
      objective: 'Verify the four files exist',
      describeTool: () => 'Run a shell command',
    });

    expect(Object.keys(projection).sort()).toEqual([
      'candidate', 'experiment', 'objective', 'offeredTools', 'projectorVersion', 'requirementCandidates', 'scoping',
    ]);
    expect(projection.experiment).toBe(TOOL_SELECTION_EXPERIMENT);
    expect(projection.projectorVersion).toBe(TOOL_SELECTION_PROJECTOR_VERSION);
    expect(projection.candidate).toEqual({
      tool: 'alix_shell_run',
      description: 'Run a shell command',
      reasons: ['requirement:verification'],
    });
    expect(projection.scoping).toEqual({
      fallbackFull: false,
      admitted: ['alix_file_read', 'alix_shell_run'],
    });
  });

  it('never leaks the actual choice, its outcome, or the deterministic ranking', () => {
    const projection = projectToolSelectionCandidate({ scope, tool: 'alix_file_read' });
    const serialized = JSON.stringify(projection);
    for (const field of POST_SELECTION_FIELDS) {
      expect(serialized.includes(field), `projection leaked ${field}`).toBe(false);
    }
    // The scope's own post-selection values must not survive projection either.
    expect(serialized.includes('alix_file_read"')).toBe(true); // offered tool name only
    expect(projection.offeredTools).not.toContain('3');
  });

  it('projects only the frozen surface, so an opaque MCP handle cannot reach the boundary', () => {
    // Real trace shape: `offered` holds the builtin surface while `admitted`
    // also lists opaque MCP model handles, which the remote boundary's secret
    // gate rejects as handle-shaped strings.
    const opaqueHandle = 'mcp___bweCunehzWnFt6ZAhWZ2DBiXNGCFabYg8-2NQ3vj5w';
    const withHandles: ToolSelectionScope = {
      ...scope,
      scoping: {
        admitted: [...(scope.scoping?.admitted ?? []), { tool: opaqueHandle, reasons: ['relevance_match'] }],
        fallbackFull: false,
      },
    };
    const projection = projectToolSelectionCandidate({ scope: withHandles, tool: 'alix_file_read' });
    expect(projection.scoping?.admitted).toEqual(['alix_file_read', 'alix_shell_run']);
    expect(JSON.stringify(projection).includes(opaqueHandle)).toBe(false);

    // The load-bearing consequence: the payload clears the remote gate.
    expect(() =>
      sealForRemote(
        `experiment:${TOOL_SELECTION_EXPERIMENT}`,
        TOOL_SELECTION_PROJECTOR_VERSION,
        projection,
      ),
    ).not.toThrow();
    // The gate itself is real: a payload that *did* carry the handle is refused.
    expect(() =>
      sealForRemote(`experiment:${TOOL_SELECTION_EXPERIMENT}`, TOOL_SELECTION_PROJECTOR_VERSION, {
        ...projection,
        scoping: { fallbackFull: false, admitted: [opaqueHandle] },
      }),
    ).toThrow(/contains secret material/);
  });

  it('rejects a projection that has been contaminated', () => {
    expect(() => assertNoPostSelectionFields({ experiment: TOOL_SELECTION_EXPERIMENT, actualChoice: 'alix_file_read' }))
      .toThrow(/leaks post-selection fields: actualChoice/);
    expect(() => assertNoPostSelectionFields({ campaign: 'x', execution: { status: 'success' } }))
      .toThrow(/execution/);
    expect(() => assertNoPostSelectionFields({ experiment: TOOL_SELECTION_EXPERIMENT })).not.toThrow();
  });
});

describe('createJevExperimentScorer', () => {
  it('is sealed under the experiment subject and pins the projector version', async () => {
    const seen: Array<{ decision?: string; projectorVersion?: string }> = [];
    const executor = {
      engineId: 'jev',
      async execute(input: { sealed: { decision?: string; projectorVersion?: string } }) {
        seen.push({ decision: input.sealed.decision, projectorVersion: input.sealed.projectorVersion });
        return { kind: 'score' as const, score: 0.4, provenance: { engineId: 'jev' } };
      },
    };
    const selector = createJevExperimentScorer({ executor: executor as never, scope });

    const result = await selector.score({ scopeId: 'scope_7', iteration: 7, tool: 'alix_grep_search', domain: 'builtin', requirementCandidates: [] });

    expect(result).toEqual({ score: 0.4 });
    expect(seen[0]).toEqual({
      decision: `experiment:${TOOL_SELECTION_EXPERIMENT}`,
      projectorVersion: TOOL_SELECTION_PROJECTOR_VERSION,
    });
    expect(selector.id).toBe(`jev:${TOOL_SELECTION_EXPERIMENT}`);
  });

  it('refuses an unpinned projector version instead of comparing across versions', () => {
    expect(() => createJevExperimentScorer({
      executor: scoreExecutor({}) as never,
      scope,
      projectorVersion: 'tool-selection/v2',
    })).toThrow(/unsupported tool-selection projector version/);
  });

  it('records per-candidate provenance with a projection hash', async () => {
    const records: ExperimentScoreRecord[] = [];
    const selector = createJevExperimentScorer({
      executor: scoreExecutor({ alix_grep_search: 0.75 }) as never,
      scope,
      model: 'jev-test-model',
      onScore: (record) => records.push(record),
    });

    await selector.score({ scopeId: 'scope_7', iteration: 7, tool: 'alix_grep_search', domain: 'builtin', requirementCandidates: [] });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      experimentId: TOOL_SELECTION_EXPERIMENT,
      projectorVersion: TOOL_SELECTION_PROJECTOR_VERSION,
      scopeId: 'scope_7',
      candidate: 'alix_grep_search',
      engineId: 'jev',
      model: 'jev-test-model',
      score: 0.75,
    });
    // hashProjection returns a prefixed digest, not a bare hex string.
    expect(records[0].projectionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(records[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('changes the projection identity when the projector version changes', () => {
    const v1 = projectToolSelectionCandidate({ scope, tool: 'alix_file_read' });
    const other = projectToolSelectionCandidate({ scope, tool: 'alix_file_read', projectorVersion: 'tool-selection/v0-experiment' });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(v1));
    expect(other.projectorVersion).toBe('tool-selection/v0-experiment');
  });

  it('refuses choice, noul, failure, missing and out-of-range scores', async () => {
    const cases: Array<[string, string]> = [
      ['choice', 'selector returned choice, expected a bounded score'],
      ['noul', 'selector returned noul, expected a bounded score'],
      ['failure', 'engine down'],
      ['over', 'engine returned an out-of-range score for alix_file_read: 1.5'],
      ['nan', 'engine returned an out-of-range score for alix_file_read: NaN'],
    ];
    for (const [mode, expected] of cases) {
      const score = mode === 'over' || mode === 'nan' ? Number(mode === 'over' ? 1.5 : Number.NaN) : 0;
      const selector = createJevExperimentScorer({
        executor: scoreExecutor({
          alix_file_read: mode === 'over' || mode === 'nan' ? score : mode,
        }) as never,
        scope,
      });
      const result = await selector.score({ scopeId: 'scope_7', iteration: 7, tool: 'alix_file_read', domain: 'builtin', requirementCandidates: [] });
      expect(result).toEqual({ error: expected });
    }
  });

  it('feeds replayToolSelection without taking over sorting or set preservation', async () => {
    const onScore = vi.fn();
    const selector = createJevExperimentScorer({
      executor: scoreExecutor({ alix_file_read: 0.1, alix_grep_search: 0.9, alix_shell_run: 0.4 }) as never,
      scope,
      onScore,
    });

    const replay = await replayToolSelection(scope, selector);

    expect(replay.candidateSetPreserved).toBe(true);
    expect(replay.selectorId).toBe(`jev:${TOOL_SELECTION_EXPERIMENT}`);
    expect(replay.domains[0].ranking).toEqual(['alix_grep_search', 'alix_shell_run', 'alix_file_read']);
    // ALiX scores every offered candidate; the selector never sees the set.
    expect(onScore).toHaveBeenCalledTimes(3);
  });
});

/** A sealed projection for one candidate, as the scorer would build it. */
function sealCandidate(tool: string, projectorVersion = TOOL_SELECTION_PROJECTOR_VERSION) {
  const projection = projectToolSelectionCandidate({ scope, tool, objective: 'Verify the three files exist', projectorVersion });
  return sealForRemote(`experiment:${TOOL_SELECTION_EXPERIMENT}`, projectorVersion, projection);
}

describe('TOOL_SELECTION_JEV_MAPPING', () => {
  it('asks one Noul question keyed by the candidate, from the sealed payload', () => {
    const request = TOOL_SELECTION_JEV_MAPPING.toRequest(sealCandidate('alix_grep_search') as never);
    const question = request.questions[TOOL_SELECTION_JEV_QUESTION_ID];
    const state = String(request.state ?? '');
    expect(question?.type).toBe('noul');
    expect(state).toContain('alix_grep_search');
    expect(state).toContain('Verify the three files exist');
    // Selection-time state only: no outcome or ranking reaches the wire.
    for (const leaked of ['actualChoice', 'deterministicRanking', 'success']) {
      expect(state.includes(leaked), `state leaked ${leaked}`).toBe(false);
    }
  });

  it('maps a Noul answer to a bounded score and refuses malformed answers', () => {
    const ctx = { projectionHash: 'sha256:test', latencyMs: 3 };
    const scored = TOOL_SELECTION_JEV_MAPPING.fromResponse(
      { model: 'jev-test', answers: { [TOOL_SELECTION_JEV_QUESTION_ID]: { type: 'noul', noul: 0.8 } } },
      ctx,
    ) as { kind: string; score: number; provenance: { engineId: string; projectionHash: string } };
    expect(scored.kind).toBe('score');
    expect(scored.score).toBe(0.8);
    expect(scored.provenance.engineId).toBe('jev');
    expect(scored.provenance.projectionHash).toBe('sha256:test');

    expect(() =>
      TOOL_SELECTION_JEV_MAPPING.fromResponse(
        { answers: { [TOOL_SELECTION_JEV_QUESTION_ID]: { type: 'choice', choice: 'x' } as never } },
        ctx,
      ),
    ).toThrow(/missing noul answer/);
    expect(() =>
      TOOL_SELECTION_JEV_MAPPING.fromResponse(
        { answers: { [TOOL_SELECTION_JEV_QUESTION_ID]: { type: 'noul', noul: 1.4 } } },
        ctx,
      ),
    ).toThrow(/noul outside 0\.\.1/);
    expect(() => TOOL_SELECTION_JEV_MAPPING.fromResponse({}, ctx)).toThrow(/missing noul answer/);
  });

  it('refuses a payload from another experiment or another projector version', () => {
    const projection: ToolSelectionProjection = projectToolSelectionCandidate({ scope, tool: 'alix_file_read' });
    expect(() => readToolSelectionProjection({ ...projection, experiment: 'other-experiment' } as never))
      .toThrow(/not tool-selection-replay/);
    expect(() => readToolSelectionProjection({ ...projection, projectorVersion: 'tool-selection/v2' } as never))
      .toThrow(/not tool-selection\/v1/);
    expect(() => readToolSelectionProjection({ ...projection, candidate: {} } as never))
      .toThrow(/missing a candidate tool/);
  });

  it('renders every offered tool so the question is a comparison, not a lone candidate', () => {
    const rendered = renderToolSelectionState(projectToolSelectionCandidate({ scope, tool: 'alix_shell_run' }));
    for (const tool of scope.offered) expect(rendered).toContain(tool);
    expect(rendered).toContain('requirement:verification');
  });
});

describe('createJevToolSelectionScorer', () => {
  const noulTransport = (noul: number) => async () => ({
    model: 'jev-test',
    answers: { [TOOL_SELECTION_JEV_QUESTION_ID]: { type: 'noul' as const, noul } },
  });

  it('scores through the real adapter with the experiment mapping registered', async () => {
    const selector = createJevToolSelectionScorer({
      apiKey: 'test-key',
      scope,
      transport: noulTransport(0.75),
    });
    const result = await selector.score({
      scopeId: 'scope_7',
      iteration: 7,
      tool: 'alix_grep_search',
      domain: 'builtin',
      requirementCandidates: [],
    });
    expect(result).toEqual({ score: 0.75 });
    expect(selector.id).toBe(`jev:${TOOL_SELECTION_EXPERIMENT}`);
  });

  it('leaves a bare experiment subject failing closed when nothing is registered', async () => {
    const executor = createJevExecutor({
      enabled: true,
      apiKey: 'test-key',
      transport: noulTransport(0.9),
    });
    await expect(
      executor.execute({
        decision: `experiment:${TOOL_SELECTION_EXPERIMENT}`,
        sealed: sealCandidate('alix_file_read') as never,
        candidates: ['alix_file_read'],
      }),
    ).rejects.toThrow(/no experiment mapping registered/);
  });

  it('keeps the experiment mapping out of the runtime decision table', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const executor = createJevExecutor({
      enabled: true,
      apiKey: 'test-key',
      transport: async (request) => {
        seen.push(request.questions as Record<string, unknown>);
        return {
          model: 'jev-test',
          answers: {
            'claim-verdict': { type: 'choice' as const, choice: 'supported' },
            [TOOL_SELECTION_JEV_QUESTION_ID]: { type: 'noul' as const, noul: 0.9 },
          },
        };
      },
      experimentMappings: { [TOOL_SELECTION_EXPERIMENT]: TOOL_SELECTION_JEV_MAPPING },
    });
    // A runtime decision still answers its own question, never the experiment's.
    await executor.execute({
      decision: 'claim-verification',
      sealed: sealForRemote('claim-verification', 'v1', { claim: 'the file exists', evidence: [] }) as never,
      candidates: [],
    });
    expect(Object.keys(seen[0] ?? {})).toEqual(['claim-verdict']);
  });
});
