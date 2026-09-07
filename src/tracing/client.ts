/**
 * src/tracing/client.ts
 *
 * The TraceClient facade — the ONLY tracing API ALiX runtime seams ever see.
 *
 * This is an ALiX-owned seam over an observability provider. Instrumentation
 * code (run roots, `withProviderContracts`, `ToolExecutor.execute`) imports
 * nothing else from src/tracing and never imports a provider SDK. Replacing
 * the provider means replacing only the adapter that implements this interface.
 *
 * Implementations must honor the lifecycle invariants in src/tracing/AGENTS.md
 * (idempotent lifecycle, no network I/O from lifecycle methods, bounded
 * flush/shutdown, tracing never fails agent execution).
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Created by: Task 3 (create tracing module boundary) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */

import type {
  ModelSpanInput,
  RunOutcome,
  SpanOutcome,
  ToolSpanInput,
  TraceRun,
  TraceRunInput,
  TraceSpan,
} from "./types.js";

/**
 * Tracing facade over ALiX agent execution.
 *
 * Lifecycle methods (`startRun`, `startModelSpan`, `startToolSpan`, `endSpan`)
 * are synchronous and cheap from the caller's perspective: they enqueue/update
 * local state only and must not perform network I/O. `endRun` completes the
 * run trace synchronously and THEN awaits a bounded flush (design §12): the
 * caller waits at most `flushTimeoutMs` for the transport and continues
 * regardless of resolve/reject/timeout. Transport happens asynchronously;
 * `flush()` and `shutdown()` are bounded.
 *
 * All lifecycle operations are safe under retries, cancellation, errors, and
 * `finally` blocks (design §3): unknown/ended runs and spans are safe no-ops,
 * and tracing errors never propagate into agent execution.
 */
export interface TraceClient {
  /**
   * Register a run and begin its trace. Exactly one trace per ALiX runId;
   * a repeated startRun for an already-active runId is a no-op.
   */
  startRun(input: TraceRunInput): TraceRun;

  /**
   * Resolve the active run handle for a runId, or null when no trace is
   * active for it (seams then skip span creation).
   */
  getRun(runId: string): TraceRun | null;

  /**
   * Start a model span (one physical provider request). Returns an opaque
   * handle to end via {@link endSpan}.
   */
  startModelSpan(run: TraceRun, input: ModelSpanInput): TraceSpan;

  /**
   * Start a tool span (one physical tool call). Returns an opaque handle to
   * end via {@link endSpan}.
   */
  startToolSpan(run: TraceRun, input: ToolSpanInput): TraceSpan;

  /** Complete a span exactly once. Ending an already-ended span is a no-op. */
  endSpan(span: TraceSpan, outcome: SpanOutcome): void;

  /**
   * Complete a run exactly once and bound the pending transport (design §12):
   * after finalizing the run trace, awaits a flush bounded by the configured
   * `flushTimeoutMs`. Resolves regardless of whether the flush resolved,
   * rejected, or timed out — it must never change the outcome of an ALiX run
   * nor delay it beyond the budget. Ending an unknown/already-ended run is a
   * no-op that still resolves immediately.
   */
  endRun(run: TraceRun, outcome: RunOutcome): Promise<void>;

  /**
   * Bound the pending async transport. Resolves within the configured
   * `flushTimeoutMs` and, like {@link endRun}'s internal flush, must never
   * change the outcome of an ALiX run (fail-open on reject, resolve on
   * timeout). The implementation never rejects into the caller.
   */
  flush(): Promise<void>;

  /**
   * Final flush and release of resources. Safe to call once at process/runtime
   * teardown. Currently delegates to the SDK's `shutdownAsync` and is fail-open
   * (a reject is absorbed and warned once). Bounded by `flushTimeoutMs` once
   * the T14 bounded-shutdown work lands. — pending T14
   */
  shutdown(): Promise<void>;
}
