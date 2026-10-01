/**
 * T3-a..T3-c: the preregistered corpus/eligibility/labelling contract.
 *
 * These tests pin the freeze itself: the closed exclusion vocabulary, the two
 * independent eligibility tracks, the blindness of the labelling card, the
 * deterministic (not operator-chosen) A/B rotation, strict label validation,
 * and a summary that reports facts and prerequisites without ranking selectors.
 */
import { describe, it, expect } from 'vitest';
import {
  APPROPRIATENESS_LABELS,
  CARD_KEYS,
  CARD_SLOT_KEYS,
  GAP_CLOSURE_LABELS,
  SELECTION_EXCLUSION_CODES,
  T3_CHECKPOINT,
  blindOrder,
  buildBlindLabellingCard,
  deriveEvaluationEligibility,
  comparisonStatusOf,
  isSelectionExclusionCode,
  objectiveHash,
  parseLabelRecord,
  resolveDisagreementLabels,
  summarizeCorpus,
  type CorpusRow,
  type DisagreementLabelRecord,
  type ToolSelectionLabelRecord,
} from '../../src/decision/tool-selection-corpus.js';
import {
  builtinCandidateId,
  candidateIdFor,
  freezeToolCandidates,
} from '../../src/decision/tool-selection-candidates.js';
import type { ToolSelectionScope } from '../../src/decision/tool-selection-replay.js';

const frozen = freezeToolCandidates({
  builtin: [
    { name: 'alix_file_read', description: 'Read a specific known file' },
    { name: 'alix_grep_search', description: 'Search files for matching text' },
  ],
  mcp: [{ name: 'mcp__opaque', serverName: 'github', toolName: 'search.code' }],
});

const scope: ToolSelectionScope = {
  scopeId: 'scope_27',
  iteration: 0,
  candidates: frozen.candidates,
  bindings: frozen.bindings,
  offered: frozen.candidates.map(candidate => candidate.candidateId),
  requirementCandidates: [
    { candidateId: builtinCandidateId('alix_grep_search'), reasons: ['requirement:verification'] },
  ],
  scoperRanking: [{ candidateId: builtinCandidateId('alix_grep_search'), score: 3 }],
  actualCandidateIds: [builtinCandidateId('alix_file_read')],
};

function row(overrides: Partial<CorpusRow> = {}): CorpusRow {
  return {
    sessionId: 'session-1',
    scopeId: 'scope_27',
    eligibility: { selection: 'eligible', outcome: 'eligible', diagnostics: [] },
    objective: 'Verify whether provider-selection behaviour is correct.',
    actual: {
      candidateId: builtinCandidateId('alix_file_read'),
      outcome: { execution: 'success', selection: 'novel', evidence: 'contributed' },
    },
    offered: scope.offered,
    requirementCandidates: scope.requirementCandidates,
    domains: { builtin: 2, mcp: 1 },
    scoperRanking: [builtinCandidateId('alix_grep_search')],
    alternative: {
      selectorId: 'jev:tool-selection-replay',
      ranking: [builtinCandidateId('alix_grep_search'), builtinCandidateId('alix_file_read')],
      candidateSetPreserved: true,
    },
    ...overrides,
  };
}

describe('the exclusion vocabulary is closed', () => {
  it('is exactly the preregistered codes — no generic bad-run', () => {
    expect([...SELECTION_EXCLUSION_CODES]).toEqual([
      'execution-context-drift',
      'incomplete-trace',
      'projection-invalid',
      'candidate-set-not-preserved',
      'replay-invalid',
      'fixture-ambiguous',
      'operator-aborted',
    ]);
    expect(isSelectionExclusionCode('bad-run')).toBe(false);
    expect(isSelectionExclusionCode('execution-context-drift')).toBe(true);
  });
});

