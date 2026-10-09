# DOX — Tracing Facade

## Purpose

Expose ALiX-owned tracing through `TraceClient`, backed by the default Noop client or a Langfuse v5/OTel adapter. Tracing is observational: it must never change execution outcomes.

## Ownership

| File | Responsibility |
|------|----------------|
| `types.ts` | ALiX-shaped run/model/tool inputs, outcomes, statuses, and opaque handles; no SDK types |
| `client.ts` | `TraceClient` facade, including run lookup for deep seams |
| `noop-client.ts` | Frozen `NOOP_TRACE_CLIENT`: no SDK imports, credentials, network, or span allocation |
| `capture.ts` | Pure capture copies; mandatory redaction before truncation; full/truncated/off levels |
| `langfuse-client.ts` | SDK adapter, isolated tracer provider, active-run registry, observation parentage, capture, fail-open lifecycle, bounded transport |
| `client-factory.ts` | Async lazy selection, process memoization, config-free `getProcessTraceClient` accessor |
| `warn-once.ts` | Module-local, key-deduplicated warnings |
| `with-timeout.ts` | Bounded wait: value on settlement, undefined on timeout, rejection delegated to caller |

Configuration belongs to `src/operations/config/schema.ts`, defaults, loader, and validator; there is no tracing-local configuration file. Design reference: `docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md`.

## Local Contracts

- **Process selection:** `createTraceClient` memoizes the first enabled construction attempt, including Noop fallback, as a promise. Enabled configuration changes require restart. Disabled or absent configuration returns the frozen Noop without adapter evaluation, SDK construction, credential resolution, or network. Deep seams obtain the same client through `getProcessTraceClient`.
- **Lazy SDK boundary:** only `langfuse-client.ts` statically imports Langfuse and OTel SDK packages. The factory dynamically imports the adapter only when enabled; it never statically imports it. No module outside tracing imports the adapter. Direct dynamic Langfuse imports are allowed only in the factory. Runtime consumers use facade types, factory accessors, or the Noop client.
- **Identity:** normalized ALiX types are type-only dependencies. Existing run, session, workflow, parent-run, invocation, tool-call, and execution ids remain authoritative; do not invent a second identity or event store. SDK objects, observation ids, and OTel trace ids never escape opaque `TraceRun`/`TraceSpan` handles.
- **Run lifecycle:** one run id produces one root observation and one trace; descendants share that trace. Starting a known run is idempotent. Unknown run lookup returns null; ending unknown/ended runs or spans is a no-op. Deep seams skip spans when run lookup fails. Chat creates one synthetic run id per invocation and reuses it across continuation requests.
- **Request cardinality:** one physical provider request produces one model span, including an entire stream rather than each chunk. Streaming failure followed by a blocking fallback produces two requests and two spans. Each span ends exactly once on success, failure, cancellation, or consumer early-close. Tool instrumentation preserves caller-visible results and errors with or without tracing.
- **Parent translation:** only explicit in-process parent ids establish parentage. A child with no explicit session inherits a live parent's session while retaining its own trace; parent identity remains metadata. Explicit child session wins. Unknown, ended, cross-process, or failed parents degrade to standalone traces without throwing. Never infer parentage from call order or merge traces.
- **OTel setup:** enabled construction registers `AsyncLocalStorageContextManager` once per process so attribute propagation is active. Use an isolated `BasicTracerProvider` registered through Langfuse, never the global tracer provider. Re-propagate session identity for every child created outside the root propagation scope. The processor uses immediate export and explicit resolved keys and base URL.
- **Lifecycle transport:** start/lookup/model/tool/span-end methods are synchronous local SDK operations. `endRun`, `flush`, and `shutdown` are async and must be awaited. Ending a run finalizes its root then awaits one bounded flush. Process shutdown is idempotent and uses one shutdown budget, never separate flush plus shutdown budgets. Existing CLI/TUI finally blocks and daemon SIGTERM own teardown; do not add another process lifecycle.
- **Bounded waits:** flush and run-end use processor force-flush; shutdown uses processor shutdown. Both use the configured flush budget (default 2000 ms). Timeout stops waiting and resolves; synchronous throws and pre-budget rejections warn once and resolve; late rejections are absorbed. Invalid non-positive/non-finite helper budgets resolve immediately, while configuration rejects them. The runtime side-effect timeout helper instead rejects and must not replace this helper.
- **Fail-open:** invalid base URL, unresolved store reference, adapter import failure, or SDK construction failure warns once and selects Noop. Lifecycle failures never crash, hang, exceed the transport budget, or change run outcome. Transient transport failure does not permanently disable the selected client.
- **Statuses:** success/error/cancelled are authoritative. Denials, timeouts, and failures map to error; operator cancellation maps to cancelled. Langfuse level is ERROR only for errors, otherwise DEFAULT; preserve cancellation in ALiX metadata. Mirror error/OK on OTel status; attach status messages when outcome error text is present.
- **Capture security:** redaction always precedes truncation and cannot be disabled, including full capture. Off returns undefined, meaning omitted. Helpers return copies. Detection covers common key/token assignments, authorization headers, credential references, and PEM blocks; it is best-effort, non-exhaustive, and not an entropy scan. Callers must not intentionally submit secrets.
- **Capture controls:** message capture governs both model input and output. Tool-output capture and its character limit govern output only; tool arguments, reasoning, and errors use the message character limit. Defaults are 2000 tool-output characters and 4000 message characters. Credentials resolve from the store only; always supply explicit processor keys so SDK environment fallback cannot occur.
- **Configuration:** tracing defaults disabled. Enabled base URL must be HTTP(S); public/secret keys default to the Langfuse store references. Capture levels are closed-set; limits are non-negative integers, allowing zero; flush timeout is a positive integer. Nested overrides preserve unrelated defaults. Do not expose extra SDK tuning without an ALiX requirement.
- **Seams:** `withProviderContracts` in `src/models/providers/provider-contract-validation.ts` resolves model spans from request context and the process client. `ToolExecutor` in `src/capabilities/tools/executor.ts` resolves tool spans from request run id. Agent loop and session entry points create run roots through the same client. Missing run identity yields Noop spans.

