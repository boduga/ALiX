/**
 * src/daemon/daemon-tracing-shutdown.ts
 *
 * Fail-open tracing shutdown for the daemon's SIGTERM handler. The daemon
 * executes runTask in-process, so the memoized process TraceClient lives here;
 * the config-free deep-seam accessor (src/tracing/client-factory.ts
 * `getProcessTraceClient`) resolves the SAME instance the run roots created —
 * Noop, zero-cost, when tracing was never enabled (the default). Bounded by
 * the adapter's flush budget and fail-open, so tracing can never block or fail
 * daemon exit.
 *
 * Extracted from the daemon's inline SIGTERM body (Task 15) into an importable
 * leaf so the fail-open contract is unit-testable without the process-level
 * argv/listen side effects of daemon-server.ts.
 *
 * Task: Task 15 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */

/**
 * Await the process TraceClient's bounded shutdown, absorbing every failure.
 * Never rejects — caller may follow with `process.exit(0)` unconditionally.
 */
export async function shutdownProcessTraceClient(): Promise<void> {
  try {
    const { getProcessTraceClient } = await import("../tracing/client-factory.js");
    await (await getProcessTraceClient()).shutdown();
  } catch {
    // Tracing must never block or fail daemon exit; fail-open.
  }
}