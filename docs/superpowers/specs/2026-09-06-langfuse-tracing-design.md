# Design — Langfuse Tracing for ALiX

**Date:** 2026-09-06
**Status:** Approved for implementation
**Scope owner:** `src/tracing/`

---

## Summary

Instrument ALiX agent execution with Langfuse tracing, exporting **exactly one Langfuse trace per ALiX `runId`**, with model and tool spans contained within that trace.

Chat turns, which do not currently have a native ALiX `runId`, synthesize one per `processChat` invocation so they receive the same uniform trace model.

ALiX owns observability semantics, identity, capture policy, and lifecycle semantics. Langfuse and the official Langfuse SDK own Langfuse-specific transport mechanics.

The implementation uses the official **`langfuse` v3 SDK behind a thin ALiX-owned `TraceClient` facade**.

---

# Locked decisions

1. **Approach A:** use the official `langfuse` SDK v3 behind a thin, ALiX-owned `TraceClient` facade.
2. The Langfuse adapter is the **only file that imports the Langfuse SDK**.
3. Instrumentation seams remain completely provider-agnostic. Replacing Langfuse does not require changing instrumentation seams; only the provider-specific adapter and associated dependency/configuration need to change.
4. **Exactly one Langfuse trace corresponds to exactly one ALiX `runId`.**
5. Turns, model calls, and tool calls are represented as spans within that trace.
6. `processChat`, which lacks a native `runId`, synthesizes one per invocation.
7. Instrumentation occurs at three runtime seams:

   * run/turn root
   * `withProviderContracts`
   * `ToolExecutor.execute`
8. Trace and span completion is synchronous from the caller's perspective and performs no network I/O.
9. Langfuse SDK batching handles asynchronous transport.
10. `flush()` is bounded and can never change the success/failure outcome of an ALiX run.
11. Capture policy is ALiX-owned, pure, copy-producing, and performs mandatory secret redaction before truncation.
12. Secret redaction is always enabled and cannot be disabled through configuration.
13. Credentials use the existing `cred://` store-only mechanism. No environment-variable resolution is introduced.
14. Tracing is disabled by default.
15. No second event store, telemetry system, or competing run identity is introduced.

---

# 1. Architecture

```text
ALiX runtime seams                 TraceClient facade             Langfuse SDK v3
──────────────────                 ─────────────────              ───────────────

runTaskCore / processTurn ───────▶ startRun ─────────┐
processChat ─────────────────────▶ startRun          │
                                                     │
withProviderContracts ───────────▶ model span        │
                                                     │
ToolExecutor.execute ────────────▶ tool span         │
                                                     │
                                                     ▼
                                              TraceClient
                                                     │
                                                     ▼
                                           Langfuse adapter
                                                     │
                                                     ▼
                                              Langfuse SDK
                                                     │
                                                     ▼
                                                 Langfuse
```

## Module boundary

Create:

```text
src/tracing/
```

with its own:

```text
src/tracing/AGENTS.md
```

`src/tracing/` is a **leaf module**.

It owns:

* trace identity translation
* span semantics
* lifecycle semantics
* parent-run linkage
* capture policy
* redaction
* tracing configuration
* Langfuse adapter boundary

It does **not** own:

* a second runtime event system
* a second persisted telemetry store
* an alternative run identity
* duplicated execution state
* provider-specific execution behavior

The tracing module consumes existing ALiX runtime identities and normalized data:

```text
runId
sessionId
workflowId
parentRunId
invocationId
toolCallId
executionId
ExecutionContext
normalized provider results
normalized tool results
```

These remain authoritative.

---

## Dependency isolation

Only the Langfuse adapter imports `langfuse`.

Conceptually:

```text
src/tracing/
├── client.ts
├── noop-client.ts
├── types.ts
├── capture.ts
├── config.ts
└── langfuse-client.ts    ← only file importing `langfuse`
```

The exact file names may follow existing repository conventions.

Instrumentation code imports only ALiX tracing interfaces/types.

It must never import:

```ts
langfuse
```

directly.

This guarantees that changing observability providers does not propagate provider-specific types through the runtime.

---

# 2. TraceClient interface

The facade deliberately exposes a substantially smaller API than Langfuse:

