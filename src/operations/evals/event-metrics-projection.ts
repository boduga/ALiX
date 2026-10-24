/**
 * event-metrics-projection.ts — derive timing metrics from recorded session events.
 *
 * PURE PROJECTION. Reads an `AlixEvent[]` and returns measurements. It does not
 * append, mutate, schedule, approve, or repair anything. The production
 * scheduler and approval machinery are untouched by this module — measurement
 * must never change the thing it measures.
 *
 * WHY NULLS ARE FIRST-CLASS: the event vocabulary does not carry everything a
 * metric needs. Two concrete gaps were verified against the emitters:
 *
 *   1. `coordination.worker.dispatched` payload carries runId, workerId,
 *      agentId, sessionId, taskGraphId — but NOT the worker attempt. An attempt
 *      change therefore cannot be correlated from events alone.
 *   2. There is no "worker became eligible" event. Eligibility is computed
 *      inside `tick()` and never emitted, so dispatch latency has no start
 *      boundary in the record.
 *
 * Rather than infer those, the projection returns `null` with an explicit
 * reason. A guessed timestamp would be indistinguishable from a measured one
 * downstream, which is exactly the failure mode this work exists to prevent.
 *
 * @module
 */

import type {
  CostAccounting,
  ScenarioStratum,
} from "./eval-observation.js";
import { verifyObservation, type EvalObservation } from "./eval-observation.js";

