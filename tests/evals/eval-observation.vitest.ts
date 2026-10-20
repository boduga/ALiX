import { describe, expect, it } from 'vitest';
import {
  aggregateStratum,
  verifyObservation,
  type EvalObservation,
} from '../../src/operations/evals/eval-observation.js';
import { classifyFailure } from '../../src/operations/evals/eval-failure-classifier.js';

function row(overrides: Partial<EvalObservation> = {}): EvalObservation {
  return {
    scenarioId: 'coordination.four-worker',
    stratum: 'coordination-ownership',
    model: 'mock-1',
    provider: 'mock',
    runId: 'run-1',
    verdict: 'pass',
    verification: 'evaluator observed 4 disjoint artifacts with exact content',
    terminalStatus: 'completed',
    cost: {
      wallClockMs: 1000,
      promptTokens: 100,
      completionTokens: 50,
      observedCostUsd: null,
      estimatedCostUsd: null,
      approvalWaitMs: null,
      orchestrationMs: null,
      resourceTimeMs: null,
    },
    retries: 0,
    interventions: 0,
    failureClass: null,
    environment: { cpuOnly: true },
    ...overrides,
  };
}

describe('eval observation schema (P0-D)', () => {
  it('accepts a consistent successful row', () => {
    expect(verifyObservation(row())).toEqual({ ok: true, problems: [] });
  });

  it('rejects a pass that also carries a failure class', () => {
    const check = verifyObservation(row({ failureClass: 'task' }));
    expect(check.ok).toBe(false);
    expect(check.problems.join()).toContain('failureClass=task');
  });

  it('rejects a fail with no failure class — silence is not evidence', () => {
    const check = verifyObservation(
      row({ verdict: 'fail', terminalStatus: 'failed', failureClass: null }),
    );
    expect(check.ok).toBe(false);
    expect(check.problems.join()).toContain('no failureClass');
  });

  it('rejects an empty verification note', () => {
    const check = verifyObservation(row({ verification: '   ' }));
    expect(check.ok).toBe(false);
    expect(check.problems.join()).toContain('verification note is empty');
  });

  it('rejects a pass for a run that never executed', () => {
    const check = verifyObservation(row({ terminalStatus: 'not-run' }));
    expect(check.ok).toBe(false);
    expect(check.problems.join()).toContain('never executed');
  });

  it('keeps unmeasured cost as null rather than zero', () => {
    const check = verifyObservation(
      row({ cost: { ...row().cost, promptTokens: null, completionTokens: null } }),
    );
    expect(check.ok).toBe(true);
    // Null is the "not measured" sentinel; zero would silently improve averages.
    expect(row().cost.promptTokens).not.toBe(0);
  });

  it('rejects a negative wall clock', () => {
    const check = verifyObservation(row({ cost: { ...row().cost, wallClockMs: -1 } }));
    expect(check.ok).toBe(false);
  });
});

describe('stratum aggregation (P0-D)', () => {
  it('puts failed-run cost in the numerator of cost per verified success', () => {
    const rows = [
      row({ cost: { ...row().cost, observedCostUsd: 1 } }),
      row({ verdict: 'fail', terminalStatus: 'failed', failureClass: 'task',
            cost: { ...row().cost, observedCostUsd: 3 } }),
    ];
    const agg = aggregateStratum(rows);
    expect(agg.tasks).toBe(2);
    expect(agg.verifiedSuccesses).toBe(1);
    // (1 + 3) / 1 success — the failure is charged, not ignored.
    expect(agg.costPerVerifiedSuccessUsd).toBe(4);
  });

  it('reports null cost-per-success when cost was never measured', () => {
    const agg = aggregateStratum([row()]);
    expect(agg.costPerVerifiedSuccessUsd).toBeNull();
  });

  it('reports p50/p95 approval waits only from measured rows', () => {
    const rows = [
      row({ cost: { ...row().cost, approvalWaitMs: 100 } }),
      row({ cost: { ...row().cost, approvalWaitMs: 200 } }),
      row({ cost: { ...row().cost, approvalWaitMs: 900 } }),
      row({ cost: { ...row().cost, approvalWaitMs: null } }),
    ];
    const agg = aggregateStratum(rows);
    expect(agg.p50ApprovalWaitMs).toBe(200);
    expect(agg.p95ApprovalWaitMs).toBe(900);
  });

  it('keeps failure classes separated rather than merging them', () => {
    const rows = [
      row({ verdict: 'fail', terminalStatus: 'cancelled', failureClass: 'planner-contract' }),
      row({ verdict: 'fail', terminalStatus: 'failed', failureClass: 'task' }),
      row({ verdict: 'fail', terminalStatus: 'failed', failureClass: 'task' }),
      row({ verdict: 'fail', terminalStatus: 'failed', failureClass: 'unknown' }),
    ];
    const agg = aggregateStratum(rows);
    expect(agg.failureClasses).toEqual({ 'planner-contract': 1, task: 2, unknown: 1 });
    expect(agg.verifiedSuccesses).toBe(0);
  });
});

describe('failure classification (P0-D)', () => {
  it('returns null for a successful, completed run', () => {
    expect(classifyFailure({ terminalStatus: 'completed', objectiveLanded: true })).toBeNull();
  });

  it('classifies planner scope rejection as planner-contract, NOT task', () => {
    // The Gate 7 shape: a cancelled run whose planner emitted glob-scoped
    // infrastructure workers. Counting this as a task failure would corrupt
    // every cross-model comparison.
    const cls = classifyFailure({
      terminalStatus: 'cancelled',
      objectiveLanded: false,
      reportedReason: 'Coordination plan failed: Cannot verify explicit worker count',
    });
    expect(cls).toBe('planner-contract');
  });

  it('classifies glob-scope planner variance by marker', () => {
    // Real planner text from coordination-planner.ts:345 — the shape Gate 7
    // produced when a plan declared an extra glob-scoped infra writer.
    const cls = classifyFailure({
      terminalStatus: 'cancelled',
      objectiveLanded: false,
      errorText: 'Cannot verify explicit worker count: node n3 is an extra writer with no declared owned path',
    });
    expect(cls).toBe('planner-contract');
  });

  it('classifies a policy denial as policy-denial, not failure', () => {
    const cls = classifyFailure({
      terminalStatus: 'blocked',
      objectiveLanded: false,
      deniedByPolicy: true,
    });
    expect(cls).toBe('policy-denial');
  });

  it('classifies infrastructure faults before anything else', () => {
    const cls = classifyFailure({
      terminalStatus: 'failed',
      objectiveLanded: false,
      errorText: 'fetch failed: ECONNREFUSED 127.0.0.1:8080',
    });
    expect(cls).toBe('infrastructure');
  });

  it('classifies an unresolved approval as approval-timeout', () => {
    const cls = classifyFailure({
      terminalStatus: 'timeout',
      objectiveLanded: false,
      approvalUnresolved: true,
    });
    expect(cls).toBe('approval-timeout');
  });

  it('classifies objective-review rejection as verification', () => {
    const cls = classifyFailure({
      terminalStatus: 'failed',
      objectiveLanded: false,
      verificationRejected: true,
    });
    expect(cls).toBe('verification');
  });

  it('classifies a genuine unmet objective as task', () => {
    const cls = classifyFailure({ terminalStatus: 'failed', objectiveLanded: false });
    expect(cls).toBe('task');
  });

  it('leaves an unexplained cancellation as unknown rather than guessing task', () => {
    const cls = classifyFailure({ terminalStatus: 'cancelled', objectiveLanded: false });
    expect(cls).toBe('unknown');
  });
});
