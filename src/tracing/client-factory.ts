/**
 * src/tracing/client-factory.ts
 *
 * Runtime client selection for the tracing facade (design §4, §10-11). ALiX
 * chooses its `TraceClient` implementation ONCE, at application construction:
 *
 *     tracing.enabled = false          tracing.enabled = true
 *             │                              │
 *             ▼                              ▼
 *     NoopTraceClient             ┌─ await import("./langfuse-client.js")
 *                                 │   (adapter + langfuse SDK evaluated
 *                                 │    only now, on the enabled path)
 *                                 ▼
 *                       LangfuseTraceClient
 *                                       │ construction/init failure
 *                                       ▼
 *                                 warn once
 *                                       ▼
 *                                 NoopTraceClient
 *
 * The rest of ALiX receives only the {@link TraceClient} interface (via this
 * factory) and never branches on configuration. Instrumentation seams
 * (Tasks 10-14) call {@link createTraceClient} with the resolved `tracing`
 * section from `loadConfig()` and hold the returned instance for the process.
 *
 * Lazy adapter load (Task 10 review fix): this module has NO static import of
 * the adapter. The `langfuse` SDK module graph is only ever evaluated when an
 * enabled config is actually requested — `langfuse-client.js` (and through it
 * the `langfuse` package) is pulled in by a dynamic `import()` inside the
 * enabled branch of {@link createTraceClient}. Every default-disabled run that
 * imports this module (via the run/tui/agent-loop wiring) therefore never
 * parses/evaluates the Langfuse SDK graph (Task 4 acceptance). Because the
 * load is asynchronous, {@link createTraceClient} is `async`: it returns a
 * `Promise<TraceClient>`. The factory keeps the caller-facing contract — the
 * resolved `TraceClient`'s lifecycle methods (`startRun`/`endRun`/…) stay
 * synchronous; only acquisition is async, once, at bootstrap.
 *
 * Selection is memoized per process: the first call for `enabled === true`
 * kicks off the adapter load (or degrades to Noop on failure) and the memoized
 * promise resolves to the same client for every later call. A disabled config
 * always resolves to the shared frozen {@link NOOP_TRACE_CLIENT} singleton
 * without importing or constructing anything or resolving credentials
 * (design §10).
 *
 * Construction failure contract (design §11 "Construction failure", Task 6
 * fail-open): a genuinely invalid config — empty baseUrl, non-http(s) baseUrl,
 * empty keys, a leftover unresolved `cred://` reference (config load leaves
 * these in place and warns, per src/config/loader.ts), an SDK constructor
 * throw, OR a failed adapter module load — is caught here, reported with a
 * single warn, and degrades to Noop. The returned promise NEVER rejects: every
 * path resolves to a `TraceClient`. This is NOT used for transient transport
 * failures: the SDK's own retry/batching owns runtime transport behavior, and
 * a temporary Langfuse outage must never permanently disable tracing (design
 * §11 "Runtime transport failure").
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Created by: Task 9 (implement the tracing client factory) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 * Lazy adapter load + async factory: Task 10 review fix (Important #1).
 */

import type { TracingConfig } from "../config/schema.js";
import type { TraceClient } from "./client.js";
import { NOOP_TRACE_CLIENT } from "./noop-client.js";
import { warnOnce } from "./warn-once.js";

/**
 * Stable warn-once key so a construction failure is reported exactly once per
 * process even if the message detail (throw text) differs across attempts.
 */
const CONSTRUCTION_WARN_KEY = "tracing-client-factory:langfuse-construction-failure";

/**
 * Shared resolved promise for the disabled/failed selection. Memoized so a
 * disabled call allocates nothing per invocation and always resolves to the
 * same frozen {@link NOOP_TRACE_CLIENT} singleton.
 */
const NOOP_TRACE_CLIENT_PROMISE: Promise<TraceClient> =
  Promise.resolve(NOOP_TRACE_CLIENT);

/**
 * Memoized enabled-tracing selection. `undefined` means "enabled selection not
 * yet attempted"; otherwise it holds a promise resolving to either the live
 * `LangfuseTraceClient` or the Noop fallback chosen after a construction or
 * module-load failure. Never reset at runtime — changing the enabled tracing
 * config requires a process restart (design §4: selected once during
 * construction).
 */
let enabledClientPromise: Promise<TraceClient> | undefined;

/**
 * Load the adapter module and construct the client. The dynamic `import()` is
 * what gates the `langfuse` module graph: it fires ONLY on the enabled path,
 * so a default-disabled process never evaluates the SDK. Both a module-load
 * failure and a constructor throw are treated identically — warn-once then
 * Noop (fail-open, design §11). Never rejects.
 */
async function constructEnabledClient(config: TracingConfig): Promise<TraceClient> {
  try {
    const { LangfuseTraceClient } = await import("./langfuse-client.js");
    return new LangfuseTraceClient(config);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnOnce(
      `[Tracing] Langfuse tracing disabled for this process (falling back to ` +
        `NoopTraceClient): ${detail}`,
      CONSTRUCTION_WARN_KEY,
    );
    return NOOP_TRACE_CLIENT;
  }
}

/**
 * Select the tracing implementation for the process.
 *
 * @param config — the resolved `tracing` config section from `loadConfig()`.
 *   Optional because `AlixConfig.tracing` is a typed-optional field that every
 *   runtime seam reads off an `AgentContext.config`; a missing/undefined
 *   section is treated as disabled (design §10 default). Only `config.enabled`
 *   is read when present; the full config is forwarded verbatim to
 *   {@link LangfuseTraceClient} when enabled (a disabled section is never
 *   touched, so nothing is imported, constructed, or resolved).
 * @returns a promise resolving to a shared {@link TraceClient} — the frozen
 *   `NOOP_TRACE_CLIENT` singleton when disabled or when Langfuse construction
 *   fails, otherwise a memoized `LangfuseTraceClient`. Never rejects.
 */
export function createTraceClient(config?: TracingConfig): Promise<TraceClient> {
  if (!config || config.enabled !== true) return NOOP_TRACE_CLIENT_PROMISE;
  if (enabledClientPromise === undefined) {
    // Assign synchronously so concurrent first callers share one load.
    enabledClientPromise = constructEnabledClient(config);
  }
  return enabledClientPromise;
}
