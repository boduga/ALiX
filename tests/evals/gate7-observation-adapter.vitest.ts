import { describe, expect, it } from 'vitest';
import { observationFromGate7, type Gate7Summary } from '../../src/operations/evals/gate7-observation-adapter.js';
import { verifyObservation } from '../../src/operations/evals/eval-observation.js';

/** A Gate 7 coordination success, mirroring the real run-fanout summary shape. */
const FANOUT: Gate7Summary = {
  provider: 'intern',
  model: 'deepseek-v4-flash-0731',
  run: {
    id: 'coord_abc',
    status: 'completed',
    workers: [
      { status: 'completed', scopes: ['docs/a.md'] },
      { status: 'completed', scopes: ['docs/b.md'] },
      { status: 'completed', scopes: ['docs/c.md'] },
    ],
  },
  aggregate: { status: 'completed', outcome: 'success', complete: true },
  artifacts: { 'docs/a.md': 'A_OK\n', 'docs/b.md': 'B_OK\n', 'docs/c.md': 'C_OK\n' },
  approvals: [{ id: 'ap1', status: 'consumed', capabilities: ['coordination.run'] }],
  operator_decisions: [{ decision: 'approved' }],
  pending_left: [],
};

const EXPECTED = { 'docs/a.md': 'A_OK', 'docs/b.md': 'B_OK', 'docs/c.md': 'C_OK' };