/** Minimal structural event shape; matches `AlixEvent` without importing it. */
export type ProjectableEvent = {
  id: string;
  seq: number;
  timestamp: string;
  type: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

/** A measurement that is either present with evidence, or absent with a reason. */
export type Measurement = {
  value: number | null;
  /** Present only when `value === null`; says exactly why. */
  reason?: string;
  /** Event ids the value was derived from, for independent verification. */
  evidence: string[];
};

const absent = (reason: string, evidence: string[] = []): Measurement => ({ value: null, reason, evidence });
const measured = (value: number, evidence: string[]): Measurement => ({ value, evidence });

function ts(event: ProjectableEvent): number | null {
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Detect duplicate or out-of-order events; never silently repair them. */
export type EventIntegrity = {
  duplicates: string[];
  outOfOrder: number;
  unparseableTimestamps: string[];
  ok: boolean;
};

export function checkEventIntegrity(events: readonly ProjectableEvent[]): EventIntegrity {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unparseableTimestamps: string[] = [];
  let outOfOrder = 0;
  let lastSeq = -Infinity;

  for (const event of events) {
    if (seen.has(event.id)) duplicates.push(event.id);
    else seen.add(event.id);

    if (ts(event) === null) unparseableTimestamps.push(event.id);

    if (event.seq < lastSeq) outOfOrder += 1;
    lastSeq = event.seq;
  }

  return {
    duplicates,
    outOfOrder,
    unparseableTimestamps,
    ok: duplicates.length === 0 && outOfOrder === 0 && unparseableTimestamps.length === 0,
  };
}

/**
 * Approval wait: authoritative request → matching decision, correlated on
 * approvalId.
 *
 * An approval with no matching resolution is NOT reported as a wait: the wait is
 * still in progress, and reporting the elapsed time so far would turn an
 * unfinished wait into a completed measurement.
 */
export function approvalWaitMs(events: readonly ProjectableEvent[], approvalId: string): Measurement {
  const created = events.find(
    e => e.type === "approval.created" && str(e.payload, "approvalId") === approvalId,
  );
  if (!created) return absent(`no approval.created for ${approvalId}`);

  const resolved = events.find(
    e => e.type === "approval.resolved" && str(e.payload, "approvalId") === approvalId,
  );
  if (!resolved) return absent(`approval ${approvalId} has no resolution event (still pending)`, [created.id]);

  const start = ts(created);
  const end = ts(resolved);
  if (start === null || end === null) return absent("unparseable timestamp", [created.id, resolved.id]);
  if (end < start) return absent("resolution precedes creation (contradictory history)", [created.id, resolved.id]);

  return measured(end - start, [created.id, resolved.id]);
}

/**
 * Consumption delay: decision → successful claim, correlated on approvalId.
 *
 * Only a matching `approval.consumed` counts. A denial produces no consumption,
 * so the delay is absent by definition rather than zero.
 */
export function approvalConsumptionDelayMs(
  events: readonly ProjectableEvent[],
  approvalId: string,
): Measurement {
  const resolved = events.find(
    e => e.type === "approval.resolved" && str(e.payload, "approvalId") === approvalId,
  );
  if (!resolved) return absent(`approval ${approvalId} has no resolution event`);

  const consumed = events.find(
    e => e.type === "approval.consumed" && str(e.payload, "approvalId") === approvalId,
  );
  if (!consumed) {
    const status = str(resolved.payload, "status");
    return absent(
      `approval ${approvalId} was not consumed (decision: ${status ?? "unknown"})`,
      [resolved.id],
    );
  }

  const start = ts(resolved);
  const end = ts(consumed);
  if (start === null || end === null) return absent("unparseable timestamp", [resolved.id, consumed.id]);
  if (end < start) return absent("consumption precedes decision (contradictory history)", [resolved.id, consumed.id]);

  return measured(end - start, [resolved.id, consumed.id]);
}

/**
 * Worker execution duration: dispatched → terminal worker event.
 *
 * Correlated on workerId within one run. If the worker is re-dispatched after a
 * retry, the FIRST dispatch and LAST terminal event bracket the whole attempt
 * sequence — which is deliberately labelled "execution span", not "one attempt".
 */
export function workerExecutionMs(
  events: readonly ProjectableEvent[],
  runId: string,
  workerId: string,
): Measurement {
  const dispatched = events.filter(
    e => e.type === "coordination.worker.dispatched"
      && str(e.payload, "coordinationRunId") === runId
      && str(e.payload, "workerId") === workerId,
  );
  if (dispatched.length === 0) return absent(`worker ${workerId} was never dispatched in run ${runId}`);

  const terminal = events.filter(
    e => (e.type === "coordination.worker.completed" || e.type === "coordination.worker.failed")
      && str(e.payload, "coordinationRunId") === runId
      && str(e.payload, "workerId") === workerId,
  );
  if (terminal.length === 0) return absent(`worker ${workerId} has no terminal event (still running)`);

  const first = dispatched[0]!;
  const last = terminal[terminal.length - 1]!;
  const start = ts(first);
  const end = ts(last);
  if (start === null || end === null) return absent("unparseable timestamp", [first.id, last.id]);
  if (end < start) return absent("terminal event precedes dispatch (contradictory history)", [first.id, last.id]);

  return measured(end - start, [first.id, last.id]);
}

/**
 * Worker dispatch latency — NOT DERIVABLE from current events.
 *
 * The scheduler computes eligibility inside `tick()` from `readyWorkers` and
 * never emits an eligibility event, so there is no start boundary in the record.
 * Returns an explicit absence rather than substituting a tick timestamp, which
 * would silently include unrelated reconcile/dispatch work.
 */
export function workerDispatchLatencyMs(): Measurement {
  return absent(
    "no 'worker eligible' event is emitted; eligibility is computed inside tick() and has no start boundary in the record",
  );
}

/**
 * Coordination overhead — NOT DERIVABLE as a subtraction.
 *
 * The operator constraint is explicit: end-to-end duration minus worker
 * execution is misleading under parallelism, approvals and idle periods. Without
 * defined orchestration intervals there is nothing to measure, so this returns
 * absence rather than a fabricated difference.
 */
export function coordinationOverheadMs(): Measurement {
  return absent(
    "no defined orchestration interval is emitted; deriving overhead by subtracting worker time from wall clock would attribute parallel and approval idle time to the scheduler",
  );
}

/** Token usage for one run, summed from `model.usage` events in that session. */
export function tokenUsage(events: readonly ProjectableEvent[]): {
  promptTokens: number | null;
  completionTokens: number | null;
  evidence: string[];
  reason?: string;
} {
  const usage = events.filter(e => e.type === "model.usage");
  if (usage.length === 0) {
    return { promptTokens: null, completionTokens: null, evidence: [], reason: "no model.usage events in this session" };
  }

  let input = 0;
  let output = 0;
  const evidence: string[] = [];
  for (const event of usage) {
    const i = event.payload?.inputTokens;
    const o = event.payload?.outputTokens;
    if (typeof i !== "number" || typeof o !== "number") {
      return {
        promptTokens: null, completionTokens: null, evidence,
        reason: `model.usage event ${event.id} lacks numeric inputTokens/outputTokens`,
      };
    }
    input += i;
    output += o;
    evidence.push(event.id);
  }
  return { promptTokens: input, completionTokens: output, evidence };
}

/** Build a CostAccounting from a session's events, keeping unmeasured values null. */
export function costAccountingFromEvents(
  events: readonly ProjectableEvent[],
  opts: { wallClockMs: number; approvalId?: string },
): { cost: CostAccounting; coverage: Record<string, string> } {
  const usage = tokenUsage(events);
  const wait = opts.approvalId ? approvalWaitMs(events, opts.approvalId) : absent("no approval id supplied");
  const coverage: Record<string, string> = {};

  if (usage.promptTokens === null) coverage.promptTokens = usage.reason ?? "unmeasured";
  else coverage.promptTokens = `measured from ${usage.evidence.length} model.usage event(s)`;

  if (wait.value === null) coverage.approvalWaitMs = wait.reason ?? "unmeasured";
  else coverage.approvalWaitMs = `measured from ${wait.evidence.join(", ")}`;

  coverage.orchestrationMs = coordinationOverheadMs().reason ?? "unmeasured";
  coverage.observedCostUsd = "no rate card correlated to this run; left null rather than estimated";
  coverage.resourceTimeMs = "not captured by the event stream";

  return {
    cost: {
      wallClockMs: opts.wallClockMs,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      observedCostUsd: null,
      estimatedCostUsd: null,
      approvalWaitMs: wait.value,
      orchestrationMs: null,
      resourceTimeMs: null,
    },
    coverage,
  };
}

/**
 * Build a full observation row from events plus an independent verdict.
 *
 * The verdict is supplied by the evaluator, never derived here: measurement
 * completeness is independent of execution outcome, so a passing scenario with
 * partial cost data stays a pass.
 */
export function observationFromEvents(input: {
  scenarioId: string;
  stratum: ScenarioStratum;
  model: string;
  provider: string;
  runId: string;
  verdict: "pass" | "fail";
  verification: string;
  terminalStatus: EvalObservation["terminalStatus"];
  events: readonly ProjectableEvent[];
  wallClockMs: number;
  approvalId?: string;
  failureClass?: EvalObservation["failureClass"];
  environment?: Record<string, string | number | boolean>;
}): { observation: EvalObservation; coverage: Record<string, string>; integrity: EventIntegrity } {
  const integrity = checkEventIntegrity(input.events);
  const { cost, coverage } = costAccountingFromEvents(input.events, {
    wallClockMs: input.wallClockMs,
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
  });

  const observation: EvalObservation = {
    scenarioId: input.scenarioId,
    stratum: input.stratum,
    model: input.model,
    provider: input.provider,
    runId: input.runId,
    verdict: input.verdict,
    verification: input.verification,
    terminalStatus: input.terminalStatus,
    cost,
    retries: null,
    interventions: input.events.filter(e => e.type === "approval.resolved").length,
    failureClass: input.verdict === "pass" ? null : (input.failureClass ?? "unknown"),
    environment: input.environment ?? {},
  };

  const check = verifyObservation(observation);
  if (!check.ok) coverage.schemaProblems = check.problems.join("; ");

  return { observation, coverage, integrity };
}