## Work Guidance

- Keep public exports ALiX-shaped and SDK-free. Extend the facade for runtime requirements rather than adapter convenience.
- Reuse normalized message/request/response types and existing secret-redaction conventions; keep capture pure.
- Route structured capture through `captureValue`, `captureMessages`, or `captureToolArgs`, and text through `captureString`; never bypass redaction or truncate before redaction.
- New fake-SDK suites use `tests/tracing/fakes/langfuse-sdk.ts`, mocking the OTel processor while leaving real Langfuse tracing unmocked. Load the adapter dynamically through the factory; static imports risk mock-hoisting initialization errors. Reset recorder counters between scenarios and resolve child observations through trace identity, since run metadata belongs to roots.
- Adapter unit tests retain their richer inline fake to exercise hang/reject/sync-throw paths and an unguarded end counter. Module-evaluation probes use per-scenario mocks and reset modules; unmock before resetting so cached pass-through mocks cannot shadow failure probes. Compare stable outcomes without timestamp-sensitive token-pressure values.

## Verification

- `pnpm typecheck` and `pnpm build`.
- `pnpm vitest run tests/tracing --config vitest.config.mts`.
- Capture, Noop, factory, adapter, timeout, and configuration suites cover redaction, lifecycle idempotency, concurrent run isolation, transport recovery, disabled-path zero work, construction failure, bounded teardown, and deep-merge validation.
- Wiring, streaming, tool, and chat-continuation suites verify trace/session correlation, exactly-once termination, one span per physical request, two spans for stream/fallback pairs, unchanged tool outcomes, and one root across continuations.
- `tests/tracing/tracing-uncovered-seams.vitest.ts` covers plan-phase, action-classifier, and grounded-chat provider calls. `tests/tracing/langfuse-boundary.vitest.ts` checks static SDK boundaries; disabled/misconfigured runtime probes check lazy module evaluation.
- `tests/cli/commands/run-tracing-shutdown.vitest.ts` and daemon tracing/shutdown tests cover entry-point teardown. Allow composed-runtime tests their existing 30-second test budgets.

## Child DOX Index

None.
