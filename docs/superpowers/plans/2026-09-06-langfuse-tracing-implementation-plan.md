Yes. Based on the approved design, I’d make the implementation plan **task-oriented, dependency-ordered, and test-gated**, with no architectural decisions left for the implementer to invent.

# Langfuse Tracing for ALiX — Implementation Plan

**Date:** 2026-09-06
**Status:** Ready for implementation
**Design:** `2026-09-06-langfuse-tracing-design.md`

---

## Goal

Instrument ALiX with Langfuse using the official `langfuse` v3 SDK behind an ALiX-owned `TraceClient` facade.

The implementation must provide:

* exactly one Langfuse trace per ALiX `runId`
* model spans at `withProviderContracts`
* tool spans at `ToolExecutor.execute`
* parent/subagent linkage through existing `parentRunId`
* uniform tracing for task execution and chat
* mandatory secret redaction before truncation
* disabled-by-default behavior
* fail-open tracing
* bounded flush
* zero Langfuse knowledge in runtime instrumentation seams
* no second telemetry/event system

---

# Implementation Rules

Before starting:

1. Treat the approved design as the architectural contract.
2. Do not redesign the tracing architecture during implementation.
3. Do not introduce direct Langfuse imports into runtime seams.
4. Do not introduce a second run identity.
5. Do not introduce a second telemetry/event store.
6. Do not alter agent success/failure semantics because of tracing.
7. Preserve existing runtime/provider/tool behavior when tracing is disabled.
8. Follow existing repository conventions for configuration, logging, dependency injection, errors, and tests.
9. If the repository contradicts the design, stop and surface the contradiction rather than silently changing the contract.

---

# Task 1 — Repository Reconnaissance

**Objective:** Establish the exact integration points before writing implementation code.

### Inspect

* `package.json`
* package manager configuration
* configuration schema/types
* configuration loader/deep-merge implementation
* credential-store resolution
* `src/agent/session.ts`
* `src/agent/agent-loop.ts`
* `src/providers/provider-contract-validation.ts`
* `src/tools/executor.ts`
* existing `ExecutionContext` definitions
* existing `runId`, `parentRunId`, `invocationId`, `toolCallId`, and `executionId` types
* existing logging/warn-once utilities
* existing shutdown lifecycle
* existing test conventions

### Confirm

Determine:

* exact run-ID assignment locations
* exact terminal paths for `processTurn`
* exact terminal paths for `runTask`/`runTaskCore`
* exact `processChat` continuation behavior
* how `ExecutionContext` is propagated into provider calls
* how tool execution identifies calls
* how streaming provider calls are represented
* how configuration is constructed
* how credentials are resolved
* how application shutdown is currently handled

### Deliverable

No production code changes should be required for this task.

Produce a short implementation note in the task/PR describing the discovered seams and any deviations from the design.

### Gate

Do not proceed until the following are confirmed:

```text
run roots
provider wrapper
tool executor
execution context propagation
configuration loader
credential resolution
shutdown lifecycle
```

---

# Task 2 — Add Langfuse Dependency

**Objective:** Introduce the official Langfuse SDK without leaking it into the application.

### Changes

Add the approved `langfuse` v3 dependency to the project.

Use the repository's existing package-manager workflow.

### Rules

* Do not use a hand-rolled HTTP client.
* Do not introduce a second tracing dependency.
* Do not import the SDK outside the adapter boundary.

### Verification

Confirm the dependency resolves and the project still builds.

```bash
pnpm build
```

### Acceptance

The dependency is installed, but no runtime behavior has changed yet.

---

# Task 3 — Create Tracing Module Boundary

**Objective:** Establish the ALiX tracing abstraction before wiring runtime seams.

### Create

```text
src/tracing/
```

and:

```text
src/tracing/AGENTS.md
```

Create the core modules according to repository conventions, approximately:

```text
src/tracing/
├── AGENTS.md
├── types.ts
├── client.ts
├── noop-client.ts
├── capture.ts
├── config.ts
└── langfuse-client.ts
```

Exact decomposition may follow existing project style.