describe('deriveEvaluationEligibility', () => {
  it('keeps a clean scope eligible on both tracks', () => {
    expect(deriveEvaluationEligibility({ scope })).toEqual({
      selection: 'eligible',
      outcome: 'eligible',
      diagnostics: [],
    });
  });

  it('marks only the outcome ineligible for an analyst-assigned drift', () => {
    // The pilot's 8a0de18b: the selection is factual, the execution is not clean.
    expect(
      deriveEvaluationEligibility({
        scope,
        override: { track: 'outcome', reason: 'execution-context-drift' },
      }),
    ).toEqual({
      selection: 'eligible',
      outcome: 'ineligible',
      diagnostics: [],
      reason: 'execution-context-drift',
    });
  });

  it('keeps the second defect as diagnostic metadata when two codes fire', () => {
    // The pilot's 8a0de18b once the replay is accounted for: the comparison is
    // excluded for the failed candidate set, and the drift that was assigned by
    // hand must not vanish just because it is not the highest-precedence code.
    expect(
      deriveEvaluationEligibility({
        scope,
        replay: { candidateSetPreserved: false, invalidReason: 'selector failed for builtin:x' },
        override: { track: 'outcome', reason: 'execution-context-drift' },
      }),
    ).toEqual({
      selection: 'ineligible',
      outcome: 'ineligible',
      reason: 'candidate-set-not-preserved',
      diagnostics: ['execution-context-drift'],
    });
  });

  it('marks only the selection ineligible when the candidate set was not preserved', () => {
    expect(
      deriveEvaluationEligibility({
        scope,
        replay: { candidateSetPreserved: false, invalidReason: 'selector failed for x' },
      }),
    ).toEqual({
      selection: 'ineligible',
      outcome: 'eligible',
      diagnostics: [],
      reason: 'candidate-set-not-preserved',
    });
  });

  it('separates a preserved-but-invalid replay from a broken set', () => {
    expect(
      deriveEvaluationEligibility({
        scope,
        replay: { candidateSetPreserved: true, invalidReason: 'selector timed out' },
      }).reason,
    ).toBe('replay-invalid');
  });

  it('marks a surface with an unresolved handle as projection-invalid on both tracks', () => {
    const leaky: ToolSelectionScope = {
      ...scope,
      offered: [...scope.offered, 'mcp___opaquehandle'],
    };
    expect(deriveEvaluationEligibility({ scope: leaky })).toEqual({
      selection: 'ineligible',
      outcome: 'ineligible',
      diagnostics: [],
      reason: 'projection-invalid',
    });
  });

  it('treats a scope with no executed choice as an incomplete trace', () => {
    const empty: ToolSelectionScope = { ...scope, actualCandidateIds: [] };
    expect(deriveEvaluationEligibility({ scope: empty })).toEqual({
      selection: 'eligible',
      outcome: 'ineligible',
      diagnostics: [],
      reason: 'incomplete-trace',
    });
  });
});

describe('comparisonStatusOf', () => {
  it('separates the observed choice from comparison eligibility', () => {
    // A failed replay: the model's choice is still a fact, the comparison is not.
    expect(
      comparisonStatusOf(
        row({
          eligibility: {
            selection: 'ineligible',
            outcome: 'ineligible',
            diagnostics: [],
            reason: 'candidate-set-not-preserved',
          },
          alternative: {
            selectorId: 'jev:tool-selection-replay',
            ranking: [],
            candidateSetPreserved: false,
          },
        }),
      ),
    ).toEqual({
      traceComplete: true,
      candidateSetPreserved: false,
      selectionComparisonEligible: false,
      outcomeComparisonEligible: false,
    });
  });

  it('is fully eligible for a preserved replay with an observed choice', () => {
    expect(comparisonStatusOf(row())).toEqual({
      traceComplete: true,
      candidateSetPreserved: true,
      selectionComparisonEligible: true,
      outcomeComparisonEligible: true,
    });
  });
});

describe('blind labelling card', () => {
  const candidates: [string, string] = [
    builtinCandidateId('alix_file_read'),
    builtinCandidateId('alix_grep_search'),
  ];

  it('carries no provenance field — the operator cannot tell which side is which', () => {
    const card = buildBlindLabellingCard({
      scopeKey: 'session-1:scope_27',
      objective: scope.offered.length > 0 ? 'Verify whether provider-selection behaviour is correct.' : '',
      scope,
      candidates,
    });
    expect(Object.keys(card).sort()).toEqual([...CARD_KEYS].sort());
    for (const slot of card.slots) {
      expect(Object.keys(slot).sort().every(key => (CARD_SLOT_KEYS as readonly string[]).includes(key)))
        .toBe(true);
    }
    // No field name may reveal a source: not "actual", not "selector", not "jev".
    const serializedKeys = JSON.stringify(card).toLowerCase();
    for (const forbidden of ['"actual', '"selector', '"jev', '"alternative', '"engine']) {
      expect(serializedKeys.includes(forbidden), `card leaked ${forbidden}`).toBe(false);
    }
  });

  it('rotates A/B deterministically from the scope key, never by operator choice', () => {
    const first = blindOrder('session-1:scope_27', candidates);
    const again = blindOrder('session-1:scope_27', candidates);
    expect(again).toEqual(first);
    // Across many scope keys both orientations occur — the rotation is not fixed.
    const orders = new Set(
      Array.from({ length: 40 }, (_unused, index) => blindOrder(`session-${index}:scope_1`, candidates)[0]),
    );
    expect(orders.size).toBe(2);
  });

  it('shows the frozen descriptor and requirement reasons, not invented context', () => {
    const card = buildBlindLabellingCard({
      scopeKey: 'session-1:scope_27',
      objective: 'Verify whether provider-selection behaviour is correct.',
      scope,
      candidates,
    });
    const grep = card.slots.find(slot => slot.candidateId === builtinCandidateId('alix_grep_search'));
    expect(grep?.label).toBe('alix_grep_search');
    expect(grep?.description).toBe('Search files for matching text');
    expect(grep?.reasons).toEqual(['requirement:verification']);
  });
});

