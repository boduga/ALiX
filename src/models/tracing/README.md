# Tracing Facade

## Overview
ALiX-owned observability seam. Runtime instrumentation sees only the `TraceClient` interface and ALiX-shaped types; provider SDKs never leak past the adapter. Selection happens once at process construction: disabled or absent config resolves to a frozen no-op client with zero SDK work, and enabled config lazily imports the Langfuse/OTel adapter, degrading to no-op on any construction failure. Tracing is observational — it must never change execution outcomes.

## Interface
- `TraceClient` — `startRun`, `getRun`, `startModelSpan`, `startToolSpan`, `endSpan`, `endRun`, `flush`, `shutdown` [client.ts:TraceClient]
- `RunStatus`, `SpanStatus`, `TraceRun`, `TraceSpan` (opaque branded handles) [types.ts:RunStatus], [types.ts:TraceRun], [types.ts:TraceSpan]
- `TraceRunInput`, `ModelSpanInput`, `ToolSpanInput`, `SpanOutcome`, `RunOutcome` [types.ts:TraceRunInput], [types.ts:ModelSpanInput], [types.ts:ToolSpanInput]
- `NoopTraceClient`, `NOOP_TRACE_CLIENT`, `NOOP_SPAN` [noop-client.ts:NoopTraceClient], [noop-client.ts:NOOP_TRACE_CLIENT]
- `createTraceClient(config?)`, `getProcessTraceClient()` [client-factory.ts:createTraceClient], [client-factory.ts:getProcessTraceClient]
- `CaptureLevel` (`full|truncated|off`), `CaptureLimits`, `REDACTED` [capture.ts:CaptureLevel], [capture.ts:CaptureLimits], [capture.ts:REDACTED]
- `redactString()`, `captureString()`, `captureValue()`, `captureMessages()`, `captureToolArgs()` [capture.ts:redactString], [capture.ts:captureString], [capture.ts:captureValue], [capture.ts:captureMessages], [capture.ts:captureToolArgs]
- `LangfuseTraceClient` — SDK adapter implementing `TraceClient` [langfuse-client.ts:LangfuseTraceClient]
- `warnOnce(message, key?)` [warn-once.ts:warnOnce]
- `withTimeout(promise, ms)` — resolves `undefined` on timeout [with-timeout.ts:withTimeout]

## Invariants
- The facade is SDK-free: no Langfuse/OTel type appears in `types.ts`; SDK objects and ids never escape the opaque `TraceRun`/`TraceSpan` handles [types.ts:TraceRun]
- `runId` is the authoritative ALiX identity on `TraceRun`; the adapter never invents a second run identity [types.ts:TraceRunInput]
- One run id produces one root trace; `startRun` on an already-active run id is a no-op, and `getRun` returns `null` for unknown runs [client.ts:TraceClient]
- Lifecycle methods are synchronous local SDK operations; `endRun`, `flush`, and `shutdown` are bounded and must never reject into the caller [client.ts:TraceClient]
- `endSpan`/`endRun` are exactly-once; ending unknown or already-ended targets is a safe no-op [client.ts:TraceClient]
- Creation is process-memoized: the first enabled attempt, including its Noop fallback, is cached in `enabledClientPromise` and never reset — enabled-config changes require a process restart [client-factory.ts:createTraceClient]
- A disabled or absent config resolves the shared frozen `NOOP_TRACE_CLIENT` without importing the adapter, constructing an SDK client, or resolving credentials [client-factory.ts:createTraceClient]
- The adapter is only dynamically imported on the enabled path; this module has no static adapter import [client-factory.ts:createTraceClient]
- Construction failure (invalid base URL, unresolved `cred://` ref, SDK throw, module-load failure) warns once and degrades to Noop; the factory promise never rejects [client-factory.ts:createTraceClient]
- `getProcessTraceClient` returns the same memoized instance as `createTraceClient`, or Noop when no enabled selection has occurred [client-factory.ts:getProcessTraceClient]
- Redaction always precedes truncation and cannot be disabled, including at level `full`; `off` returns `undefined` so the field is omitted [capture.ts:captureString]
- Capture returns fresh arrays/objects and never mutates caller-owned payloads; only plain objects and arrays are deep-copied [capture.ts:captureValue]
- Capture is best-effort and non-exhaustive (pattern-based, not entropy-based); callers must not intentionally submit secrets [capture.ts:redactString]
- Default truncation limits are 4000 chars, 1000 items, 200 properties, 12 depth [capture.ts:DEFAULT_LIMITS]
- The capture character limit governs messages; tool-output capture has its own limit while tool arguments, reasoning, and errors use the message limit [capture.ts:CaptureLimits]
- `warnOnce` emits `console.warn` once per process per key and stays silent thereafter [warn-once.ts:warnOnce]
- `withTimeout` resolves with the value on settlement and `undefined` on timeout; rejection propagates to the caller, which owns the warn-and-continue policy [with-timeout.ts:withTimeout]
- A non-positive or non-finite timeout budget resolves immediately without waiting [with-timeout.ts:withTimeout]

## Side Effects
- Enabled construction registers an isolated `BasicTracerProvider` and `AsyncLocalStorageContextManager`; it never touches the global tracer provider [langfuse-client.ts:LangfuseTraceClient]
- Enabled mode performs network transport to the configured Langfuse endpoint, flushed and shut down only within the configured budget [langfuse-client.ts:LangfuseTraceClient]
- `warnOnce` writes to `console.warn` and retains a module-local dedupe `Set` [warn-once.ts:warnOnce]
- Capture performs in-memory string/regex work and allocates a `WeakSet` for cycle detection; no I/O [capture.ts:captureValue]
- Disabled tracing performs zero transport work, allocates no spans beyond a frozen shared sentinel, and resolves immediately [noop-client.ts:NoopTraceClient]

## Verification
- Run: `pnpm test`