### `TraceClient`

Implement the approved interface:

```ts
interface TraceClient {
  startRun(input: TraceRunInput): TraceRun;

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

### Rules

* ALiX-shaped input types.
* Opaque run/span handles.
* No Langfuse types in the public tracing interface.
* No provider-specific types in the facade.
* No network operations from span/run lifecycle methods.

### Acceptance

The module compiles independently and establishes the intended dependency direction.

---

# Task 4 — Implement NoopTraceClient

**Objective:** Make disabled tracing completely inert.

### Implement

`NoopTraceClient`.

It must support the entire `TraceClient` interface.

Behavior:

```text
startRun          → noop handle
startModelSpan    → noop handle
startToolSpan     → noop handle
endSpan           → no-op
endRun            → no-op
flush             → resolved Promise
shutdown          → resolved Promise
```

### Acceptance

With tracing disabled:

* no Langfuse SDK is imported at runtime through initialization
* no credentials are resolved
* no network requests occur
* instrumentation can execute normally

---

# Task 5 — Implement CapturePolicy

**Objective:** Implement ALiX-owned capture, redaction, and truncation semantics.

### Implement

Pure capture-policy functions.

Required levels:

```text
full
truncated
off
```

### Pipeline

Implement exactly:

```text
raw
 ↓
mandatory redaction
 ↓
truncation
 ↓
capture
```

### Redaction

Cover the initial patterns from the design:

* `sk-` / `pk-` style secrets
* `api_key`
* `api-key`
* `apikey`
* `Authorization`
* `Bearer`
* `cred://`
* PEM blocks
* known OpenAI/Langfuse-style prefixes

Replace detected secrets with:

```text
<redacted>
```

### Important

`full` means:

> full value after mandatory redaction

It must never bypass redaction.

### Immutability

Do not mutate:

* message arrays
* tool arguments
* provider response objects
* tool outputs
* caller-owned nested structures

### Tests

Add tests for:

* full capture
* truncated capture
* off
* maximum lengths
* redaction
* redaction before truncation
* copy semantics
* `full` still redacts

### Acceptance

The capture policy is independently testable and has no Langfuse dependency.

---

# Task 6 — Add Tracing Configuration

**Objective:** Add the approved configuration contract.

### Add

```text
TracingConfig
```

with:

```json
{
  "enabled": false,
  "langfuse": {
    "baseUrl": "...",
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
```

### Schema

Update the existing configuration schema.

### Loader

Add the required nested/deep merge arm.

Do not accidentally replace the entire `tracing` object when only one nested value is overridden.

### Credential handling

Resolve:

```text
cred://langfuse/publicKey
cred://langfuse/secretKey
```

through the existing credential mechanism.

Do not introduce environment-variable lookup.

### Validation

Validate:

* enabled boolean
* valid capture modes
* sensible non-negative limits
* positive bounded flush timeout
* valid Langfuse URL where tracing is enabled

### Acceptance

Existing configuration remains valid and tracing defaults to disabled.

---

# Task 7 — Implement Langfuse Adapter

**Objective:** Translate the ALiX tracing contract into Langfuse SDK operations.

This is the **only implementation allowed to import `langfuse`**.

### Responsibilities

The adapter owns:

* SDK construction
* Langfuse trace creation
* Langfuse span/generation creation
* SDK-specific metadata translation
* parent relationship translation
* flushing
* shutdown
* SDK-specific error handling

### It must not own

* ALiX run identity
* execution lifecycle
* authorization
* tool semantics
* provider semantics
* capture policy semantics

---

## Active-run registry

Maintain:

```text
Map<runId, TraceRun>
```

### `startRun`

If no active run exists:

```text
create trace
register run
return handle
```

If one already exists:

```text
return existing run
```

Never create a duplicate trace for the same active `runId`.

### `endRun`

If already ended or unknown:

```text
no-op
```

Otherwise:

```text
finish trace
remove from active registry
```

---

## Unknown run behavior

If model/tool instrumentation arrives without a known run:

