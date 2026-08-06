/**
 * #407 — Governed route execution.
 *
 * The governed lifecycle wrapper at the executeRoute seam (spec #404):
 *
 *   TaskRoute → ExecutionIntent (X1) → governor validate/authorize →
 *   state machine (CREATED→…→SUCCEEDED/FAILED) → executeRoute →
 *   evidence per transition → (optional) persistence emitter.
 *
 * Invariants enforced:
 *   - Execution cannot begin before APPROVED (denial never reaches executor).
 *   - The executor never writes evidence — every transition emits it.
 *   - Terminal states are immutable (inherited from the state machine).
 *   - Every evidence record references exactly one intentId.
 *
 * `executeRoute` itself is untouched — this module composes the pure
 * dispatcher, so the blast radius of adding governance is additive only.
 *
 * @module governed-route-executor
 */

import { ExecutionGovernorImpl, type ExecutionGovernor } from "./execution-governor.js";
import { ExecutionStateMachine } from "./execution-state-machine.js";
import {
  ExecutionState,
  type ExecutionEvidenceEmitter,
  type ExecutionEventType,
} from "./contracts/execution-runtime-contract.js";
import type {
  ExecutionEvidence,
  ExecutionIntent,
  ExecutionIntentEvent,
} from "./contracts/execution-intent-contract.js";
import { createExecutionIntent } from "./execution-intent-factory.js";
import { executeRoute, type RuntimeContext, type RuntimeExecutor } from "./route-executor.js";
import type { TaskRoute } from "./task-router.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when an intent does not pass the governor's approval gate. The
 * executor is never reached — invariant 2 (no execution before APPROVED).
 */
export class ExecutionNotApprovedError extends Error {
  readonly kind = "ExecutionNotApprovedError";
  readonly intentId: string;

  constructor(intentId: string, reason: string) {
    super(`Execution denied for intent ${intentId}: ${reason}`);
    this.name = "ExecutionNotApprovedError";
    this.intentId = intentId;
  }
}

// ---------------------------------------------------------------------------
// Evidence emitter
// ---------------------------------------------------------------------------

/**
 * Collects every emitted evidence record and forwards to an optional
 * downstream emitter (e.g. X3b persistence). The collector lets the
 * wrapper report the full evidence trail; the forward target makes the
 * same trail durable.
 */
export class CollectingEvidenceEmitter implements ExecutionEvidenceEmitter {
  readonly emitted: ExecutionEvidence[] = [];

  constructor(private readonly next?: ExecutionEvidenceEmitter) {}

  emit(eventType: ExecutionEventType, evidence: ExecutionEvidence): void {
    this.emitted.push(evidence);
    this.next?.emit(eventType, evidence);
  }
}

// ---------------------------------------------------------------------------
// Result / deps
// ---------------------------------------------------------------------------

export interface GovernedExecutionDeps {
  /** Downstream evidence emitter (e.g. PersistenceEvidenceEmitter). */
  emitter?: ExecutionEvidenceEmitter;
  /**
   * Governor factory. Receives the seeded CREATED + APPROVED event stream
   * for the intent. Defaults to a fresh ExecutionGovernorImpl.
   */
  governorFactory?: (events: Map<string, ExecutionIntentEvent[]>) => ExecutionGovernor;
  /** Actor authoring the intent. Defaults to "system". */
  actor?: string;
  /** ISO timestamp; injectable for deterministic tests. */
  now?: string;
}

export interface GovernedRouteResult {
  /** The executor's output string. */
  result: string;
  /** Canonical execution identity (X1 intentId). */
  intentId: string;
  /** The state machine's execution attempt id. */
  executionId: string;
  /** The immutable intent document. */
  intent: ExecutionIntent;
  /** Every evidence record emitted by the machine for this execution. */
  evidence: ExecutionEvidence[];
  /** Terminal state on success (SUCCEEDED). */
  finalState: ExecutionState;
}

// ---------------------------------------------------------------------------
// Governed dispatch
// ---------------------------------------------------------------------------

/**
 * Execute a routed task under the governed lifecycle.
 *
 * Builds the canonical ExecutionIntent, seeds CREATED + APPROVED events,
 * validates + authorizes through the governor, drives the state machine to
 * RUNNING, dispatches the original route through the (unchanged) executor,
 * then transitions to SUCCEEDED (or FAILED + rethrow on executor failure).
 *
 * @param route - The routed task.
 * @param ctx - Runtime context (config, session, cwd).
 * @param executor - The underlying route executor (its behavior is preserved).
 * @param deps - Optional emitter / governor factory / identity overrides.
 * @throws {ExecutionNotApprovedError} if the intent is not APPROVED.
 */
export async function executeRouteGoverned(
  route: TaskRoute,
  ctx: RuntimeContext,
  executor: RuntimeExecutor,
  deps: GovernedExecutionDeps = {},
): Promise<GovernedRouteResult> {
  const now = deps.now ?? new Date().toISOString();
  const intent = createExecutionIntent(route, { actor: deps.actor, now });

  // Seed the X1 lifecycle: CREATED (intent creator) + APPROVED (governor,
  // synthetic auto-approval for non-proposal routes).
  const events: ExecutionIntentEvent[] = [
    { intentId: intent.intentId, type: "CREATED", timestamp: now, actor: intent.actor },
    {
      intentId: intent.intentId,
      type: "APPROVED",
      timestamp: now,
      actor: "governor",
      reason: intent.approvalReference,
    },
  ];
  const governor = deps.governorFactory
    ? deps.governorFactory(new Map([[intent.intentId, events]]))
    : new ExecutionGovernorImpl(new Map([[intent.intentId, events]]));

  // Invariant 2: no execution before APPROVED.
  const validation = await governor.validate(intent);
  if (!validation.valid) {
    throw new ExecutionNotApprovedError(
      intent.intentId,
      validation.reason ?? "validation failed",
    );
  }
  await governor.authorize(intent.intentId);

  const collector = new CollectingEvidenceEmitter(deps.emitter);
  const machine = new ExecutionStateMachine(collector);

  // Drive the machine: CREATED → VALIDATING → READY → RUNNING.
  const executionId = machine.createExecution(intent);
  machine.transitionTo(executionId, ExecutionState.VALIDATING);
  machine.transitionTo(executionId, ExecutionState.READY);
  machine.transitionTo(executionId, ExecutionState.RUNNING);

  // X1 event stream: RUNNING (owner = executor via the governed wrapper).
  await governor.start(intent.intentId);

  try {
    const result = await executeRoute(route, ctx, executor);
    machine.transitionTo(executionId, ExecutionState.SUCCEEDED);
    await governor.complete(intent.intentId, "SUCCESS", result.slice(0, 200));
    return {
      result,
      intentId: intent.intentId,
      executionId,
      intent,
      evidence: collector.emitted,
      finalState: ExecutionState.SUCCEEDED,
    };
  } catch (err) {
    machine.transitionTo(executionId, ExecutionState.FAILED);
    const reason = err instanceof Error ? err.message : String(err);
    await governor.fail(intent.intentId, reason);
    throw err;
  }
}
