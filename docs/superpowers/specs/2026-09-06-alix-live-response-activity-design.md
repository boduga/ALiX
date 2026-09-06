# ALiX Live Response Activity & Long-Running Agent Design

**Status:** Proposed\
**Date:** 2026-09-06\
**Scope:** Agent live-response UX, provider-call liveness, and removal
of the arbitrary 120-second wall-clock timeout

## 1. Executive Decision

ALiX should remove the fixed 120-second wall-clock timeout from the
agent/provider execution path. A long-running agent invocation is not
inherently a failure: model inference, provider queueing, reasoning,
large generations, remote tool execution, and multi-step workflows can
legitimately exceed two minutes.

Instead, ALiX should separate three concerns:

1.  **Execution lifetime** --- how long an agent invocation is allowed
    to remain alive.
2.  **Activity reporting** --- what the user sees in the live response
    while the invocation is active.
3.  **Liveness detection** --- whether the runtime is still making
    progress or has become unresponsive.

The live response must immediately display an activity indicator when
the agent begins work. This indicator belongs in the
conversation/live-response surface, not merely in the TUI status bar.

Example:

``` text
You: <request>

ALiX
  ◐ Thinking… 18s
```

When a tool is active:

``` text
ALiX
  ⚙ Running shell.run… 3s
```

When the model is waiting without visible output:

``` text
ALiX
  ◐ Thinking… 2m 14s
```

When actual response tokens arrive, the transient activity indicator
transitions into the streamed response.

The central invariant is:

> **No response timeout may be used as the liveness mechanism.**

A watchdog may detect and report suspected stalls, but it must not
automatically terminate a healthy long-running invocation merely because
a wall-clock duration was exceeded.

------------------------------------------------------------------------

## 2. Problem Statement

The stress-test run demonstrated two separate limits.

The first limit was an output-token issue: the response previously
stopped at approximately 2,648 characters / 512 tokens and was
subsequently corrected, producing approximately 33,755 characters
containing the complete five-part response.

The second failure occurred after that correction:

``` text
agent error: agent call timed out after 120000ms
```

This indicates that the system can now permit the model to generate the
requested large response, but the enclosing agent/provider call still
has a hard two-minute wall-clock boundary.

That creates an architectural contradiction:

-   The model execution path is capable of sustained generation.
-   The user has no visible indication in the live response that the
    agent is still working.
-   The outer call eventually kills the invocation solely because
    elapsed time crossed 120 seconds.

The correct fix is not to replace 120 seconds with a larger arbitrary
number such as 5, 10, or 30 minutes.

The correct fix is to make execution duration independent of liveness
and add explicit progress/activity observability.

------------------------------------------------------------------------

## 3. Goals

### Primary goals

-   Remove the fixed 120-second agent/provider wall-clock timeout.
-   Allow legitimate long-running model calls and agent workflows.
-   Show immediate activity in the live response.
-   Show elapsed activity duration.
-   Represent model thinking/waiting without exposing private
    chain-of-thought.
-   Represent active tool execution.
-   Transition cleanly from activity state to streamed response.
-   Detect probable stalls independently of execution lifetime.
-   Preserve existing agent phase semantics.
-   Avoid requiring the user to watch a separate TUI status bar.

### Secondary goals

-   Make long-running executions feel responsive.
-   Make provider stalls diagnosable.
-   Provide machine-readable activity state for future observability.
-   Support future cancellation by the user without conflating
    cancellation with timeout.

### Non-goals

-   Exposing model chain-of-thought.
-   Automatically killing a call because no visible text was emitted.
-   Replacing the existing execution/event architecture.
-   Adding a second independent state machine unrelated to runtime
    events.
-   Making every provider call literally immortal with no cancellation
    mechanism.

------------------------------------------------------------------------

## 4. Design Principles

### 4.1 Lifetime is not liveness

A process can be healthy after two minutes.

A process can also be hung after ten seconds.

Therefore:

``` text
elapsed time ≠ failure
```

Instead:

``` text
elapsed time + absence of expected progress = possible stall
```

### 4.2 The live response is the operator's primary feedback surface

The activity indicator must be rendered where the response itself
appears.

A status bar may additionally expose system-wide state, but it must not
be the only indication that the agent is working.

### 4.3 Activity must come from runtime state

The UI must not invent `Thinking…` solely because a timer fired.

The runtime should explicitly establish an activity state when it starts
an operation and transition it when events occur.

### 4.4 Private reasoning remains private

`Thinking…` means the model is processing. It must never mean that ALiX
streams hidden reasoning text into the UI.

### 4.5 Cancellation is explicit

The user must be able to cancel a long-running invocation.