describe('Gate 7 → canonical observation adapter (P0-D)', () => {
  it('maps a successful coordination run to a passing row', () => {
    const row = observationFromGate7({
      scenarioId: 'coordination.fanout',
      stratum: 'coordination-ownership',
      driverVerdict: 'pass',
      summary: FANOUT,
      wallClockMs: 12_000,
      expectedArtifacts: EXPECTED,
    });

    expect(row.verdict).toBe('pass');
    expect(row.failureClass).toBeNull();
    expect(row.terminalStatus).toBe('completed');
    expect(row.stratum).toBe('coordination-ownership');
    expect(row.provider).toBe('intern');
    expect(row.model).toBe('deepseek-v4-flash-0731');
    expect(verifyObservation(row).ok).toBe(true);
  });

  it('REFUSES to pass when the driver says pass but artifacts do not match', () => {
    // The Gate 7 lesson: an artifact existing is not a pass.
    const bad: Gate7Summary = {
      ...FANOUT,
      artifacts: { 'docs/a.md': 'WRONG', 'docs/b.md': 'B_OK\n', 'docs/c.md': 'C_OK\n' },
    };
    const row = observationFromGate7({
      scenarioId: 'coordination.fanout',
      stratum: 'coordination-ownership',
      driverVerdict: 'pass',
      summary: bad,
      wallClockMs: 1000,
      expectedArtifacts: EXPECTED,
    });

    expect(row.verdict).toBe('fail');
    expect(row.verification).toContain('content mismatch');
    expect(row.failureClass).not.toBeNull();
  });

  it('refuses to pass when an expected artifact is missing', () => {
    const row = observationFromGate7({
      scenarioId: 'coordination.fanout',
      stratum: 'coordination-ownership',
      driverVerdict: 'pass',
      summary: { ...FANOUT, artifacts: { 'docs/a.md': 'A_OK' } },
      wallClockMs: 1000,
      expectedArtifacts: EXPECTED,
    });
    expect(row.verdict).toBe('fail');
    expect(row.verification).toContain('missing');
  });

  it('tolerates a trailing newline without hiding a real mismatch', () => {
    const ok = observationFromGate7({
      scenarioId: 's', stratum: 'single-file-edit', driverVerdict: 'pass',
      summary: { ...FANOUT, artifacts: { 'docs/a.md': 'A_OK\n' } },
      wallClockMs: 10, expectedArtifacts: { 'docs/a.md': 'A_OK' },
    });
    expect(ok.verdict).toBe('pass');
  });

  it('classifies an operator-denied run as policy-denial, not task failure', () => {
    const denied: Gate7Summary = {
      provider: 'intern', model: 'm',
      run: {
        id: 'coord_deny', status: 'failed',
        workers: [
          { status: 'failed', failureKind: 'approval_denied', scopes: ['docs/a.md'] },
          { status: 'blocked', failureKind: null, scopes: ['docs/b.md'] },
        ],
      },
      aggregate: { status: 'completed', outcome: 'incomplete', complete: false },
      artifacts: { 'docs/a.md': 'A_OK' },
      approvals: [
        { id: 'a1', status: 'denied', capabilities: ['filesystem.write'] },
        { id: 'a2', status: 'consumed', capabilities: ['coordination.run'] },
      ],
      operator_decisions: [{ decision: 'approved' }, { decision: 'denied' }],
      pending_left: [],
    };

    const row = observationFromGate7({
      scenarioId: 'coordination.denial',
      stratum: 'capability-mix',
      driverVerdict: 'pass', // the denial scenario PASSES when the denial contract holds
      summary: denied,
      wallClockMs: 5000,
      // The denial scenario's artifact contract is only the producer's file.
      expectedArtifacts: { 'docs/a.md': 'A_OK' },
    });

    // Driver verdict + artifacts agree, so the row passes — but the run itself
    // is failed/incomplete, and that must remain visible in terminalStatus.
    expect(row.terminalStatus).toBe('failed');
    expect(row.verdict).toBe('pass');
    expect(row.failureClass).toBeNull();
  });

  it('surfaces an unresolved approval as approval-timeout when the row fails', () => {
    const stuck: Gate7Summary = {
      ...FANOUT,
      run: { id: 'coord_stuck', status: 'blocked', workers: [{ status: 'blocked' }] },
      artifacts: {},
      pending_left: ['ap9'],
    };
    const row = observationFromGate7({
      scenarioId: 'coordination.stuck',
      stratum: 'capability-mix',
      driverVerdict: 'fail',
      summary: stuck,
      wallClockMs: 9000,
      expectedArtifacts: EXPECTED,
    });
    expect(row.verdict).toBe('fail');
    expect(row.failureClass).toBe('approval-timeout');
  });

  it('keeps unmeasured dimensions null rather than zero', () => {
    const row = observationFromGate7({
      scenarioId: 'x', stratum: 'crash-outcome-unknown', driverVerdict: 'pass',
      summary: FANOUT, wallClockMs: 1000, expectedArtifacts: EXPECTED,
    });
    // Gate 7 summaries do not carry these; a zero would fabricate a measurement.
    expect(row.cost.promptTokens).toBeNull();
    expect(row.cost.observedCostUsd).toBeNull();
    expect(row.cost.approvalWaitMs).toBeNull();
    expect(row.retries).toBeNull();
  });

  it('counts only real operator decisions as interventions', () => {
    const row = observationFromGate7({
      scenarioId: 'x', stratum: 'capability-mix', driverVerdict: 'pass',
      summary: {
        ...FANOUT,
        operator_decisions: [
          { decision: 'approved' },
          { decision: 'approved' },
          { decision: 'denied', post_run: true },
        ],
      },
      wallClockMs: 1000, expectedArtifacts: EXPECTED,
    });
    // The post-run decision is harness bookkeeping, not an intervention.
    expect(row.interventions).toBe(2);
  });

  it('produces rows the schema accepts for every terminal status', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'blocked', 'timeout']) {
      const row = observationFromGate7({
        scenarioId: `s-${status}`, stratum: 'coordination-ownership',
        driverVerdict: status === 'completed' ? 'pass' : 'fail',
        summary: { ...FANOUT, run: { ...FANOUT.run!, status } },
        wallClockMs: 100,
        expectedArtifacts: EXPECTED,
      });
      expect(verifyObservation(row).ok, `status=${status}: ${verifyObservation(row).problems}`).toBe(true);
    }
  });
});