```text
startModelSpan(unknown)
→ noop span

startToolSpan(unknown)
→ noop span
```

This protects the runtime from ordering/race issues.

---

## Span idempotency

A span must have terminal state.

Repeated:

```text
endSpan(span)
```

must not create multiple terminal operations.

---

# Task 8 — Implement Parent-Run Translation

**Objective:** Translate existing ALiX subagent relationships into Langfuse relationships.

### Input

Existing:

```text
parentRunId
```

### Behavior

The facade/adapter resolves the parent relationship and supplies the appropriate Langfuse parent/trace relationship.

### Rules

* Do not create a new ALiX parent identity.
* Do not make instrumentation seams Langfuse-aware.
* Do not infer parentage from call order.
* Use explicit existing `parentRunId`.

### Test

Create:

```text
parent run
    ↓
child run
```

and assert that the child is associated with the correct parent relationship.

---

# Task 9 — Implement Tracing Client Factory / Runtime Selection

**Objective:** Select the tracing implementation once at application construction.

### Behavior

```text
tracing.enabled = false
    ↓
NoopTraceClient

tracing.enabled = true
    ↓
LangfuseTraceClient
```

### Initialization failure

If configuration, credentials, SDK construction, or client initialization fails:

```text
warn once
↓
NoopTraceClient
```

The application continues.

### Runtime failure

Transient SDK/network failures should be handled by the SDK's retry/batching mechanisms.

Do not permanently disable tracing for a transient transport error.

Only an irrecoverable/fatal client state should trigger process-level Noop fallback.

### Acceptance

The rest of ALiX receives only:

```ts
TraceClient
```

and never performs configuration branching.

---

# Task 10 — Wire Root Run Tracing

**Objective:** Establish exactly one root trace for each execution.

## `processTurn`

At the existing run-ID assignment point:

```text
runId assigned
    ↓
startRun
```

Thread the trace lifecycle through the existing terminal paths.

Ensure:

```text
normal completion
error
cancellation
```

all call `endRun` exactly once.

---

## `runTask` / `runTaskCore`

At the existing run-ID assignment:

```text
runId assigned
    ↓
startRun
```

Ensure every terminal path ends the trace exactly once.

---

## `processChat`

Because `processChat` lacks a native run ID:

```text
run-<uuid8>
```

is generated per invocation.

Thread the synthetic run ID through the existing execution context.

### Critical invariant

One `processChat` invocation:

```text
provider request #1
provider request #2
continuation
retry
```

must all remain under:

```text
one synthetic runId
one trace
```

### Acceptance

No root execution path creates more than one trace for a single logical run.

---

# Task 11 — Wire Model Spans

**Objective:** Instrument all physical provider requests at the central provider wrapper.

### Location

```text
src/providers/provider-contract-validation.ts
```

at:

```text
withProviderContracts
```

### Start

Immediately before the physical provider request.

### End

When the physical request terminates.

### Capture

Capture normalized:

* provider
* model
* resolved model
* input/messages
* output
* reasoning where enabled
* input tokens
* output tokens
* finish reason
* invocation ID

All captured payloads pass through `CapturePolicy`.

---

## Streaming

Do not create a span per chunk.

Required:

```text
one provider request
→ one model span
```

The span remains active until:

* successful stream completion
* stream failure
* cancellation

### Retries/fallbacks

Each physical provider request gets its own model span.

Example:

```text
logical invocation
    ├── provider request A → span A
    └── fallback request B → span B
```

Use existing `invocationId` for correlation.

---

# Task 12 — Wire Tool Spans

**Objective:** Instrument tool execution at the single tool executor seam.

### Location

```text
src/tools/executor.ts
```

at:

```text
ToolExecutor.execute
```

### Span start

Immediately around the actual tool execution.

### Capture

* tool name
* capability
* tool call ID
* invocation ID
* execution ID
* arguments
* output
* duration
* terminal status

Arguments and output must pass through `CapturePolicy`.

---

## Terminal behavior

Exactly one terminal span for:

```text
success
throw
timeout
cancellation
```