Cancellation is an operator action or an explicit system policy, not an
accidental consequence of a 120-second deadline.

------------------------------------------------------------------------

## 5. Activity State Model

The live response should use a small externally visible activity
vocabulary:

``` text
IDLE
THINKING
STREAMING
TOOL_RUNNING
WAITING_FOR_PROVIDER
VERIFYING
SUMMARIZING
COMPLETED
FAILED
CANCELLED
POSSIBLY_STALLED
```

Not every internal agent phase needs to be exposed.

### Recommended mapping

  -----------------------------------------------------------------------
  Runtime condition                   Live response
  ----------------------------------- -----------------------------------
  Invocation accepted                 `Thinking…`

  Model request in progress           `Thinking…`

  Provider has accepted request but   `Waiting for model…`
  no content yet                      

  Model content arriving              Stream content

  Tool request dispatched             `Running <tool>…`

  Tool execution active               `Running <tool>…`

  Tool complete, model resumes        `Thinking…`

  Verification phase                  `Verifying…`

  Summary phase                       `Summarizing…`

  Suspected inactivity                `Still working…` /
                                      `Possibly stalled`

  Completed                           Remove transient indicator

  Failed                              Render failure

  Cancelled                           Render cancellation
  -----------------------------------------------------------------------

`POSSIBLY_STALLED` is diagnostic state, not terminal state.

------------------------------------------------------------------------

## 6. Live Response Rendering Contract

The response renderer should own a transient activity element associated
with the current agent response.

Conceptually:

``` text
Response
├── activity: optional ActivityIndicator
└── content: streamed assistant content
```

While no response text exists:

``` text
ALiX
◐ Thinking… 41s
```

When content begins:

``` text
ALiX
Here is the architecture review...
```

The activity indicator should either disappear or become an unobtrusive
completed marker according to the existing UI conventions. It should not
remain above every streamed token.

### Animation

A lightweight spinner is sufficient:

``` text
◐ Thinking… 41s
◓ Thinking… 42s
◑ Thinking… 43s
◒ Thinking… 44s
```

The animation should be purely client-side and must not generate runtime
events every frame.

------------------------------------------------------------------------

## 7. Activity Metadata

The runtime should maintain an activity record similar to:

``` ts
interface AgentActivity {
  state:
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

  operation?: string;
  toolName?: string;

  startedAt: number;
  lastProgressAt: number;
  lastEventAt: number;

  elapsedMs: number;

  provider?: string;
  model?: string;

  invocationId: string;
}
```

`elapsedMs` may be calculated by the renderer from `startedAt`; it does
not need to be emitted every second.

------------------------------------------------------------------------

## 8. Progress Semantics

A progress event means the runtime has evidence that the invocation is
alive.

Examples:

-   provider request accepted;
-   provider response headers received;
-   streamed content chunk received;
-   streamed reasoning metadata received, if available and safe to
    expose only as activity metadata;
-   tool request emitted;
-   tool started;
-   tool output received;
-   agent state transitioned;
-   checkpoint completed;
-   provider heartbeat received.

Not every provider supports all of these.

Therefore ALiX needs a provider-neutral definition:

> **Progress is any trusted runtime event demonstrating that the
> invocation remains active.**

------------------------------------------------------------------------

## 9. Liveness Watchdog

The watchdog is independent of the execution timeout.

Recommended conceptual thresholds:

``` text
0–30s       normal
30–120s     long-running
120s+       still valid
N minutes   possible inactivity warning, provider-specific
```

Do not hard-code a universal stall threshold initially.

Different operations have different expected durations.

A future policy may define:

``` ts
stallPolicy = {
  warningAfterMs,
  criticalAfterMs,
  checkIntervalMs,
}
```

The watchdog should only transition the activity state:

``` text
THINKING
   |
   | no progress beyond warning threshold
   v
POSSIBLY_STALLED
```

It must not terminate the invocation.

------------------------------------------------------------------------

## 10. Stall Detection

A suspected stall should require more than "no assistant text."

For example:

``` text
lastProgressAt
lastProviderEventAt
lastToolEventAt
lastAgentEventAt
```

The watchdog can reason about these independently.

A model that is silently generating internally may have:

``` text
lastProviderEventAt = recent
```

and therefore remain healthy even though:

``` text
assistantVisibleText = unchanged
```

A genuinely dead connection may have:

``` text
lastProgressAt = 8m ago
provider socket = closed/unresponsive
runtime task = still pending
```

That is a candidate stall.

------------------------------------------------------------------------

## 11. Timeout Taxonomy

ALiX should distinguish:

### Operation timeout

A specific operation has an explicit semantic maximum.

Example:

``` text
shell command maximum duration = 10m
```

This can remain.

### Provider/network timeout