```ts
interface TraceClient {
  startRun(input: TraceRunInput): TraceRun;

  getRun(runId: string): TraceRun | null;

  startModelSpan(
    run: TraceRun,
    input: ModelSpanInput,
  ): TraceSpan;

  startToolSpan(
    run: TraceRun,
    input: ToolSpanInput,
  ): TraceSpan;

  endSpan(
    span: TraceSpan,
    outcome: SpanOutcome,
  ): void;

  endRun(
    run: TraceRun,
    outcome: RunOutcome,
  ): void;

  flush(): Promise<void>;

  shutdown(): Promise<void>;
}
```

The exact type definitions should follow existing ALiX conventions.

---

## ALiX-shaped inputs

Inputs use ALiX concepts rather than Langfuse SDK objects.

Examples include:

```text
TraceRunInput
  runId
  sessionId?
  workflowId?
  parentRunId?
  task?
  actor?

ModelSpanInput
  invocationId?
  provider
  model
  resolvedModel?
  request/messages
  timestamps

ToolSpanInput
  toolName
  capability?
  toolCallId?
  invocationId?
  executionId?
  args

SpanOutcome
  status
  inputTokens?
  outputTokens?
  finishReason?
  output?
  error?

RunOutcome
  status
  error?
```

The exact schemas should be derived from existing normalized runtime types where possible rather than creating duplicate representations.

---

## Opaque handles

`TraceRun` and `TraceSpan` are opaque ALiX handles.

The following must never escape the adapter:

```text
Langfuse trace object
Langfuse span object
Langfuse generation object
SDK-specific IDs/types
```

The adapter translates between ALiX handles and Langfuse objects internally.

---

# 3. Active-run registry

The facade maintains an in-memory active-run registry:

```text
Map<runId, TraceRun>
```

Lifecycle:

```text
startRun(runId)
      │
      ▼
activeRuns.set(runId, TraceRun)
      │
      ├── model spans
      ├── tool spans
      └── child linkage
      │
      ▼
endRun(runId)
      │
      ▼
activeRuns.delete(runId)
```

Deep instrumentation seams may only have an `ExecutionContext` and `runId`, not a `TraceRun` handle.

The facade exposes `getRun(runId)`, backed by the active-run registry, so a seam
resolves its handle:

```text
ExecutionContext.runId
        ↓
client.getRun(runId)
        ↓ null (no active trace)      → skip span creation (no-op)
        ↓ TraceRun
startModelSpan / startToolSpan(run, input)
```

The facade is responsible for finding the active trace.

Instrumentation code does not need to understand Langfuse trace IDs.

A deep seam must never be able to synthesize its own `TraceRun`; spans attach
only to runs the facade has registered via `startRun`.

---

## Lifecycle idempotency

Tracing lifecycle operations must be safe under retries, cancellation, errors, and `finally` blocks.

Required behavior:

```text
startRun(existing runId)
    → no duplicate Langfuse trace

getRun(unknown runId)
    → null → seams skip span creation

endRun(unknown runId)
    → no-op

startModelSpan(unknown runId)
    → no-op span

startToolSpan(unknown runId)
    → no-op span

endSpan(already-ended span)
    → no-op

endRun(already-ended run)
    → no-op
```

Tracing lifecycle errors must never propagate into agent execution.

---

# 4. No-op client

Tracing implementation is selected once during construction:

```text
tracing.enabled = true
        │
        ▼
LangfuseTraceClient

tracing.enabled = false
        │
        ▼
NoopTraceClient
```

If initialization fails:

```text
Langfuse initialization failure
        │
        ▼
warn once
        │
        ▼
NoopTraceClient
```

Instrumentation seams therefore contain no repeated configuration checks:

```text
if (config.tracing.enabled) ...
```

The runtime simply invokes the interface.

The no-op implementation performs no allocations or transport work beyond what is necessary to satisfy the interface contract.

---

# 5. Run lifecycle

The semantic lifecycle is:

```text
startRun
   │
   ├── model spans
   ├── tool spans
   ├── additional model/tool spans
   │
   ▼
endRun
   │
   ▼
bounded flush
```

`flush()` does **not** implicitly mean that a run has completed.

`endRun()` explicitly represents ALiX run completion.

The adapter translates this semantic operation into the appropriate Langfuse trace update.

---

# 6. Data minimization & redaction

Captured payloads pass through a pure `CapturePolicy`.

Location:

```text
src/tracing/capture.ts
```

