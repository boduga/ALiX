/**
 * T2-f / T2-f1: experiment-only Jev scorer. The load-bearing invariants are the
 * projection's anti-leakage rule (selection-time fields only, candidate
 * identities only) and the strictness of the ranking contract: a Noul
 * probability in, a bounded ranking value out, anything else refused.
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
  type ExperimentRankingRecord,
  type ToolSelectionProjection,
} from '../../src/decision/tool-selection-experiment.js';
import {
  TOOL_SELECTION_EXPERIMENT,
  replayToolSelection,
  type ToolSelectionScope,
} from '../../src/decision/tool-selection-replay.js';
import {
  builtinCandidateId,
  candidateIdFor,
  freezeToolCandidates,
} from '../../src/decision/tool-selection-candidates.js';
import { sealForRemote } from '../../src/decision/boundary.js';
import { createJevExecutor } from '../../src/decision/engines/jev.js';

const frozen = freezeToolCandidates({
  builtin: [
    { name: 'alix_file_read', description: 'Read a file' },
    { name: 'alix_grep_search', description: 'Search file contents' },
    { name: 'alix_shell_run', description: 'Run a shell command' },
  ],
  mcp: [
    {
      name: 'mcp___bweCunehzWnFt6ZAhWZ2DBiXNGCFabYg8-2NQ3vj5w',
      serverName: 'github',
      toolName: 'search.code',
      description: 'Search repository code',
    },
  ],
});

const mcpCandidate = frozen.candidates.find(candidate => candidate.domain === 'mcp')!;

const scope: ToolSelectionScope = {
  scopeId: 'scope_7',
  iteration: 7,
  candidates: frozen.candidates,
  bindings: frozen.bindings,
  offered: frozen.candidates.map(candidate => candidate.candidateId),
  requirementCandidates: [
    { candidateId: builtinCandidateId('alix_shell_run'), reasons: ['requirement:verification'] },
  ],
  deterministicRanking: [
    { candidateId: builtinCandidateId('alix_shell_run'), score: 3 },
    { candidateId: builtinCandidateId('alix_grep_search'), score: 1 },
    { candidateId: builtinCandidateId('alix_file_read'), score: 0 },
  ],
  actualCandidateIds: [builtinCandidateId('alix_file_read')],
  scoping: {
    admitted: [
      { candidateId: builtinCandidateId('alix_file_read'), reasons: ['core'] },
      { candidateId: builtinCandidateId('alix_shell_run'), reasons: ['relevance_match', 'requirement:verification'] },
    ],
    fallbackFull: false,
  },
};

/** Engine stub: one native Noul probability per candidate id. */
function noulExecutor(probabilities: Record<string, number | string>) {
  return {
    engineId: 'jev',
    async execute(input: { sealed: { payload: { candidate?: { candidateId?: string } } } }) {
      const candidateId = input.sealed.payload.candidate?.candidateId ?? '';
      const value = probabilities[candidateId];
      if (value === 'failure') return { kind: 'failure' as const, error: 'engine down' };
      if (value === 'choice') return { kind: 'choice' as const, choice: candidateId, provenance: { engineId: 'jev' } };
      if (value === 'score') return { kind: 'score' as const, score: 0.5, provenance: { engineId: 'jev' } };
      if (value === undefined) return { kind: 'noul' as const, probability: 0.5, provenance: { engineId: 'jev' } };
      return { kind: 'noul' as const, probability: value as number, provenance: { engineId: 'jev' } };
    },
  };
}

function sealCandidate(candidateId: string, projectorVersion = TOOL_SELECTION_PROJECTOR_VERSION) {
  const projection = projectToolSelectionCandidate({
    scope,
    candidateId,
    objective: 'Verify the three files exist',
    projectorVersion,
  });
  return sealForRemote(`experiment:${TOOL_SELECTION_EXPERIMENT}`, projectorVersion, projection);
}

