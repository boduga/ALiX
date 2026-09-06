/**
 * src/tracing/noop-client.ts
 *
 * The inert TraceClient selected when tracing is disabled or Langfuse
 * construction fails (design §4, §10-11). Instrumentation stays present but
 * has no tracing side effects, so runtime seams never branch on configuration.
 *
 * No Langfuse SDK is imported, no credential is resolved, and no network I/O
 * ever occurs through this implementation. It performs no allocations or
 * transport work beyond what is necessary to satisfy the TraceClient contract
 * (design §4): the span handle is a shared frozen module singleton (TraceSpan
 * exposes no readable state, types.ts); the run handle is a small frozen
 * object carrying the authoritative runId — TraceRun's only readable member is
 * documented as the ALiX run identity the handle was created for (types.ts),
 * so it is honored per call rather than fixed. flush/shutdown resolve
 * immediately and never throw.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Created by: Task 4 (implement NoopTraceClient) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */

import type { TraceClient } from "./client.js";
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
 * Shared frozen span handle. TraceSpan is pure brand (no readable state), so
 * one module-level object satisfies every span a caller may end.
 */
const NOOP_SPAN = Object.freeze({} as unknown as TraceSpan);

/**
 * Inert TraceClient satisfying the full {@link TraceClient} interface.
 * Stateless: every method is a no-op, and the same frozen instance may be
 * shared by the whole process (see {@link NOOP_TRACE_CLIENT}).
 */
export class NoopTraceClient implements TraceClient {
  startRun(input: TraceRunInput): TraceRun {
    return Object.freeze({ runId: input.runId } as unknown as TraceRun);
  }

  getRun(_runId: string): TraceRun | null {
    return null;
  }

  startModelSpan(_run: TraceRun, _input: ModelSpanInput): TraceSpan {
    return NOOP_SPAN;
  }

  startToolSpan(_run: TraceRun, _input: ToolSpanInput): TraceSpan {
    return NOOP_SPAN;
  }

  endSpan(_span: TraceSpan, _outcome: SpanOutcome): void {
    // no-op
  }

  endRun(_run: TraceRun, _outcome: RunOutcome): void {
    // no-op
  }

  async flush(): Promise<void> {
    // no-op
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}

/**
 * Shared frozen no-op instance for composition roots to select directly
 * (tracing disabled or Langfuse construction failure). Never mutated and
 * safe to share process-wide.
 */
export const NOOP_TRACE_CLIENT: TraceClient = Object.freeze(new NoopTraceClient());