A socket or HTTP layer may have transport-specific timeout semantics.

These should be reviewed individually. Removing the agent-level
120-second deadline does not mean disabling TCP, HTTP, DNS, connection,
or idle transport protections.

### Agent execution deadline

This is the problematic timeout:

``` text
agent call timed out after 120000ms
```

It should be removed or changed from a hard default to an explicit
opt-in execution deadline.

### Watchdog

This detects lack of progress but does not terminate by default.

------------------------------------------------------------------------

## 12. Cancellation Architecture

Long-running execution needs a first-class cancellation path:

``` text
User presses Cancel
       |
       v
CancellationToken.cancel()
       |
       +--> provider request
       +--> current tool
       +--> agent loop
       +--> streaming task
       |
       v
CANCELLED
```

Cancellation should be observable in the live response:

``` text
ALiX
  Cancelling…
```

then:

``` text
ALiX
  Cancelled after 4m 12s
```

------------------------------------------------------------------------

## 13. Failure Semantics

If the provider actually fails:

``` text
Thinking… 2m 18s
```

should transition to a concrete failure:

``` text
Model request failed after 2m 18s
Reason: <classified error>
```

A watchdog warning must never masquerade as provider failure.

Likewise:

``` text
POSSIBLY_STALLED
```

must not be reported as:

``` text
FAILED
```

unless an actual failure occurs.

------------------------------------------------------------------------

## 14. Relationship to Existing ALiX Events

The logs already demonstrate useful lifecycle events:

-   `agent.session.phase_changed`
-   `agent.session.turn.started`
-   `agent.message`
-   `agent.reasoning`
-   `agent.decision`
-   `tool.requested`
-   `tool.started`
-   `tool.output`
-   `tool.completed`
-   `model.usage`
-   `runtime.phase.started`
-   `runtime.phase.completed`

The design should derive live activity from these existing runtime seams
wherever possible rather than introducing an unrelated polling
architecture.

Examples:

``` text
agent.session.turn.started
        ↓
THINKING

tool.requested
        ↓
TOOL_RUNNING

tool.completed
        ↓
THINKING

first assistant content chunk
        ↓
STREAMING

agent.session.phase_changed("Verifying")
        ↓
VERIFYING
```

`model.usage` is useful for telemetry but should not be treated as a
heartbeat unless its production semantics guarantee that it represents
live provider progress.

------------------------------------------------------------------------

## 15. Provider Timeout Removal

The code path should be traced from:

``` text
agent call
    ↓
agent runner
    ↓
model invocation
    ↓
provider adapter
    ↓
HTTP/SDK request
```

The exact 120000ms boundary must be identified rather than globally
removing all timeouts.

The intended end state is:

``` text
Agent execution
    no fixed 120s deadline
             |
             +--> provider transport protections remain
             |
             +--> tool-specific deadlines remain
             |
             +--> user cancellation remains
             |
             +--> watchdog observes liveness
```

This is substantially safer than:

``` text
Promise.race(..., timeout(120000))
```

or an equivalent unconditional deadline around the entire agent call.

------------------------------------------------------------------------

## 16. Backpressure and Memory

Removing the timeout exposes a second concern: an indefinitely running
invocation can consume resources.

Therefore the runtime must retain:

-   bounded event queues;
-   bounded stream buffers;
-   bounded tool output;
-   context-window enforcement;
-   cancellation;
-   concurrency limits;
-   per-invocation resource accounting.

The removal of a wall-clock timeout must **not** become removal of all
resource boundaries.

------------------------------------------------------------------------

## 17. Observability

Add metrics such as:

``` text
agent_invocation_duration_ms
agent_invocation_active
agent_activity_transitions_total
agent_stall_warnings_total
agent_cancellations_total
agent_provider_failures_total
```

Useful dimensions:

``` text
provider
model
activity_state
failure_kind
```

Avoid high-cardinality labels such as arbitrary prompt text.

------------------------------------------------------------------------

## 18. Acceptance Criteria

The design is successful when:

1.  A model call lasting longer than 120 seconds remains alive.
2.  The live response immediately displays `Thinking…`.
3.  The elapsed activity duration updates without runtime event spam.
4.  Tool execution displays the active tool.
5.  The activity indicator transitions into actual streamed content.
6.  No private chain-of-thought is displayed.
7.  A genuinely stalled provider can be identified independently of
    wall-clock duration.
8.  A stall warning does not automatically terminate execution.
9.  User cancellation remains possible.
10. Transport-level and operation-specific timeouts remain intact where
    appropriate.
11. Long-running calls do not cause unbounded buffering.
12. Existing short calls retain current UX.

------------------------------------------------------------------------

# Implementation Plan

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