describe('label records', () => {
  it('validates the two label kinds strictly', () => {
    expect([...APPROPRIATENESS_LABELS]).toEqual(['appropriate', 'inappropriate', 'unclear']);
    expect([...GAP_CLOSURE_LABELS]).toEqual(['closed', 'not_closed', 'unknown']);

    const record: ToolSelectionLabelRecord = {
      kind: 'disagreement',
      scopeKey: 'session-1:scope_27',
      objectiveHash: objectiveHash('Verify whether provider-selection behaviour is correct.'),
      order: [builtinCandidateId('alix_file_read'), builtinCandidateId('alix_grep_search')],
      labels: { a: 'appropriate', b: 'unclear' },
      labelledAt: '2026-09-28T00:00:00.000Z',
    };
    expect(parseLabelRecord(record)).toEqual(record);

    expect(() => parseLabelRecord({ ...record, labels: { a: 'good', b: 'unclear' } }))
      .toThrow(/labels\.a must be one of appropriate \| inappropriate \| unclear/);
    expect(() => parseLabelRecord({ kind: 'gap-closure', scopeKey: 's', labelledAt: 'now', detectedRequirements: [], gapClosure: 'maybe' }))
      .toThrow(/gapClosure must be one of closed \| not_closed \| unknown/);
    expect(() => parseLabelRecord({ kind: 'gap-closure', scopeKey: 's', labelledAt: 'now', gapClosure: 'closed' }))
      .toThrow(/detectedRequirements/);
    expect(() => parseLabelRecord({ kind: 'bad-run', scopeKey: 's', labelledAt: 'now' }))
      .toThrow(/unknown label record kind/);
  });

  it('maps slot labels back onto actual/alternative, and ignores a mismatched card', () => {
    const actual = builtinCandidateId('alix_file_read');
    const alternative = builtinCandidateId('alix_grep_search');
    const base: DisagreementLabelRecord = {
      kind: 'disagreement',
      scopeKey: 'session-1:scope_27',
      objectiveHash: objectiveHash('x'),
      order: [actual, alternative],
      labels: { a: 'appropriate', b: 'inappropriate' },
      labelledAt: '2026-09-28T00:00:00.000Z',
    };
    expect(resolveDisagreementLabels(row(), base)).toEqual({
      scopeKey: 'session-1:scope_27',
      actual: 'appropriate',
      alternative: 'inappropriate',
    });
    // Reversed rotation still resolves to the right sides.
    const reversed: DisagreementLabelRecord = {
      ...base,
      order: [alternative, actual],
      labels: { a: 'inappropriate', b: 'appropriate' },
    };
    expect(resolveDisagreementLabels(row(), reversed)?.alternative).toBe('inappropriate');
    // A card for a different pair is ignored rather than guessed.
    const stale: DisagreementLabelRecord = { ...base, order: [actual, candidateIdFor('mcp__opaque')] };
    expect(resolveDisagreementLabels(row(), stale)).toBeUndefined();
  });
});

