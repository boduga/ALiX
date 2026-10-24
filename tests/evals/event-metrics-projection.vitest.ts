import { describe, expect, it } from 'vitest';
import {
  approvalConsumptionDelayMs,
  approvalWaitMs,
  checkEventIntegrity,
  coordinationOverheadMs,
  costAccountingFromEvents,
  observationFromEvents,
  tokenUsage,
  workerDispatchLatencyMs,
  workerExecutionMs,
  type ProjectableEvent,
} from '../../src/operations/evals/event-metrics-projection.js';

let seq = 0;
function ev(type: string, payload: Record<string, unknown>, at: string): ProjectableEvent {
  seq += 1;
  return { id: `e${seq}`, seq, timestamp: at, type, sessionId: 's1', payload };
}

const T0 = '2026-10-20T10:00:00.000Z';
const t = (offsetMs: number) => new Date(Date.parse(T0) + offsetMs).toISOString();

function approvalChain(opts: { decision?: 'approved' | 'denied'; consumed?: boolean } = {}) {
  const events: ProjectableEvent[] = [
    ev('approval.created', { approvalId: 'ap1', capabilities: ['filesystem.write'] }, t(0)),
  ];
  if (opts.decision) {
    events.push(ev('approval.resolved', { approvalId: 'ap1', status: opts.decision }, t(5000)));
  }
  if (opts.consumed) {
    events.push(ev('approval.consumed', { approvalId: 'ap1' }, t(5300)));
  }
  return events;
}

describe('event integrity (P0-D2)', () => {
  it('reports clean when events are ordered and unique', () => {
    const events = approvalChain({ decision: 'approved', consumed: true });
    expect(checkEventIntegrity(events).ok).toBe(true);
  });

  it('flags duplicate event ids rather than deduping silently', () => {
    const events = approvalChain({ decision: 'approved' });
    const dupe = { ...events[0]! };
    const integrity = checkEventIntegrity([...events, dupe]);
    expect(integrity.ok).toBe(false);
    expect(integrity.duplicates).toEqual([dupe.id]);
  });

  it('counts out-of-order sequence numbers', () => {
    const a = ev('x', {}, t(0));
    const b = { ...ev('y', {}, t(1)), seq: a.seq - 1 };
    const integrity = checkEventIntegrity([a, b]);
    expect(integrity.ok).toBe(false);
    expect(integrity.outOfOrder).toBe(1);
  });

  it('flags unparseable timestamps', () => {
    const bad = ev('x', {}, 'not-a-date');
    const integrity = checkEventIntegrity([bad]);
    expect(integrity.ok).toBe(false);
    expect(integrity.unparseableTimestamps).toEqual([bad.id]);
  });
});

describe('approval wait (P0-D2)', () => {
  it('measures request → decision with both event ids as evidence', () => {
    const events = approvalChain({ decision: 'approved' });
    const m = approvalWaitMs(events, 'ap1');
    expect(m.value).toBe(5000);
    expect(m.evidence).toHaveLength(2);
  });

  it('returns null with a reason when the approval is still pending', () => {
    const m = approvalWaitMs(approvalChain(), 'ap1');
    expect(m.value).toBeNull();
    expect(m.reason).toContain('still pending');
    // A pending wait must never be reported as an elapsed duration.
    expect(m.value).not.toBe(0);
  });

  it('returns null when no request exists for the id', () => {
    const m = approvalWaitMs(approvalChain({ decision: 'approved' }), 'missing');
    expect(m.value).toBeNull();
    expect(m.reason).toContain('no approval.created');
  });

  it('rejects a contradictory history where resolution precedes creation', () => {
    const events = [
      ev('approval.created', { approvalId: 'apX' }, t(10000)),
      ev('approval.resolved', { approvalId: 'apX', status: 'approved' }, t(0)),
    ];
    const m = approvalWaitMs(events, 'apX');
    expect(m.value).toBeNull();
    expect(m.reason).toContain('contradictory');
  });
});

describe('approval consumption delay (P0-D2)', () => {
  it('measures decision → consumption', () => {
    const m = approvalConsumptionDelayMs(approvalChain({ decision: 'approved', consumed: true }), 'ap1');
    expect(m.value).toBe(300);
  });

  it('returns absent (not zero) when the approval was denied', () => {
    const m = approvalConsumptionDelayMs(approvalChain({ decision: 'denied' }), 'ap1');
    expect(m.value).toBeNull();
    expect(m.reason).toContain('not consumed');
    expect(m.reason).toContain('denied');
  });
});

