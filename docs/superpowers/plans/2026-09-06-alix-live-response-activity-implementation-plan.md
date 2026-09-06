# ALiX Live Response Activity & Long-Running Agent --- Implementation Plan

**Status:** Proposed\
**Execution style:** Incremental, test-first\
**Primary outcome:** Long-running agent calls with visible live-response
activity

## Phase 0 --- Locate the Existing Timeout

### Task 0.1 --- Find the 120-second boundary

Search the repository for:

``` text
120000
120_000
120s
timeout
setTimeout
Promise.race
AbortController
AbortSignal.timeout
withTimeout
agent call timed out
```

Trace the complete call chain.

Do not modify anything until the actual ownership of the timeout is
established.

### Task 0.2 --- Classify every timeout found

For each timeout record:

  -----------------------------------------------------------------------
  Timeout           Layer             Purpose           Keep?
  ----------------- ----------------- ----------------- -----------------
  Agent 120s        Agent/provider    Hard wall-clock   Remove
                    envelope          execution ceiling 

  HTTP connect      Transport         Connection        Keep
                                      establishment     

  HTTP idle         Transport         Dead connection   Review
                                      protection        

  Tool execution    Tool              Prevent runaway   Keep
                                      command           

  User cancellation Control           Explicit          Keep
                                      termination       
  -----------------------------------------------------------------------

The implementation must not remove unrelated safety boundaries.

------------------------------------------------------------------------

# Phase 1 --- Establish Runtime Activity Contract

## Task 1.1 --- Define activity state

Create or extend the existing runtime activity contract.

Preferred shape:

``` ts
type AgentActivityState =
  | "thinking"
  | "streaming"
  | "tool_running"
  | "waiting_for_provider"
  | "verifying"
  | "summarizing"
  | "possibly_stalled"
  | "completed"
  | "failed"
  | "cancelled";
```

Avoid creating duplicate representations if an existing execution-state
contract already has an appropriate seam.

## Task 1.2 --- Add activity metadata

Track:

``` text
invocationId
state
startedAt
lastProgressAt
operation
toolName
provider
model
```

Do not persist rapidly changing spinner frames.

------------------------------------------------------------------------

# Phase 2 --- Wire Activity to Existing Events

## Task 2.1 --- Invocation start

When an agent/model invocation begins:

``` text
THINKING
startedAt = now
lastProgressAt = now
```

The live response must receive this immediately.

## Task 2.2 --- Tool lifecycle

Map:

``` text
tool.requested
tool.started
```

to:

``` text
TOOL_RUNNING
```

with the tool name.

Map:

``` text
tool.completed
```

back to:

``` text
THINKING
```

unless the agent is already streaming.

## Task 2.3 --- Model streaming

On the first visible response chunk:

``` text
THINKING → STREAMING
```

The transient indicator should be removed/replaced by the response
stream.

Every accepted response chunk updates:

``` text
lastProgressAt
```

## Task 2.4 --- Agent phase transitions

Use existing phase events where appropriate:

``` text
Verifying → VERIFYING
Summarizing → SUMMARIZING
```

Do not expose internal implementation phases unnecessarily.

------------------------------------------------------------------------

# Phase 3 --- Live Response Renderer

## Task 3.1 --- Add transient activity rendering

The response view needs an activity element that can exist before
response content.

Example:

``` text
ALiX
  ◐ Thinking… 4s
```

## Task 3.2 --- Add elapsed timer

Calculate elapsed time locally:

``` text
now - startedAt
```

Refresh approximately once per second.

Do not emit one runtime event per second.

## Task 3.3 --- Add spinner animation

Implement animation entirely in the presentation layer.

The spinner must not affect:

-   event logs;
-   token accounting;
-   provider requests;
-   agent iterations.

## Task 3.4 --- Tool presentation

Render:

``` text
⚙ Running shell.run… 3s
```

and optionally show the existing tool preview.

## Task 3.5 --- Completion cleanup

On the first streamed response token:

``` text
remove activity indicator
```

On completion without visible response text, render the existing
completion semantics rather than leaving a permanent spinner.

------------------------------------------------------------------------

# Phase 4 --- Remove Agent-Level 120s Deadline

## Task 4.1 --- Remove only the outer hard deadline

Replace the current unconditional 120-second agent-call timeout.

Do not simply increase it.

Bad:

``` text
timeout(600000)
```

Desired:

``` text
agent invocation
    controlled by cancellation
    observed by watchdog
    bounded by explicit policy only when configured
```

## Task 4.2 --- Preserve transport safety

Verify provider adapters still have appropriate:

-   connection timeout;
-   DNS timeout;
-   TLS timeout;
-   request cancellation;
-   stream failure handling.

The agent lifetime should not dictate transport lifetime.

## Task 4.3 --- Preserve tool safety

Do not remove command/tool-specific limits.

A long-running model call and an indefinitely running shell command are
different risks.

------------------------------------------------------------------------

# Phase 5 --- Liveness Watchdog

## Task 5.1 --- Create watchdog

The watchdog observes:

``` text
lastProgressAt
```

and relevant runtime state.

It should periodically evaluate:

``` text
now - lastProgressAt
```

## Task 5.2 --- Warning transition

When policy threshold is exceeded:

``` text
THINKING → POSSIBLY_STALLED
```

The invocation continues.

The live response changes to something like:

``` text
ALiX
  … Still working — 3m 42s
```

Avoid alarming language until the runtime has stronger evidence of
failure.

## Task 5.3 --- Recovery

If progress resumes:

``` text
POSSIBLY_STALLED → THINKING
```

or:

``` text
POSSIBLY_STALLED → STREAMING
```

No error should be emitted merely because the warning occurred.

------------------------------------------------------------------------

# Phase 6 --- Cancellation

## Task 6.1 --- Ensure a shared cancellation token

The agent invocation must expose a cancellation mechanism propagated to:

``` text
agent loop
model provider
stream
current tool
child tasks
```

## Task 6.2 --- Live cancellation state

Render:

``` text
Cancelling…
```

while cancellation propagates.

Then:

``` text
Cancelled after 4m 12s
```

## Task 6.3 --- Distinguish cancellation from timeout

Never report:

``` text
agent call timed out
```

when the user explicitly cancelled.

------------------------------------------------------------------------

# Phase 7 --- Tests

## Test 7.1 --- Long model call

Fake provider waits 125 seconds before returning.

Expected:

``` text
agent remains active
Thinking… remains visible
no timeout
```

Use a fake clock or controllable promise; do not make the test actually
wait 125 seconds.

## Test 7.2 --- Long streaming generation

Fake provider emits chunks over a duration greater than 120 seconds.

Expected:

``` text
no agent timeout
lastProgressAt advances
activity transitions to STREAMING
```

## Test 7.3 --- Silent model processing

Fake provider remains active without visible response text.

Expected:

``` text
Thinking…
```

continues indefinitely until completion/cancellation.

## Test 7.4 --- Stall warning

Freeze provider progress beyond the configured watchdog threshold.

Expected:

``` text
POSSIBLY_STALLED
```

but:

``` text
invocation still alive
```

## Test 7.5 --- Recovery from stall

Resume provider progress.

Expected:

``` text
POSSIBLY_STALLED → THINKING/STREAMING
```

## Test 7.6 --- Tool activity

Emit:

``` text
tool.requested
tool.started
tool.completed
```

Expected:

``` text
Thinking → Running tool → Thinking
```

## Test 7.7 --- Cancellation

Start an indefinitely waiting provider and cancel the invocation.

Expected:

``` text
Cancelling → Cancelled
```

## Test 7.8 --- Provider failure

Reject the provider request.

Expected:

``` text
Thinking → Failed
```

not:

``` text
Possibly stalled
```

## Test 7.9 --- Existing short response regression

A normal fast response should continue to behave exactly as before.

## Test 7.10 --- Spinner isolation

Verify that animation produces no runtime/event-log/token-count
activity.

------------------------------------------------------------------------

# Phase 8 --- Integration Verification

Run the actual stress test again.

The important expected behavior is:

``` text
ALiX
  ◐ Thinking… 1s

ALiX
  ◐ Thinking… 30s

ALiX
  ◐ Thinking… 1m 30s

ALiX
  ◐ Thinking… 2m 01s

ALiX
  ◐ Thinking… 2m 30s

ALiX
  <streamed five-part response begins>
```

The critical assertion is:

> Crossing 120 seconds must no longer terminate the invocation.

Then test an intentionally broken provider to verify that the watchdog
can report lack of progress without silently hanging forever.

------------------------------------------------------------------------

# Phase 9 --- Observability

Add/verify:

``` text
agent_activity_state
agent_activity_duration_ms
agent_last_progress_age_ms
agent_stall_warning_total
agent_invocation_cancelled_total
agent_invocation_failed_total
```

The existing `model.usage` events should continue providing token
accounting.

The activity subsystem must not duplicate token accounting.

------------------------------------------------------------------------

# Phase 10 --- Acceptance Gate

The implementation is ready when all of the following are true:

-   [ ] The exact 120-second agent-level timeout has been identified.
-   [ ] Only the agent-level hard deadline has been removed.
-   [ ] Transport-level safety remains.
-   [ ] Tool-specific limits remain.
-   [ ] Cancellation works.
-   [ ] Live response immediately shows `Thinking…`.
-   [ ] Elapsed time is visible.
-   [ ] Tool execution is visible in the response surface.
-   [ ] Streaming replaces the transient activity indicator.
-   [ ] No private reasoning content is displayed.
-   [ ] Watchdog detects inactivity without terminating the invocation.
-   [ ] Watchdog state recovers when progress resumes.
-   [ ] Long-running fake-provider tests exceed the old 120s boundary
    without real-time waits.
-   [ ] The full stress test completes beyond 120 seconds.
-   [ ] Existing short-response behavior passes regression tests.
-   [ ] No unbounded event or output buffering was introduced.

## Final Architecture

``` text
                         USER
                          │
                          ▼
                 ┌─────────────────┐
                 │  Live Response  │
                 │                 │
                 │ ◐ Thinking…    │
                 │ ⚙ tool…        │
                 │ streamed text  │
                 └────────┬────────┘
                          ▲
                          │ activity/events
                          │
                 ┌────────┴────────┐
                 │  Agent Runtime  │
                 │                 │
                 │ execution       │
                 │ cancellation    │
                 │ state           │
                 └───────┬─────────┘
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
          Provider      Tools     Watchdog
             │                       │
             │                       │
             └────── progress ───────┘

       NO FIXED 120s AGENT DEADLINE
                    │
                    ▼
       long execution remains valid
                    │
                    ▼
       watchdog detects inactivity
                    │
                    ▼
       user sees "Still working…"
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
       progress             actual
       resumes              failure
          │                   │
          ▼                   ▼
      continue              fail
```

## Architectural Rule to Lock

> **ALiX must never use an arbitrary wall-clock deadline as a proxy for
> agent liveness. Execution may be long-running; liveness is determined
> from runtime progress, and cancellation/failure are separate terminal
> mechanisms.**