describe('summarizeCorpus', () => {
  const labels: ToolSelectionLabelRecord[] = [
    {
      kind: 'disagreement',
      scopeKey: 'session-1:scope_27',
      objectiveHash: objectiveHash('x'),
      order: [builtinCandidateId('alix_file_read'), builtinCandidateId('alix_grep_search')],
      labels: { a: 'appropriate', b: 'appropriate' },
      labelledAt: '2026-09-28T00:00:00.000Z',
    },
    {
      kind: 'gap-closure',
      scopeKey: 'session-1:scope_27',
      detectedRequirements: ['requirement:verification'],
      gapClosure: 'closed',
      labelledAt: '2026-09-28T00:00:00.000Z',
    },
  ];

  it('reports agreement, labels, outcome dimensions, latency and prerequisites as facts', () => {
    const summary = summarizeCorpus({
      rows: [
        row({ scoring: { calls: 3, latencyMs: [100, 200, 300], scorerOutcome: 'complete' } }),
        row({
          scopeId: 'scope_28',
          actual: {
            candidateId: builtinCandidateId('alix_grep_search'),
            outcome: { execution: 'success', selection: 'novel', evidence: 'none' },
          },
          alternative: {
            selectorId: 'jev:tool-selection-replay',
            ranking: [builtinCandidateId('alix_grep_search')],
            candidateSetPreserved: true,
          },
          eligibility: {
            selection: 'ineligible',
            outcome: 'eligible',
            diagnostics: [],
            reason: 'candidate-set-not-preserved',
          },
        }),
      ],
      labels,
    });

    expect(summary.scopes).toBe(2);
    expect(summary.eligibility).toEqual({
      selectionEligible: 1,
      outcomeEligible: 2,
      byReason: { 'candidate-set-not-preserved': 1 },
      diagnostics: {},
    });
    // The ineligible scope is excluded from agreement statistics entirely.
    expect(summary.agreement).toEqual({ comparable: 1, agree: 0, disagree: 1, rate: 0 });
    expect(summary.labelledDisagreements).toMatchObject({ labelled: 1, bothAppropriate: 1, unmatched: 0 });
    expect(summary.outcomeDimensions.evidence).toEqual({ contributed: 1, none: 1 });
    expect(summary.gapClosure).toEqual({ closed: 1 });
    expect(summary.scoring).toEqual({
      scopesWithScoring: 1,
      calls: 3,
      totalLatencyMs: 600,
      medianCandidateLatencyMs: 200,
      p95CandidateLatencyMs: 300,
      medianScopeLatencyMs: 600,
      p95ScopeLatencyMs: 600,
      scopesWithScorerFailure: 0,
    });
    expect(summary.requirementContext).toEqual({
      scopesWithRequirementCandidates: 2,
      byRequirementClass: { 'requirement:verification': 2 },
      taskCategory: 'not-recorded',
    });
    expect(summary.prerequisites).toEqual({
      requiredEligibleScopes: T3_CHECKPOINT.eligibleScopes,
      requiredLabelledDisagreements: T3_CHECKPOINT.labelledDisagreements,
      met: false,
      missing: ['eligible scopes 1/30', 'labelled disagreements 1/10'],
    });
  });

  it('never labels a selector as better or worse', () => {
    const summary = summarizeCorpus({ rows: [row()], labels });
    expect(JSON.stringify(summary)).not.toMatch(/better|worse|winner|should use/);
  });

  it('tracks the four statuses and the scorer completion rates as facts', () => {
    const summary = summarizeCorpus({
      rows: [
        row({ scoring: { calls: 3, latencyMs: [100, 200, 300], scorerOutcome: 'complete', attemptedCandidates: 3, failedCandidates: 0 } }),
        row({
          scopeId: 'scope_28',
          scoring: {
            calls: 2,
            latencyMs: [400, 500],
            scorerOutcome: 'failed',
            attemptedCandidates: 3,
            failedCandidates: 1,
          },
          eligibility: {
            selection: 'ineligible',
            outcome: 'ineligible',
            diagnostics: ['execution-context-drift'],
            reason: 'candidate-set-not-preserved',
          },
          alternative: {
            selectorId: 'jev:tool-selection-replay',
            ranking: [],
            candidateSetPreserved: false,
          },
        }),
      ],
      labels: [],
    });

    expect(summary.attemptedScopes).toBe(2);
    expect(summary.status).toEqual({
      traceComplete: 2,
      candidateSetPreserved: 1,
      selectionComparisonEligible: 1,
      outcomeComparisonEligible: 1,
    });
    expect(summary.preservation).toEqual({ attempted: 2, preserved: 1, rate: 0.5 });
    expect(summary.jevCompletion).toEqual({
      attempts: 2,
      fullScopeSuccess: 1,
      fullScopeSuccessRate: 0.5,
      candidateCalls: 6,
      candidateFailures: 1,
      candidateFailureRate: 1 / 6,
    });
    expect(summary.scoring.medianScopeLatencyMs).toBe(600);
    expect(summary.scoring.p95ScopeLatencyMs).toBe(900);
    expect(summary.eligibility.diagnostics).toEqual({ 'execution-context-drift': 1 });
    // One disagreement, and no label for it: it is reported, not dropped.
    expect(summary.agreement).toEqual({ comparable: 1, agree: 0, disagree: 1, rate: 0 });
    expect(summary.labelledDisagreements).toMatchObject({ labelled: 0, unlabelled: 1 });
  });
});