The policy:

* never mutates caller-owned objects
* returns copies
* applies capture levels
* applies mandatory redaction
* applies truncation limits

---

## Security-critical pipeline

The ordering is mandatory:

```text
raw value
    ↓
mandatory redaction
    ↓
truncation
    ↓
capture
```

Redaction **must occur before truncation**.

This prevents a credential from being cut across a truncation boundary in a way that prevents the detector from matching it.

---

# 7. Mandatory secret redaction

Built-in redaction is:

* always enabled
* non-disableable
* ALiX-owned
* best-effort
* applied before truncation

The initial detector covers common secret shapes including:

```text
sk-/pk- style tokens
api_key / api-key / apikey assignments
Authorization:
Bearer <token>
cred://<provider>/<key>
PEM private/public key blocks
OpenAI/Langfuse-style key prefixes
```

Replacement:

```text
<redacted>
```

The implementation should avoid claiming that the detector is exhaustive.

The contract is explicitly:

> Capture policy provides best-effort built-in secret redaction. Callers remain responsible for not intentionally supplying sensitive data for capture.

---

## `full` capture

`full` does **not** mean raw/unredacted.

The semantic pipeline remains:

```text
full:
raw
 ↓
mandatory redaction
 ↓
full remaining value
```

Therefore mandatory redaction cannot be bypassed by setting a capture field to `full`.

---

# 8. Capture levels

Configurable capture levels:

```text
full
truncated
off
```

Default policy:

| Data                 | Default     |
| -------------------- | ----------- |
| Model input messages | `truncated` |
| Model output text    | `truncated` |
| Model reasoning      | `off`       |
| Tool input args      | `truncated` |
| Tool output preview  | `truncated` |

The configuration controls:

* whether data is captured
* how much data is captured

It never controls:

* whether mandatory secret redaction occurs

---

# 9. Configuration

Add a new top-level `tracing` section.

Example:

```json
{
  "tracing": {
    "enabled": false,
    "langfuse": {
      "baseUrl": "http://langfuse.example:3000",
      "publicKey": "cred://langfuse/publicKey",
      "secretKey": "cred://langfuse/secretKey"
    },
    "capture": {
      "messages": "truncated",
      "reasoning": "off",
      "toolInput": "truncated",
      "toolOutput": "truncated",
      "maxMessageChars": 4000,
      "maxToolOutputChars": 2000
    },
    "flushTimeoutMs": 2000
  }
}
```

---

## Schema

Add:

```text
TracingConfig
```

to:

```text
src/config/schema.ts
```

The tracing section must have an explicit deep-merge arm in:

```text
src/config/loader.ts
```

because nested configuration would otherwise be replaced by a shallow top-level merge.

---

## Credential resolution

Both Langfuse keys use:

```text
cred://langfuse/publicKey
cred://langfuse/secretKey
```

and resolve through the existing credential-store mechanism.

Neither key may be resolved from environment variables.

The secret key is sensitive credential material.

The public key uses the same credential-store mechanism for consistency with the locked store-only tracing configuration.

No new credential resolution mechanism is introduced.

---

## Configuration surface

Do not expose SDK-specific tuning options such as:

```text
debug
flushIntervalMs
```

unless a concrete ALiX requirement emerges.

ALiX configuration should describe ALiX tracing semantics rather than reproduce the Langfuse SDK configuration surface.

The one SDK-adjacent option retained is:

```text
flushTimeoutMs
```

because it is required to enforce ALiX's bounded-flush contract.

---

# 10. Defaults

Tracing is disabled by default:

```text
enabled = false
```

When disabled:

* no Langfuse SDK client is constructed
* no credentials are resolved
* no network requests occur
* `NoopTraceClient` is used
* instrumentation remains present but has no tracing side effects

---

# 11. Failure & performance contract

This is a hard runtime invariant:

> **Tracing must never fail or materially block agent execution.**

A tracing failure must never:

* change the agent result
* fail an otherwise successful task
* crash the process
* indefinitely block a run
* become an uncaught exception

---

## Enqueue path

`startRun`, `startModelSpan`, `startToolSpan`, `endSpan`, and `endRun` must not perform network I/O.

They enqueue or update local SDK state only.

From the agent's perspective these operations are synchronous and cheap.

---

## Construction failure

Examples:

```text
invalid tracing configuration
invalid base URL
unresolvable credentials
SDK initialization failure
```

Behavior:

```text
construction failure
      ↓
warn once
      ↓
NoopTraceClient
      ↓
rest of process continues normally
```

---

## Runtime transport failure

Transient runtime failures should not automatically permanently disable tracing.

The Langfuse SDK remains responsible for its own:

* batching
* retry
* backoff
* transport behavior

If an individual batch ultimately fails, the tracing system records/warns according to the adapter policy and continues without affecting the agent.

Only an **irrecoverable SDK/client failure** should cause permanent process-level fallback to `NoopTraceClient`.

This prevents a temporary Langfuse outage from permanently disabling tracing for all subsequent runs.

---

# 12. Bounded flush

At run completion:

```text
endRun()
    ↓
flush()
```

The caller waits for at most:

```text
flushTimeoutMs
```

Default:

```text
2000ms
```

The contract is:

```text
flush completes
    → continue

flush rejects
    → warn/drop according to adapter policy
    → continue

flush exceeds timeout
    → stop awaiting
    → continue
```

The implementation must **not assume it can synchronously discard SDK-internal buffers**.

Instead, ALiX stops waiting after the timeout and preserves the agent's result.

Shutdown uses the same boundedness principle.

---

# 13. Seam wiring

There are three alternative top-level execution entry points.

They do not nest as independent trace roots.

```text
processTurn
runTask/runTaskCore
processChat
```

Each establishes the run identity before deep provider/tool instrumentation occurs.

---

# 14. Trace identity rule

The hard invariant is:

> **Exactly one Langfuse trace corresponds to exactly one ALiX `runId`.**

Therefore:

```text
ALiX runId
     ↓
one Langfuse trace
     ↓
all turns/model/tool spans for that run
```

Session grouping is metadata, not trace structure.

Trace metadata may include:

```text
sessionId
workflowId
```

allowing related runs to be grouped in Langfuse without incorrectly combining their traces.

---

# 15. `processTurn`

Location:

```text
src/agent/session.ts
```

approximately where the run ID is assigned.

The trace is created immediately after the `runId` exists.

Lifecycle:

```text
runId assigned
    ↓
startRun
    ↓
turn execution
    ↓
endRun
    ↓
bounded flush
```

Terminal handling must occur in the existing completion/failure/finally paths.

---

# 16. `runTask` / `runTaskCore`

Location:

```text
src/agent/agent-loop.ts
```

approximately where the `runId` is assigned.

The same lifecycle applies:

```text
runId assigned
    ↓
startRun
    ↓
agent execution
    ↓
endRun
    ↓
bounded flush
```

Existing task terminal states remain authoritative.

Tracing does not introduce a second task lifecycle.

---

# 17. `processChat`

Location:

```text
src/agent/session.ts
```

approximately the existing `processChat` implementation.

Chat currently has no native `runId`.

Therefore each `processChat` invocation synthesizes one:

```text
run-<uuid8>
```

using the same general run-ID scheme already used by other roots.

The synthetic ID is threaded through an `ExecutionContext` into provider requests so that deep model instrumentation can resolve the correct trace.

---

## Chat continuation invariant

A single `processChat` invocation, including continuation/re-prompt provider calls, has:

```text
one synthetic runId
        ↓
one Langfuse trace
```

For example:

```text
processChat
   │
   ├── provider call #1 → model span
   │
   └── continuation
          └── provider call #2 → model span
```

Both model spans belong to the same trace.

A continuation must never accidentally create a second trace.

---

# 18. Model spans

Instrumentation point:

```text
src/providers/provider-contract-validation.ts
```

inside:

```text
withProviderContracts
```

This is the single provider wrapper applied by `createProvider`.

It therefore provides broad coverage without instrumenting individual providers.

Coverage includes:

* normal completion
* streaming
* plan calls
* classifier calls
* chat calls
* retry calls
* free-route fallback calls

---

## Exactly-once model-span invariant

Every physical provider request produces exactly:

```text
1 provider request
→ 1 model span
```

Streaming does not create a span per chunk.

Instead:

```text
request starts
    ↓
one model span
    ↓
chunks arrive
    ↓
stream terminates
    ↓
span ends exactly once
```

Termination includes:

```text
success
error
cancellation
```

---

# 19. Model capture

Capture through `CapturePolicy`.

