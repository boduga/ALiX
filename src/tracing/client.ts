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
 * Lifecycle methods (`startRun`, `startModelSpan`, `startToolSpan`, `endSpan`,
 * `endRun`) are synchronous and cheap from the caller's perspective: they
 * enqueue/update local state only and must not perform network I/O. Transport
 * happens asynchronously; `flush()` and `shutdown()` are bounded.
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

  /** Complete a run exactly once. Ending an unknown/already-ended run is a no-op. */
  endRun(run: TraceRun, outcome: RunOutcome): void;

  /**
   * Bound the pending async transport. Resolves or rejects within the
   * configured timeout; must never change the outcome of an ALiX run.
   */
  flush(): Promise<void>;

  /**
   * Bounded final flush and release of resources. Safe to call once at
   * process/runtime teardown.
   */
  shutdown(): Promise<void>;
}
