/**
 * src/tracing/with-timeout.ts
 *
 * Shared bounded-wait helper for the tracing module's bounded-flush /
 * bounded-shutdown contract (design §12-14, §23). This small module-scoped
 * friend lets the Langfuse adapter bound how long it waits on SDK transport
 * (`flushAsync`/`shutdownAsync`) without ever letting a hung SDK delay or fail
 * ALiX execution.
 *
 * NOTE — `src/runtime/side-effect-timeout.ts` also exports a `withTimeout`
 * (pre-T13, from #172). The two are deliberately different: the runtime
 * helper wraps a zero-arg effect callback, rejects with
 * `SideEffectTimeoutError` on timeout, and is used for side-effect budget
 * expiry (shell, file, provider, MCP). This helper takes a live Promise and
 * resolves `undefined` on timeout — a flush timeout means "stop awaiting,
 * continue" (design §13), not an error. Different signatures, different
 * semantics, no collision.
 *
 * Behavior:
 *   - If the underlying promise settles first, it resolves with that value
 *     (or, when it rejects, that rejection propagates to the caller — the
 *     caller is responsible for the warn-and-continue policy).
 *   - If the timeout fires first, it resolves `undefined` — the caller stops
 *     awaiting and continues (the SDK keeps its own lifecycle; we never
 *     synchronously discard its buffers).
 *
 * Kept local to src/tracing until a second consumer outside the module appears.
 *
 * Created by: Task 13 (implement bounded flush) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */

/**
 * Resolve with the promise's value, or `undefined` after `ms` when the promise
 * has not settled. A non-positive or non-finite `ms` means "never wait" and
 * resolves immediately. Rejection propagates to the caller.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
