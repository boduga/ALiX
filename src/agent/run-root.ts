/**
 * src/agent/run-root.ts
 *
 * Shared terminal-outcome wrapper for the run roots in this directory
 * (processTurn / processChat in session.ts). Each root synthesizes one
 * `run-<uuid8>` per invocation, starts a run trace BEFORE any provider work,
 * and must end that trace exactly once across every terminal path — return,
 * throw, cancellation (R1/R3, design §10/§12).
 *
 * The two session wrappers used to duplicate this try/catch/finally shape;
 * this helper is the single implementation. It maps the body's result to a
 * {@link RunOutcome}, records a fallback `error` outcome if an unexpected
 * throw escapes the body before its result is mapped, applies the
 * cancellation-vs-error classification (`isCancellationError` — operator
 * cancellation is a NORMAL terminal, never a failure), and endRuns exactly
 * once in a finally. Tracing failures are swallowed: the client contract is
 * fail-open, so a broken client never alters the turn's outcome.
 *
 * runTaskCore (agent-loop.ts) is intentionally NOT wired through this helper:
 * its start inputs (`ctx.sessionId`, `workflowId = wfRun.id`, `ctx.config`)
 * only exist after `initAgent` + `createWorkflowRun`, so its run root is
 * established by a deferred start inside the impl body (R1) and keeps its own
 * wrapper.
 */
import { isCancellationError } from "../runtime/cancellation-token.js";

export async function withTraceRun<T>(
  client: import("../tracing/client.js").TraceClient,
  traceRun: import("../tracing/types.js").TraceRun,
  fallbackError: string,
  mapResult: (result: T) => import("../tracing/types.js").RunOutcome,
  body: () => Promise<T>,
): Promise<T> {
  // Fallback default so endRun fires with an error outcome even if an
  // unexpected throw escapes the body before its outcome is mapped.
  let traceOutcome: import("../tracing/types.js").RunOutcome = {
    status: "error",
    error: fallbackError,
    endedAt: Date.now(),
  };
  try {
    const result = await body();
    traceOutcome = mapResult(result);
    return result;
  } catch (err) {
    traceOutcome = {
      status: isCancellationError(err) ? "cancelled" : "error",
      error: err instanceof Error ? err.message : String(err),
      endedAt: Date.now(),
    };
    throw err;
  } finally {
    // Exactly-once endRun across every terminal path (recon §3 a–i): the
    // finally fires once whether the body returned, threw a cancellation/
    // failure, or was interrupted. endRun finalizes the trace and then awaits
    // a flush bounded by flushTimeoutMs (Task 13, design §12); the client
    // contract is fail-open, but the swallow keeps a broken client from
    // altering the turn's outcome.
    try {
      await client.endRun(traceRun, traceOutcome);
    } catch {
      // Tracing must never change agent results.
    }
  }
}