Use `try/catch/finally` or equivalent lifecycle-safe structure without changing existing tool error semantics.

### Parallel execution

Parallel tool calls must become sibling spans.

Do not infer parent/child relationships from execution order.

---

# Task 13 — Implement Bounded Flush

**Objective:** Ensure tracing never hangs an ALiX execution.

### Run completion

At the root terminal path:

```text
endRun()
↓
bounded flush
```

### Timeout

Use:

```text
flushTimeoutMs
```

Default:

```text
2000ms
```

### Required semantics

```text
flush resolves
    → continue

flush rejects
    → warn according to policy
    → continue

flush exceeds timeout
    → stop awaiting
    → continue
```

Do not synchronously attempt to discard SDK buffers.

The timeout means:

> ALiX stops awaiting tracing transport and continues execution.

The SDK may retain internal state according to its own lifecycle.

### Acceptance

A permanently hanging SDK flush cannot hang the agent.

---

# Task 14 — Implement Shutdown

**Objective:** Provide clean process shutdown without making shutdown tracing-critical.

### Implement

```ts
shutdown(): Promise<void>
```

in the tracing client.

### Shutdown behavior

* close/finalize tracing resources
* perform final bounded flush where appropriate
* never block indefinitely
* never crash the process because tracing failed

### Ordering

Integrate into the existing application shutdown lifecycle rather than creating a separate process lifecycle.

---

# Task 15 — Add Lifecycle and Fail-Open Tests

**Objective:** Verify the facade's defensive behavior.

### Test

```text
startRun(runId)
startRun(runId)
```

Expected:

```text
one trace
```

### Test

```text
endRun(unknown)
```

Expected:

```text
no-op
```

### Test

```text
startModelSpan(unknown)
startToolSpan(unknown)
```

Expected:

```text
noop spans
```

### Test

```text
endSpan(alreadyEnded)
endRun(alreadyEnded)
```

Expected:

```text
no-op
```

### Failure tests

Test:

* SDK construction failure
* invalid configuration
* credential resolution failure
* transient transport failure
* fatal SDK failure
* hanging flush
* rejected flush

Verify that none changes the agent outcome.

---

# Task 16 — Add End-to-End Trace Wiring Tests

**Objective:** Prove the architecture at runtime rather than only testing individual classes.

Use a fake Langfuse SDK/adapter.

### Scenario

Execute a representative run containing:

```text
root run
    ↓
model request
    ↓
tool call
    ↓
model request
```

Expected:

```text
1 trace
2 model spans
1 tool span
```

All belong to the same trace.

Verify:

* `runId`
* session metadata
* workflow metadata
* invocation IDs
* tool call ID
* execution ID
* capture policy
* parent linkage

---

# Task 17 — Add Streaming Exactly-Once Test

**Objective:** Protect the most likely model-span duplication regression.

Simulate:

```text
request
chunk 1
chunk 2
chunk 3
completion
```

Expected:

```text
1 model span
```

Then simulate:

```text
request
chunk 1
chunk 2
error
```

Expected:

```text
1 terminal model span
```

Then cancellation:

```text
request
chunk 1
cancel
```

Expected:

```text
1 terminal model span
```

---

# Task 18 — Add Tool Exactly-Once Tests

Test four paths:

```text
successful tool
throwing tool
timed-out tool
cancelled tool
```

Each must produce:

```text
exactly one terminal tool span
```

The underlying tool result/error must remain unchanged.

---

# Task 19 — Add Chat Continuation Test

**Objective:** Protect synthetic chat run identity.

Simulate:

```text
processChat
    ↓
provider call #1
    ↓
continuation
    ↓
provider call #2
```

Assert:

```text
one synthetic runId
one Langfuse trace
two model spans
```

Also verify that the continuation did not accidentally call `startRun` with a new ID.

---

# Task 20 — Add Disabled/Misconfigured Regression Tests

### Disabled

Verify:

```text
enabled=false
```

results in:

```text
NoopTraceClient
```

and:

```text
zero SDK construction
zero credential resolution
zero tracing network activity
```

### Misconfigured