Potential fields:

```text
provider
model
resolvedModel
input/messages
output
reasoning
inputTokens
outputTokens
finishReason
invocationId
```

`reasoning` is captured only when:

```text
capture.reasoning != "off"
```

and still passes mandatory redaction.

---

# 20. Physical vs logical model calls

A single logical answer may require multiple physical provider requests.

Examples:

```text
logical answer
    ├── provider request #1
    └── provider request #2
```

Each physical request receives its own model span.

Correlation is maintained using:

```text
invocationId
```

or the existing normalized invocation identity.

Therefore:

```text
1 logical answer
    ↓
N physical provider requests
    ↓
N model spans
```

This accurately represents actual provider activity without falsely collapsing multiple network calls into one span.

---

# 21. Tool spans

Instrumentation point:

```text
src/tools/executor.ts
```

inside:

```text
ToolExecutor.execute
```

The span surrounds router execution.

---

## Exactly-once tool-span invariant

Every physical tool call produces exactly one terminal tool span.

This applies to:

```text
success
failure
timeout
cancellation
```

The terminal span is ended exactly once.

---

## Tool span attributes

Capture:

```text
toolName
capability
toolCallId
invocationId
executionId
durationMs
status
```

Arguments and output pass through `CapturePolicy`.

---

# 22. Parallel tool calls

Parallel tool calls are siblings:

```text
                 run trace
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
       tool A     tool B    tool C
```

They must not become parent/child merely because the scheduler happens to execute them in a particular order.

This preserves actual execution structure.

---

# 23. Subagent linkage

ALiX already has:

```text
parentRunId
```

The tracing facade owns translation of that relationship:

```text
ALiX parentRunId
       ↓
TraceClient
       ↓
Langfuse parent/trace relationship
```

Instrumentation layers never construct Langfuse-specific parent IDs.

The existing ALiX execution relationship remains authoritative.

---

# 24. Testing

Tests live under:

```text
tests/tracing/
```

using Vitest and existing repository test conventions.

---

## 24.1 CapturePolicy tests

Verify:

* `full`
* `truncated`
* `off`
* copies are returned
* caller-owned objects are not mutated
* message limits
* output limits
* mandatory redaction

---

## 24.2 Redaction-before-truncation test

Place a secret exactly at or around the truncation boundary.

Expected:

```text
raw
 ↓
secret detected
 ↓
<redacted>
 ↓
truncate
```

This validates the security-critical ordering.

---

## 24.3 Adapter tests

Inject a fake SDK.

Verify:

* trace creation
* `getRun(runId)` resolution (active → handle; unknown → null)
* model span creation
* tool span creation
* span completion
* run completion
* flush
* shutdown
* parent linkage

Also verify that no SDK types escape the facade.

---

## 24.4 Enabled wiring test

Run a representative agent execution with tracing enabled and a fake SDK.

Assert:

```text
exactly 1 trace
+ expected model spans
+ expected tool spans
+ correct run identity
+ correct session/workflow metadata
+ correct parent linkage
```

---

## 24.5 Disabled wiring test

With tracing disabled:

```text
NoopTraceClient
```

must be selected.

Assert:

```text
zero SDK construction
zero SDK calls
zero network activity
```

---

## 24.6 Misconfiguration/fail-open test

Test:

```text
bad URL
unresolvable credentials
SDK construction failure
```

Expected:

```text
warn once
→ NoopTraceClient
→ agent run remains successful
```

---

## 24.7 Exactly-once model span

Streaming test:

```text
1 provider request
+ N chunks
→ exactly 1 model span
```

Test both successful and failed streams.

---

## 24.8 Exactly-once tool span

Test:

```text
success
throw
timeout
cancellation
```

Each must produce exactly:

```text
1 terminal tool span
```

---

## 24.9 Flush timeout

Fake SDK:

```text
flush()
```

never resolves.

Expected:

```text
flush timeout
    ↓
agent continues
    ↓
agent result unchanged
```

This proves the bounded-flush contract.

---

## 24.10 Active-run lifecycle tests

Verify:

```text
startRun(runId)
startRun(runId)
```

does not create two traces.

Also:

```text
getRun(unknownRunId) → null
endRun(unknownRunId)
startModelSpan(unknownRunId)
startToolSpan(unknownRunId)
endSpan(alreadyEndedSpan)
endRun(alreadyEndedRun)
```

