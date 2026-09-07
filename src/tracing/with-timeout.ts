/**
 * src/tracing/with-timeout.ts
 *
 * Shared bounded-wait helper for the tracing module's bounded-flush /
 * bounded-shutdown contract (design §12-14, §23). Recon (plan Task 1) found no
 * generic promise-timeout helper in the repo (src/utils and src/runtime have
 * none), so this small module-scoped friend exists so the Langfuse adapter can
 * bound how long it waits on SDK transport (`flushAsync`/`shutdownAsync`)
 * without ever letting a hung SDK delay or fail ALiX execution.
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
 * has not settled. A non-positive `ms` means "never wait" and resolves
 * immediately. Rejection propagates to the caller.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  if (ms <= 0) return undefined;
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
