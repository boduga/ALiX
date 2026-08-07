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
import {
  executeRoute,
  LocalRuntimeExecutor,
  type RuntimeContext,
  type RuntimeExecutor,
} from "./route-executor.js";
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
 *
 * A downstream emitter failure is swallowed: evidence persistence must
 * never stall the execution path (spec #404, ticket #409).
 */
export class CollectingEvidenceEmitter implements ExecutionEvidenceEmitter {
  readonly emitted: ExecutionEvidence[] = [];

  constructor(private readonly next?: ExecutionEvidenceEmitter) {}

  emit(eventType: ExecutionEventType, evidence: ExecutionEvidence): void {
    this.emitted.push(evidence);
    if (this.next) {
      try {
        this.next.emit(eventType, evidence);
      } catch {
        // Persistence must never stall the execution path.
      }
    }
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
  /**
   * Intent lifetime from creation, in ms. Defaults to 24h. Callers that
   * inject a historical `now` should set this far enough out that the
   * governor's real-clock expiration check cannot expire the intent.
   */
  expirationMs?: number;
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
  const intent = createExecutionIntent(route, {
    actor: deps.actor,
    now,
    expirationMs: deps.expirationMs,
  });

  // Seed the X1 lifecycle with ONLY the CREATED event (intent creator).
  // APPROVED is authored by the governor below (D3 ownership).
  const events: ExecutionIntentEvent[] = [
    { intentId: intent.intentId, type: "CREATED", timestamp: now, actor: intent.actor },
  ];
  const governor = deps.governorFactory
    ? deps.governorFactory(new Map([[intent.intentId, events]]))
    : new ExecutionGovernorImpl(new Map([[intent.intentId, events]]));

  // Invariant 2: no execution before APPROVED. The governor authors the
  // APPROVED event (reason matches Alignment A); validate() then passes.
  await governor.approve(intent.intentId, {
    actor: "governor",
    reason: "auto-approved: low-risk route kind",
  });
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

  // Drive the machine to RUNNING via the shared prefix.
  const executionId = machine.createExecution(intent);
  machine.advanceToRunning(executionId);

  // X1 event stream: RUNNING (owner = executor via the governed wrapper).
  await governor.start(intent.intentId);

  try {
    const result = await executeRoute(route, ctx, executor);
    machine.transitionTo(executionId, ExecutionState.SUCCEEDED);
    // The governor's COMPLETED evidence carries a proper evidenceHash —
    // emit it (in addition to the machine's evidence) so the durable trail
    // is tamper-evident (spec c3).
    const terminalEvidence = await governor.complete(
      intent.intentId,
      "SUCCESS",
      result.slice(0, 200),
    );
    collector.emit("ExecutionCompleted", terminalEvidence);
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
    // Same tamper-evident terminal evidence on the failure path.
    const terminalEvidence = await governor.fail(intent.intentId, reason);
    collector.emit("ExecutionFailed", terminalEvidence);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Governed direct path (ticket #410)
// ---------------------------------------------------------------------------

export interface GovernedDirectOptions {
  /** Actor authoring the intent. Defaults to "system". */
  actor?: string;
  /** Downstream evidence emitter (e.g. PersistenceEvidenceEmitter). */
  emitter?: ExecutionEvidenceEmitter;
}

/**
 * Execute a `direct` route under the governed lifecycle.
 *
 * Daemon/CLI-facing helper for the direct fast path: produces the canonical
 * ExecutionIntent + CREATED/APPROVED lifecycle evidence, then runs the
 * direct execution (arithmetic answer or a single provider call) and emits
 * the terminal evidence.
 *
 * Session-domain separation (ticket #410): this writes ONLY lifecycle
 * evidence — it never creates an agent session, a TaskRegistry entry, or a
 * `.alix/sessions` / `.alix/plans` record. The lifecycle evidence store and
 * the session domain are distinct stores.
 *
 * @param route - A direct route (arithmetic or generation).
 * @param cwd - Working directory whose config the direct executor loads.
 * @param opts - Optional emitter / actor overrides.
 */
export async function governDirectRoute(
  route: TaskRoute & { kind: "direct" },
  cwd: string,
  opts: GovernedDirectOptions = {},
): Promise<GovernedRouteResult> {
  const { loadConfig } = await import("../config/loader.js");
  const config = await loadConfig(cwd);

  const ctx: RuntimeContext = {
    cwd,
    sessionId: "direct",
    sessionDir: "",
    eventLog: {} as never,
    config,
  };

  return executeRouteGoverned(route, ctx, new LocalRuntimeExecutor(), {
    actor: opts.actor,
    emitter: opts.emitter,
  });
}