Verify:

```text
enabled=true
bad credentials/config
```

results in:

```text
warning
NoopTraceClient
agent continues
```

---

# Task 21 — Add Configuration Tests

Test:

* defaults
* nested configuration
* deep merge
* invalid capture levels
* invalid limits
* flush timeout
* credential references
* disabled behavior

Specifically verify that:

```text
tracing.capture.messages
```

can be overridden without deleting:

```text
tracing.langfuse
tracing.capture.toolOutput
tracing.flushTimeoutMs
```

---

# Task 22 — Add Boundary/Architecture Test

**Objective:** Prevent accidental Langfuse coupling.

Search the source tree and assert that runtime code does not directly import Langfuse.

Expected only:

```text
src/tracing/langfuse-client.ts
```

or the chosen adapter file.

No imports from:

```text
langfuse
```

should exist in:

```text
src/agent/
src/providers/
src/tools/
```

except through the tracing facade.

This is primarily an architectural regression check.

---

# Task 23 — Documentation

Update:

```text
src/tracing/AGENTS.md
```

with:

* module purpose
* dependency boundary
* `TraceClient` contract
* one-run/one-trace invariant
* model/tool seam locations
* capture/redaction rules
* failure semantics
* bounded flush semantics
* prohibition on direct Langfuse imports outside adapter

Add configuration documentation according to the repository's existing configuration-documentation conventions.

Do not document unsupported SDK options.

---

# Task 24 — Full Verification

Run focused tests first:

```bash
pnpm vitest run tests/tracing
```

Then run affected tests for:

```text
agent/session
agent-loop
provider contracts
tool executor
configuration
```

Then:

```bash
pnpm build
```

Then the full repository test suite.

---

# Task 25 — Final Architectural Review

Before merge, perform a final source review specifically for taxonomy and boundary violations.

### Verify

#### Langfuse isolation

```text
Only adapter imports Langfuse.
```

#### Identity

```text
ALiX runId remains authoritative.
```

#### Trace cardinality

```text
one runId → one trace
```

#### Model cardinality

```text
one physical provider request → one model span
```

#### Tool cardinality

```text
one physical tool call → one tool span
```

#### Chat

```text
one processChat invocation → one synthetic runId → one trace
```

#### Security

```text
redaction → truncation → capture
```

#### Reliability

```text
tracing failure ≠ agent failure
```

#### Flush

```text
bounded wait
```

#### Configuration

```text
disabled by default
store-only credentials
```

#### Architecture

```text
ALiX seams
    ↓
TraceClient
    ↓
Langfuse adapter
    ↓
Langfuse SDK
```

---

# Implementation Order

The recommended execution order is:

```text
T1  Repository reconnaissance
 ↓
T2  Langfuse dependency
 ↓
T3  Tracing module boundary
 ↓
T4  Noop client
 ↓
T5  Capture policy
 ↓
T6  Configuration
 ↓
T7  Langfuse adapter
 ↓
T8  Parent linkage
 ↓
T9  Runtime client factory
 ↓
T10 Root run wiring
 ↓
T11 Model spans
 ↓
T12 Tool spans
 ↓
T13 Bounded flush
 ↓
T14 Shutdown
 ↓
T15 Lifecycle tests
 ↓
T16 E2E trace test
 ↓
T17 Streaming tests
 ↓
T18 Tool terminal tests
 ↓
T19 Chat continuation test
 ↓
T20 Disabled/fail-open tests
 ↓
T21 Configuration tests
 ↓
T22 Architecture boundary test
 ↓
T23 Documentation
 ↓
T24 Full verification
 ↓
T25 Final architectural review
```

---

# Commit/PR Boundaries

If the implementation workflow uses incremental commits, prefer these logical boundaries:

### Commit 1 — Tracing foundation

```text
dependency
tracing types
TraceClient
NoopTraceClient
module boundary
```

### Commit 2 — Capture & configuration

```text
CapturePolicy
redaction
configuration schema
loader
credential resolution
```

### Commit 3 — Langfuse adapter

