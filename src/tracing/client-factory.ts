/**
 * src/tracing/client-factory.ts
 *
 * Runtime client selection for the tracing facade (design §4, §10-11). ALiX
 * chooses its `TraceClient` implementation ONCE, at application construction:
 *
 *     tracing.enabled = false          tracing.enabled = true
 *             │                              │
 *             ▼                              ▼
 *     NoopTraceClient            LangfuseTraceClient
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
 * Selection is memoized per process: the first call for `enabled === true`
 * constructs the adapter (or degrades to Noop on failure) and that result is
 * cached for every later call. A disabled config always returns the shared
 * frozen {@link NOOP_TRACE_CLIENT} singleton without constructing anything or
 * resolving credentials (design §10).
 *
 * Construction failure contract (design §11 "Construction failure", Task 6
 * fail-open): a genuinely invalid config — empty baseUrl, non-http(s) baseUrl,
 * empty keys, a leftover unresolved `cred://` reference (config load leaves
 * these in place and warns, per src/config/loader.ts), or an SDK constructor
 * throw — is caught here, reported with a single warn, and degrades to Noop.
 * This is NOT used for transient transport failures: the SDK's own
 * retry/batching owns runtime transport behavior, and a temporary Langfuse
 * outage must never permanently disable tracing (design §11 "Runtime
 * transport failure").
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Created by: Task 9 (implement the tracing client factory) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */

import type { TracingConfig } from "../config/schema.js";
import type { TraceClient } from "./client.js";
import { LangfuseTraceClient } from "./langfuse-client.js";
import { NOOP_TRACE_CLIENT } from "./noop-client.js";
import { warnOnce } from "./warn-once.js";

/**
 * Stable warn-once key so a construction failure is reported exactly once per
 * process even if the message detail (throw text) differs across attempts.
 */
const CONSTRUCTION_WARN_KEY = "tracing-client-factory:langfuse-construction-failure";

/**
 * Memoized enabled-tracing result. `undefined` means "enabled selection not yet
 * attempted"; otherwise it holds either the live `LangfuseTraceClient` or the
 * Noop fallback chosen after a construction failure. Never reset at runtime —
 * changing the enabled tracing config requires a process restart (design §4:
 * selected once during construction).
 */
let enabledClient: TraceClient | undefined;

/**
 * Select the tracing implementation for the process.
 *
 * @param config — the resolved `tracing` config section from `loadConfig()`.
 *   Optional because `AlixConfig.tracing` is a typed-optional field that every
 *   runtime seam reads off an `AgentContext.config`; a missing/undefined
 *   section is treated as disabled (design §10 default). Only `config.enabled`
 *   is read when present; the full config is forwarded verbatim to
 *   {@link LangfuseTraceClient} when enabled (a disabled section is never
 *   touched, so nothing is constructed and no credential is resolved).
 * @returns a shared {@link TraceClient} — the frozen `NOOP_TRACE_CLIENT`
 *   singleton when disabled or when Langfuse construction fails, otherwise a
 *   memoized `LangfuseTraceClient`. Never throws.
 */
export function createTraceClient(config?: TracingConfig): TraceClient {
  if (!config || config.enabled !== true) return NOOP_TRACE_CLIENT;
  if (enabledClient !== undefined) return enabledClient;

  try {
    enabledClient = new LangfuseTraceClient(config);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnOnce(
      `[Tracing] Langfuse tracing disabled for this process (falling back to ` +
        `NoopTraceClient): ${detail}`,
      CONSTRUCTION_WARN_KEY,
    );
    enabledClient = NOOP_TRACE_CLIENT;
  }
  return enabledClient;
}