describe('projectToolSelectionCandidate', () => {
  it('carries selection-time, identity-only fields', () => {
    const projection = projectToolSelectionCandidate({
      scope,
      candidateId: builtinCandidateId('alix_shell_run'),
      objective: 'Verify the three files exist',
    });

    expect(Object.keys(projection).sort()).toEqual([
      'candidate', 'experiment', 'objective', 'offered', 'projectorVersion', 'requirementCandidates', 'scoping',
    ]);
    expect(projection.experiment).toBe(TOOL_SELECTION_EXPERIMENT);
    expect(projection.projectorVersion).toBe(TOOL_SELECTION_PROJECTOR_VERSION);
    expect(projection.candidate).toEqual({
      candidateId: builtinCandidateId('alix_shell_run'),
      label: 'alix_shell_run',
      description: 'Run a shell command',
      reasons: ['requirement:verification'],
    });
    expect(projection.scoping).toEqual({
      fallbackFull: false,
      admitted: [builtinCandidateId('alix_file_read'), builtinCandidateId('alix_shell_run')],
    });
  });

  it('never carries an executable identifier for an MCP candidate', () => {
    const projection = projectToolSelectionCandidate({ scope, candidateId: mcpCandidate.candidateId });
    expect(projection.candidate.candidateId).toBe(mcpCandidate.candidateId);
    expect(projection.candidate.label).toBe('github/search.code');
    expect(JSON.stringify(projection).includes('mcp__')).toBe(false);
  });

  it('never leaks the actual choice, its outcome, or the deterministic ranking', () => {
    const projection = projectToolSelectionCandidate({ scope, candidateId: builtinCandidateId('alix_file_read') });
    const serialized = JSON.stringify(projection);
    for (const field of POST_SELECTION_FIELDS) {
      expect(serialized.includes(field), `projection leaked ${field}`).toBe(false);
    }
  });

  it('rejects a projection that has been contaminated', () => {
    expect(() => assertNoPostSelectionFields({ experiment: TOOL_SELECTION_EXPERIMENT, actualChoice: 'x' }))
      .toThrow(/leaks post-selection fields: actualChoice/);
    expect(() => assertNoPostSelectionFields({ campaign: 'x', execution: { status: 'success' } }))
      .toThrow(/execution/);
    expect(() => assertNoPostSelectionFields({ experiment: TOOL_SELECTION_EXPERIMENT })).not.toThrow();
  });

  it('refuses a candidate that is not on the frozen surface', () => {
    expect(() => projectToolSelectionCandidate({ scope, candidateId: 'builtin:alix_nope' }))
      .toThrow(/not on the frozen surface/);
  });

  it('projects only the frozen surface, so an opaque MCP handle cannot reach the boundary', () => {
    // Real trace shape before T2-f1: `admitted` also listed opaque handles that
    // the remote boundary's secret gate rejects as handle-shaped strings.
    const opaqueHandle = 'mcp___bweCunehzWnFt6ZAhWZ2DBiXNGCFabYg8-2NQ3vj5w';
    const withHandle: ToolSelectionScope = {
      ...scope,
      scoping: {
        admitted: [{ candidateId: opaqueHandle, reasons: ['relevance_match'] }, ...(scope.scoping?.admitted ?? [])],
        fallbackFull: false,
      },
    };
    const projection = projectToolSelectionCandidate({
      scope: withHandle,
      candidateId: builtinCandidateId('alix_file_read'),
    });
    expect(projection.scoping?.admitted).toEqual([
      builtinCandidateId('alix_file_read'),
      builtinCandidateId('alix_shell_run'),
    ]);

    // The load-bearing consequence: the payload clears the remote gate.
    expect(() =>
      sealForRemote(
        `experiment:${TOOL_SELECTION_EXPERIMENT}`,
        TOOL_SELECTION_PROJECTOR_VERSION,
        projection,
      ),
    ).not.toThrow();
    // The gate itself is real: a payload that did carry the handle is refused.
    expect(() =>
      sealForRemote(`experiment:${TOOL_SELECTION_EXPERIMENT}`, TOOL_SELECTION_PROJECTOR_VERSION, {
        ...projection,
        scoping: { fallbackFull: false, admitted: [opaqueHandle] },
      }),
    ).toThrow(/contains secret material/);
  });

  it('fails closed when an offered id is still a raw handle', () => {
    const unfrozen: ToolSelectionScope = {
      ...scope,
      candidates: scope.candidates.filter(candidate => candidate.domain !== 'mcp'),
      offered: [
        ...scope.offered.filter(candidateId => candidateId !== mcpCandidate.candidateId),
        'mcp___bweCunehzWnFt6ZAhWZ2DBiXNGCFabYg8-2NQ3vj5w',
      ],
    };
    expect(() =>
      projectToolSelectionCandidate({ scope: unfrozen, candidateId: builtinCandidateId('alix_file_read') }),
    ).toThrow(/unresolved MCP handle/);
  });
});