```text
SDK integration
active-run registry
span lifecycle
parent linkage
factory
```

### Commit 4 — Runtime instrumentation

```text
run roots
processChat
provider model spans
tool spans
flush/shutdown
```

### Commit 5 — Tests & documentation

```text
unit tests
integration tests
failure tests
architecture tests
AGENTS.md
configuration docs
```

The exact commit strategy may follow the repository's existing contribution workflow.

---

# Definition of Done

The implementation is ready for merge only when:

* [ ] `TraceClient` is the only tracing API exposed to ALiX runtime seams.
* [ ] Only the Langfuse adapter imports `langfuse`.
* [ ] Tracing defaults to disabled.
* [ ] Disabled tracing creates no SDK client.
* [ ] Credentials use `cred://`.
* [ ] Capture policy is ALiX-owned.
* [ ] Redaction happens before truncation.
* [ ] `full` capture remains redacted.
* [ ] One ALiX `runId` produces one trace.
* [ ] `processChat` gets one synthetic run ID per invocation.
* [ ] Chat continuation stays on the same trace.
* [ ] Provider requests produce exactly one model span each.
* [ ] Streaming produces exactly one model span.
* [ ] Retries/fallback physical requests each produce their own span.
* [ ] Tool calls produce exactly one terminal tool span.
* [ ] Tool success/error/timeout/cancellation are covered.
* [ ] Parallel tools are siblings.
* [ ] Parent runs map through existing `parentRunId`.
* [ ] Duplicate `startRun` does not create duplicate traces.
* [ ] Unknown lifecycle operations are safe no-ops.
* [ ] Transient tracing failures do not fail agent execution.
* [ ] Fatal initialization failure falls back to Noop.
* [ ] Flush is bounded.
* [ ] Hanging flush cannot hang an agent run.
* [ ] Shutdown is bounded/fail-open.
* [ ] Configuration deep merge works.
* [ ] Focused tests pass.
* [ ] Affected tests pass.
* [ ] Full test suite passes.
* [ ] `pnpm build` passes.
* [ ] No architectural boundary violations remain.

---

# Final Invariants

The implementation must preserve these invariants throughout:

```text
┌──────────────────────────────────────────────────────┐
│                    ALiX EXECUTION                    │
│                                                      │
│  runId ────────────────────────────────┐             │
│                                        │             │
│  ┌───────────────┐                     │             │
│  │ Model request │ → model span        │             │
│  └───────────────┘                     │             │
│                                        │             │
│  ┌───────────────┐                     │             │
│  │ Tool call     │ → tool span         │             │
│  └───────────────┘                     │             │
│                                        │             │
│  ┌───────────────┐                     │             │
│  │ Model request │ → model span        │             │
│  └───────────────┘                     │             │
│                                        │             │
└────────────────────────────────────────┼─────────────┘
                                         │
                                         ▼
                                  TraceClient
                                         │
                                         ▼
                                Langfuse adapter
                                         │
                                         ▼
                                  Langfuse SDK
```

### Cardinality

```text
1 ALiX runId
      ↓
1 trace

1 physical model request
      ↓
1 model span

1 physical tool invocation
      ↓
1 tool span
```

### Security

```text
raw
 ↓
mandatory redaction
 ↓
truncation
 ↓
Langfuse
```

### Reliability

```text
Langfuse unavailable
        ↓
ALiX continues

Langfuse slow
        ↓
bounded flush
        ↓
ALiX continues

Langfuse broken
        ↓
Noop/fail-open
        ↓
ALiX continues
```

### Dependency boundary

```text
ALiX runtime
     │
     │ TraceClient only
     ▼
Tracing abstraction
     │
     ▼
Langfuse adapter
     │
     │ only SDK import
     ▼
Langfuse SDK
```

The implementation should therefore be judged primarily against **trace cardinality, seam coverage, lifecycle correctness, data minimization, provider isolation, and fail-open behavior**—not merely whether Langfuse receives events.

I would use **`2026-09-06-langfuse-tracing-implementation-plan.md`** as the plan filename, matching the design's date-prefix convention.