describe('worker execution (P0-D2)', () => {
  const workerEvents = (): ProjectableEvent[] => [
    ev('coordination.worker.dispatched', { coordinationRunId: 'r1', workerId: 'w1' }, t(0)),
    ev('coordination.worker.completed', { coordinationRunId: 'r1', workerId: 'w1', outcome: 'success' }, t(4000)),
  ];

  it('measures dispatch → terminal', () => {
    const m = workerExecutionMs(workerEvents(), 'r1', 'w1');
    expect(m.value).toBe(4000);
  });

  it('returns absent for a worker that never dispatched', () => {
    const m = workerExecutionMs(workerEvents(), 'r1', 'w2');
    expect(m.value).toBeNull();
    expect(m.reason).toContain('never dispatched');
  });

  it('returns absent for a worker with no terminal event', () => {
    const events = workerEvents().slice(0, 1);
    const m = workerExecutionMs(events, 'r1', 'w1');
    expect(m.value).toBeNull();
    expect(m.reason).toContain('still running');
  });

  it('does not confuse workers across runs', () => {
    const events = workerEvents();
    const wrongRun = workerExecutionMs(events, 'r2', 'w1');
    expect(wrongRun.value).toBeNull();
  });
});

describe('deliberately non-derivable metrics (P0-D2)', () => {
  it('dispatch latency is absent with an explicit reason, not guessed', () => {
    const m = workerDispatchLatencyMs();
    expect(m.value).toBeNull();
    expect(m.reason).toContain('eligible');
  });

  it('coordination overhead refuses the subtraction shortcut', () => {
    const m = coordinationOverheadMs();
    expect(m.value).toBeNull();
    // The operator constraint is encoded, not just implied.
    expect(m.reason).toContain('subtracting');
  });
});

describe('token usage (P0-D2)', () => {
  it('sums usage events', () => {
    const events = [
      ev('model.usage', { provider: 'p', model: 'm', inputTokens: 100, outputTokens: 20 }, t(0)),
      ev('model.usage', { provider: 'p', model: 'm', inputTokens: 50, outputTokens: 10 }, t(1)),
    ];
    const usage = tokenUsage(events);
    expect(usage.promptTokens).toBe(150);
    expect(usage.completionTokens).toBe(30);
    expect(usage.evidence).toHaveLength(2);
  });

  it('returns null rather than zero when the session has no usage events', () => {
    const usage = tokenUsage([]);
    expect(usage.promptTokens).toBeNull();
    expect(usage.reason).toContain('no model.usage');
  });

  it('refuses to sum a malformed usage event', () => {
    const events = [ev('model.usage', { provider: 'p', model: 'm' }, t(0))];
    const usage = tokenUsage(events);
    expect(usage.promptTokens).toBeNull();
    expect(usage.reason).toContain('lacks numeric');
  });
});

describe('cost accounting coverage (P0-D2)', () => {
  it('reports per-field coverage so absent metrics are explainable', () => {
    const events = approvalChain({ decision: 'approved', consumed: true });
    const { cost, coverage } = costAccountingFromEvents(events, { wallClockMs: 9000, approvalId: 'ap1' });

    expect(cost.approvalWaitMs).toBe(5000);
    expect(cost.orchestrationMs).toBeNull();
    expect(cost.observedCostUsd).toBeNull();
    expect(coverage.approvalWaitMs).toContain('measured');
    expect(coverage.orchestrationMs).toBeTruthy();
    expect(coverage.observedCostUsd).toContain('null');
  });
});

describe('observation from events (P0-D2)', () => {
  it('a passing scenario with incomplete telemetry stays a pass', () => {
    // The design constraint: measurement completeness is NOT execution outcome.
    const events = approvalChain({ decision: 'approved', consumed: true });
    const { observation, coverage } = observationFromEvents({
      scenarioId: 'coordination.fanout',
      stratum: 'coordination-ownership',
      model: 'm',
      provider: 'p',
      runId: 'r1',
      verdict: 'pass',
      verification: 'artifacts verified',
      terminalStatus: 'completed',
      events,
      wallClockMs: 9000,
      approvalId: 'ap1',
    });

    expect(observation.verdict).toBe('pass');
    expect(observation.failureClass).toBeNull();
    // Tokens are unmeasured here, and that must not fail the scenario.
    expect(observation.cost.promptTokens).toBeNull();
    expect(coverage.schemaProblems).toBeUndefined();
  });

  it('counts approval decisions as interventions', () => {
    const events = approvalChain({ decision: 'approved', consumed: true });
    const { observation } = observationFromEvents({
      scenarioId: 's', stratum: 'capability-mix', model: 'm', provider: 'p', runId: 'r1',
      verdict: 'pass', verification: 'ok', terminalStatus: 'completed',
      events, wallClockMs: 100, approvalId: 'ap1',
    });
    expect(observation.interventions).toBe(1);
  });

  it('records integrity failures in coverage rather than hiding them', () => {
    const events = approvalChain({ decision: 'approved' });
    const dupe = { ...events[0]! };
    const { integrity } = observationFromEvents({
      scenarioId: 's', stratum: 'capability-mix', model: 'm', provider: 'p', runId: 'r1',
      verdict: 'pass', verification: 'ok', terminalStatus: 'completed',
      events: [...events, dupe], wallClockMs: 100,
    });
    expect(integrity.ok).toBe(false);
    expect(integrity.duplicates.length).toBe(1);
  });
});