describe('createJevExperimentScorer', () => {
  it('is sealed under the experiment subject and pins the projector version', async () => {
    const seen: Array<{ decision?: string; projectorVersion?: string }> = [];
    const executor = {
      engineId: 'jev',
      async execute(input: { sealed: { decision?: string; projectorVersion?: string } }) {
        seen.push({ decision: input.sealed.decision, projectorVersion: input.sealed.projectorVersion });
        return { kind: 'noul' as const, probability: 0.4, provenance: { engineId: 'jev' } };
      },
    };
    const selector = createJevExperimentScorer({ executor: executor as never, scope });

    const result = await selector.rank({
      scopeId: 'scope_7',
      iteration: 7,
      candidateId: builtinCandidateId('alix_grep_search'),
      domain: 'builtin',
      requirementCandidates: [],
    });

    expect(result).toEqual({ rankValue: 0.4 });
    expect(seen[0]).toEqual({
      decision: `experiment:${TOOL_SELECTION_EXPERIMENT}`,
      projectorVersion: TOOL_SELECTION_PROJECTOR_VERSION,
    });
    expect(selector.id).toBe(`jev:${TOOL_SELECTION_EXPERIMENT}`);
  });

  it('refuses an unpinned projector version instead of comparing across versions', () => {
    expect(() => createJevExperimentScorer({
      executor: noulExecutor({}) as never,
      scope,
      projectorVersion: 'tool-selection/v2',
    })).toThrow(/unsupported tool-selection projector version/);
  });

  it('records the native outcome kind, its probability and the ranking value', async () => {
    const records: ExperimentRankingRecord[] = [];
    const selector = createJevExperimentScorer({
      executor: noulExecutor({ [builtinCandidateId('alix_grep_search')]: 0.75 }) as never,
      scope,
      model: 'jev-test-model',
      onRanking: (record) => records.push(record),
    });

    await selector.rank({
      scopeId: 'scope_7',
      iteration: 7,
      candidateId: builtinCandidateId('alix_grep_search'),
      domain: 'builtin',
      requirementCandidates: [],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      experimentId: TOOL_SELECTION_EXPERIMENT,
      projectorVersion: TOOL_SELECTION_PROJECTOR_VERSION,
      scopeId: 'scope_7',
      candidateId: builtinCandidateId('alix_grep_search'),
      label: 'alix_grep_search',
      engineId: 'jev',
      model: 'jev-test-model',
      // Not a Jev Score: a Noul probability used as a ranking value.
      outcomeKind: 'noul',
      probability: 0.75,
      rankValue: 0.75,
    });
    expect(records[0].projectionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(records[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('changes the projection identity when the projector version changes', () => {
    const v1 = projectToolSelectionCandidate({ scope, candidateId: builtinCandidateId('alix_file_read') });
    const other = projectToolSelectionCandidate({
      scope,
      candidateId: builtinCandidateId('alix_file_read'),
      projectorVersion: 'tool-selection/v0-experiment',
    });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(v1));
    expect(other.projectorVersion).toBe('tool-selection/v0-experiment');
    // The version is inside the sealed payload, so the hash moves with it.
    const sealedV1 = sealForRemote(
      `experiment:${TOOL_SELECTION_EXPERIMENT}`,
      TOOL_SELECTION_PROJECTOR_VERSION,
      v1,
    );
    const sealedOther = sealForRemote(
      `experiment:${TOOL_SELECTION_EXPERIMENT}`,
      'tool-selection/v0-experiment',
      other,
    );
    expect(sealedOther.hash).not.toBe(sealedV1.hash);
  });

  it('refuses choice, score, failure, missing and out-of-range answers', async () => {
    const cases: Array<[string, string]> = [
      ['choice', 'selector returned choice, expected a bounded Noul probability'],
      ['score', 'selector returned score, expected a bounded Noul probability'],
      ['failure', 'engine down'],
      ['over', `engine returned an out-of-range probability for ${builtinCandidateId('alix_file_read')}: 1.5`],
      ['nan', `engine returned an out-of-range probability for ${builtinCandidateId('alix_file_read')}: NaN`],
    ];
    for (const [mode, expected] of cases) {
      const value =
        mode === 'over' ? 1.5 : mode === 'nan' ? Number.NaN : mode;
      const selector = createJevExperimentScorer({
        executor: noulExecutor({ [builtinCandidateId('alix_file_read')]: value }) as never,
        scope,
      });
      const result = await selector.rank({
        scopeId: 'scope_7',
        iteration: 7,
        candidateId: builtinCandidateId('alix_file_read'),
        domain: 'builtin',
        requirementCandidates: [],
      });
      expect(result).toEqual({ error: expected });
    }
  });

  it('feeds replayToolSelection without taking over sorting or set preservation', async () => {
    const onRanking = vi.fn();
    const selector = createJevExperimentScorer({
      executor: noulExecutor({
        [builtinCandidateId('alix_file_read')]: 0.1,
        [builtinCandidateId('alix_grep_search')]: 0.9,
        [builtinCandidateId('alix_shell_run')]: 0.4,
        [mcpCandidate.candidateId]: 0.9,
      }) as never,
      scope,
      onRanking,
    });

    const replay = await replayToolSelection(scope, selector);

    expect(replay.candidateSetPreserved).toBe(true);
    expect(replay.selectorId).toBe(`jev:${TOOL_SELECTION_EXPERIMENT}`);
    // Domains stay separate: the builtin ordering never mixes MCP values.
    expect(replay.domains.find(entry => entry.domain === 'builtin')?.ranking).toEqual([
      builtinCandidateId('alix_grep_search'),
      builtinCandidateId('alix_shell_run'),
      builtinCandidateId('alix_file_read'),
    ]);
    expect(replay.domains.find(entry => entry.domain === 'mcp')?.ranking).toEqual([mcpCandidate.candidateId]);
    // ALiX scores every offered candidate; the selector never sees the set.
    expect(onRanking).toHaveBeenCalledTimes(scope.offered.length);
  });
});

describe('TOOL_SELECTION_JEV_MAPPING', () => {
  it('asks one Noul question about this candidate alone', () => {
    const request = TOOL_SELECTION_JEV_MAPPING.toRequest(
      sealCandidate(builtinCandidateId('alix_grep_search')) as never,
    );
    const question = request.questions[TOOL_SELECTION_JEV_QUESTION_ID];
    const state = String(request.state ?? '');
    expect(question?.type).toBe('noul');
    expect(question?.instructions).toBe(
      'Would executing this tool now be an appropriate next step for the objective?',
    );
    // A candidate that cannot see the others cannot be asked which is "best".
    expect(question?.instructions ?? '').not.toMatch(/best/i);
    expect(question?.criteria).toEqual({
      true: 'Executing this tool now would be an appropriate next step for the objective',
      false: 'Executing this tool now would not be an appropriate next step for the objective',
    });
    expect(state).toContain('alix_grep_search');
    expect(state).toContain('Verify the three files exist');
    // Selection-time state only: no outcome or ranking reaches the wire.
    for (const leaked of ['actualChoice', 'deterministicRanking', 'success', 'mcp__']) {
      expect(state.includes(leaked), `state leaked ${leaked}`).toBe(false);
    }
  });

  it('maps a Noul answer to a Noul result and refuses malformed answers', () => {
    const ctx = { projectionHash: 'sha256:test', latencyMs: 3 };
    const scored = TOOL_SELECTION_JEV_MAPPING.fromResponse(
      { model: 'jev-test', answers: { [TOOL_SELECTION_JEV_QUESTION_ID]: { type: 'noul', noul: 0.8 } } },
      ctx,
    ) as { kind: string; probability: number; provenance: { engineId: string; projectionHash: string } };
    expect(scored.kind).toBe('noul');
    expect(scored.probability).toBe(0.8);
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
    const projection: ToolSelectionProjection = projectToolSelectionCandidate({
      scope,
      candidateId: builtinCandidateId('alix_file_read'),
    });
    expect(() => readToolSelectionProjection({ ...projection, experiment: 'other-experiment' } as never))
      .toThrow(/not tool-selection-replay/);
    expect(() => readToolSelectionProjection({ ...projection, projectorVersion: 'tool-selection/v2' } as never))
      .toThrow(/not tool-selection\/v1/);
    expect(() => readToolSelectionProjection({ ...projection, candidate: {} } as never))
      .toThrow(/missing a candidate id/);
  });

  it('renders every offered candidate as context, by identity and label', () => {
    const rendered = renderToolSelectionState(
      projectToolSelectionCandidate({ scope, candidateId: builtinCandidateId('alix_shell_run') }),
    );
    for (const candidate of scope.candidates) {
      expect(rendered).toContain(candidate.candidateId);
      expect(rendered).toContain(candidate.label);
    }
    expect(rendered).toContain('requirement:verification');
    expect(rendered).not.toContain('mcp__');
  });
});

describe('createJevToolSelectionScorer', () => {
  const noulTransport = (noul: number) => async () => ({
    model: 'jev-test',
    answers: { [TOOL_SELECTION_JEV_QUESTION_ID]: { type: 'noul' as const, noul } },
  });

  it('ranks through the real adapter with the experiment mapping registered', async () => {
    const selector = createJevToolSelectionScorer({
      apiKey: 'test-key',
      scope,
      transport: noulTransport(0.75),
    });
    const result = await selector.rank({
      scopeId: 'scope_7',
      iteration: 7,
      candidateId: builtinCandidateId('alix_grep_search'),
      domain: 'builtin',
      requirementCandidates: [],
    });
    expect(result).toEqual({ rankValue: 0.75 });
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
        sealed: sealCandidate(builtinCandidateId('alix_file_read')) as never,
        candidates: [builtinCandidateId('alix_file_read')],
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