must all safely no-op.

---

## 24.11 Chat continuation test

Verify:

```text
processChat
    ├── provider call #1
    └── continuation provider call #2
```

produces:

```text
1 synthetic runId
1 Langfuse trace
2 model spans
```

not two traces.

---

# 25. Verification

Required verification:

```text
pnpm build
```

and:

```text
pnpm vitest run tests/tracing
```

must pass.

The implementation should additionally run the existing relevant provider, tool-executor, session, and agent-loop tests before finalization.

The full repository test suite should be run before merge.

---

# 26. Acceptance criteria

The implementation is complete when all of the following are true.

### Architecture

* [ ] Only the Langfuse adapter imports `langfuse`.
* [ ] Instrumentation seams depend only on `TraceClient`.
* [ ] `src/tracing/` does not introduce a second event/telemetry system.
* [ ] Existing ALiX runtime identities remain authoritative.

### Identity

* [ ] Every ALiX `runId` produces exactly one Langfuse trace.
* [ ] Turns do not create additional traces.
* [ ] Deep seams resolve their `TraceRun` via `getRun(runId)`; unknown runs yield no spans.
* [ ] Each `processChat` invocation has one synthetic run ID.
* [ ] Chat continuations reuse that ID.
* [ ] Parent/child relationships use existing ALiX `parentRunId`.

### Model tracing

* [ ] Every physical provider request produces one model span.
* [ ] Streaming produces one span regardless of chunk count.
* [ ] Retries/fallback physical requests each receive their own span.
* [ ] `invocationId` correlates related physical requests.

### Tool tracing

* [ ] Every physical tool call produces exactly one terminal span.
* [ ] Success/failure/timeout/cancellation are all represented.
* [ ] Parallel tool calls remain siblings.

### Security

* [ ] Capture policy returns copies.
* [ ] Redaction occurs before truncation.
* [ ] Mandatory redaction cannot be disabled.
* [ ] `full` capture still performs mandatory redaction.
* [ ] No environment-variable credential resolution exists in the tracing path.

### Reliability

* [ ] Tracing is disabled by default.
* [ ] Tracing initialization failure cannot fail an agent run.
* [ ] Transient SDK/network failures do not fail an agent run.
* [ ] Flush is bounded.
* [ ] A hanging flush cannot hang an agent run.
* [ ] Tracing errors never change the agent's result.

### Configuration

* [ ] `TracingConfig` is validated by the configuration schema.
* [ ] Nested tracing configuration is deep-merged.
* [ ] Credentials resolve through the existing `cred://` store.
* [ ] SDK-specific tuning options are not unnecessarily exposed.
* [ ] `flushTimeoutMs` enforces the boundedness contract.

### Regression

* [ ] Existing agent behavior remains unchanged when tracing is disabled.
* [ ] Existing provider behavior remains unchanged.
* [ ] Existing tool behavior remains unchanged.
* [ ] Existing execution/governance behavior remains unchanged.

---

# Non-goals

This change does **not** include:

* Langfuse evaluations
* Langfuse prompt management
* Langfuse-specific application logic outside the adapter
* a new telemetry/event store
* exporting ALiX's persisted telemetry wholesale
* replacing existing ALiX observability infrastructure
* environment-variable credential resolution
* changes to ALiX run identity
* changes to execution semantics
* changes to tool authorization or governance semantics

---

# Final architectural invariant

The implementation should preserve this boundary:

```text
                         ALiX
                           │
             ┌─────────────┴─────────────┐
             │                           │
       runtime identity             capture policy
             │                           │
             └─────────────┬─────────────┘
                           │
                           ▼
                     TraceClient
                           │
                           │ ALiX-owned
                           │ semantics
                           ▼
                  Langfuse adapter
                           │
                           │ provider-specific
                           ▼
                    Langfuse SDK
                           │
                           │ transport
                           ▼
                       Langfuse
```

The fundamental contract is:

> **ALiX owns what a trace means. Langfuse owns how that trace is transported.**

And the fundamental runtime guarantee is:

> **Tracing is observational only: it can enrich an execution, but it can never determine whether the execution succeeds or fails.**

This version is the one I would hand to the implementation agent. The remaining decisions are sufficiently explicit that implementation should now be **contract-driven rather than exploratory**.

