# Action-Based Routing and Visible Execution Plans

**Date:** 2026-07-24
**Status:** Approved Design — Ready for Implementation Planning
**Phase:** Runtime Routing + Operator Experience
**Related Areas:**

* Task Router
* AgentSession
* Daemon Execution Protocol
* Plan Persistence
* TUI Agent View
* Execution Lifecycle

---

# 1. Context

ALiX currently routes most user input through the full agent execution lifecycle.

A simple request such as:

```
2 + 2
```

or:

```
Write a Fibonacci function in Python.
```

can initialize:

* AgentSession
* workflow state
* event tracking
* planning lifecycle
* execution context

even though no autonomous execution is required.

This creates unnecessary latency and resource usage.

At the same time, ALiX already produces execution plans:

```
.alix/plans/<sessionId>.md
```

but plan information is not consistently exposed through:

* `AgentTurnResult`
* session state
* TUI rendering

This design introduces:

1. Action-based routing.
2. Deterministic arithmetic handling.
3. A lightweight direct response path.
4. Preserved agent execution for stateful work.
5. Structured visible execution plans in the operator UI.

---

# 2. Design Principles

## 2.1 Route by Action, Not Content

ALiX does not decide based on whether a request contains code, technical terms, or complexity.

The decision is:

> Does the user want an answer, or does the user want ALiX to gather information or perform work?

---

# 3. Routing Model

## 3.1 Direct / Stateless Path

The direct path handles requests where ALiX only needs to produce a response.

Examples:

### General knowledge

```
Explain dependency injection.
What is CAP theorem?
```

### Standalone code generation

```
Write a Fibonacci function in Python.
Generate a SQL query.
Create a regex for email validation.
Write a Bash one-liner.
```

### Writing tasks

```
Draft an email.
Translate this paragraph.
Summarize this text.
```

### Documentation generation

```
Write documentation for OAuth2.
Create API documentation examples.
```

---

Direct path requirements:

* One provider call maximum.
* No tools.
* No workspace loading.
* No repository context.
* No memory loading.
* No AgentSession initialization.
* No workflow state.
* No execution plan creation.

---

## 3.2 Agent / Stateful Path

The agent path handles requests requiring information gathering, context, or action.

Examples:

### Workspace actions

```
Implement this feature.
Modify src/main.ts.
Refactor this module.
Run the tests.
```

### Repository investigation

```
Find all usages of this function.
Review this repository.
Debug this stack trace.
```

### External retrieval

```
Research current Kubernetes security practices.
Find the latest OpenAI API changes.
Compare current database benchmarks.
Search documentation for this library.
```

### Execution

```
Create a file.
Run a shell command.
Deploy this service.
Commit these changes.
```

---

Agent path requirements:

* AgentSession lifecycle.
* Tools available.
* Workspace context available.
* Planning allowed.
* Evidence tracking enabled.

---

# 4. Routing Contract

## 4.1 ActionIntent

The classifier returns:

```ts
export type ActionIntent =
  | "arithmetic"
  | "standalone_generation"
  | "workspace_action"
  | "external_retrieval"
  | "ambiguous";
```

---

## 4.2 Classification Result

```ts
export interface ActionClassification {
  intent: ActionIntent;
  confidence?: number;
  reason: string;
}
```

---

## 4.3 Routing Precedence

Classification occurs in this order:

```
1. Deterministic arithmetic
2. Explicit workspace/action signals
3. External retrieval signals
4. Standalone generation signals
5. Ambiguous fallback
```

---

# 5. Classification Rules

## 5.1 Arithmetic

Arithmetic is recognized only when:

* expression is syntactically valid;
* parser can safely evaluate it.

Examples:

```
2 + 2
(10 * 4) / 5
```

Direct deterministic response.

---

Invalid:

```
2 + apples
hello + 5
```

Behavior:

```
No arithmetic match
        |
        v
Continue normal routing
```

---

# 5.2 Workspace Action Signals

Positive indicators:

```
my repository
my project
this file
src/
modify
edit
implement
refactor
create file
run tests
commit
deploy
```

Examples:

```
Implement authentication.
```

→ agent

```
Write authentication example code.
```

→ direct

---

# 5.3 External Retrieval Signals

Positive indicators:

```
search
research
latest
current
compare sources
look up
find documentation
recent
according to sources
```

Examples:

```
Explain OAuth2.
```

→ direct

```
Research OAuth2 security issues in 2026.
```

→ agent

---

# 5.4 Documentation Boundary

Documentation generation:

```
Write API documentation.
```

→ direct

Documentation modification:

```
Update README.md.
```

→ agent

---

# 5.5 Ambiguous Requests

Examples:

```
Improve this application.
Make this better.
Fix this.
Implement authentication.
```

Without enough context:

```
ambiguous
     |
     v
agent
```

---

# 6. Shared Classifier Architecture

All entry points use the same classifier.

Current:

```
CLI
TUI
```

Future:

```
Web UI
```

The classifier is reusable, but Web UI is not part of this implementation scope.

---

# 7. AgentSession Integration

The TUI currently enters:

```
AgentSession.processTurn()
```

directly.

Therefore AgentSession must perform routing preflight before initialization.

Flow:

```
processTurn()
      |
      v
ActionClassifier
      |
      +---- direct
      |
      +---- agent
             |
             v
          initialize()
```

This prevents the TUI from paying agent startup cost for direct requests.

---

# 8. Direct Executor

The direct executor performs:

```
Input
 |
Action classification
 |
Provider call
 |
Response
```

It must not initialize:

* ToolExecutor
* MCP
* repository index
* memory
* workflow engine
* AgentSession
* execution state

---

# 9. Daemon Protocol

Direct requests do not create persistent execution artifacts.

They may have an ephemeral request identifier.

Allowed:

```
requestId
```

Purpose:

* response correlation
* tracing

Not persisted.

---

## 9.1 Direct Lifecycle

Direct:

```
request.received
        |
        v
direct.completed
```

No:

* session.started
* task.accepted
* workflow events
* plans
* execution artifacts

---

## 9.2 Agent Lifecycle

Unchanged:

```
session.started
task.accepted
plan.created
execution.events
task.completed
session.ended
```

---

# 10. Route Diagnostics

Routing diagnostics are not execution events.

They are optional observers.

---

## 10.1 Contract

```ts
export interface RoutingContext {
  onRouteDiagnostic?: (
    diagnostic: RouteDiagnostic
  ) => void;
}
```

---

## 10.2 Diagnostic Type

```ts
export interface RouteDiagnostic {
  classification: ActionIntent;
  route: "direct" | "agent";
  reason: string;
  confidence?: number;
}
```

---

Rules:

* Best effort.
* Non-blocking.
* No persistence by default.
* Never changes routing.
* Never affects execution.

---

# 11. Plan Persistence

## 11.1 Canonical Plan

The markdown plan remains authoritative:

```
.alix/plans/<sessionId>.md
```

Contains:

* intent
* task descriptions
* acceptance criteria
* architecture decisions
* verification requirements

---

## 11.2 Task Sidecar

Execution state:

```
.alix/plans/<sessionId>.tasks.json
```

The sidecar:

* is derived state;
* does not replace markdown;
* does not mutate markdown.

---

# 12. Sidecar Schema

Version 1:

```json
{
  "schemaVersion": 1,
  "sessionId": "abc123",
  "summary": "Implement action routing",
  "tasks": [
    {
      "id": "task-001",
      "index": 1,
      "title": "Create action classifier",
      "detail": "src/runtime/task-router.ts",
      "status": "pending",
      "createdAt": "2026-07-24T00:00:00Z"
    }
  ]
}
```

---

# 13. PlanTask Model

```ts
export interface PlanTask {
  id: string;
  index: number;
  title: string;
  detail?: string;

  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "skipped";

  createdAt?: string;
  updatedAt?: string;
}
```

---

# 14. Task Lifecycle

Initial plan creation:

```
All tasks = pending
```

Execution:

```
pending
   |
   v
in_progress
   |
   +--> completed
   |
   +--> skipped
```

Markdown parsing creates task definitions.

Runtime execution updates task status.

---

# 15. Sidecar Failure Handling

Failures:

* missing file
* invalid JSON
* write failure
* schema mismatch

Behavior:

```
Warning
 |
Continue execution
 |
Recover from markdown if possible
```

Never abort execution.

---

# 16. AgentTurnResult Extension

Existing API is preserved.

Final interface:

```ts
export interface AgentTurnResult {
  summary: string;
  sessionId: string;
  toolCalls: readonly ToolCall[];

  streamed?: boolean;
  reason?: string;

  planContent?: string;
  planTasks?: readonly PlanTask[];
}
```

New fields are additive.

---

# 17. TUI Plan Rendering

The agent view displays tasks before markdown.

Example:

```
PLAN TASKS

[ ] 1. Add lightweight routing
[~] 2. Connect plan tasks
[x] 3. Add routing tests
[-] 4. Optional cleanup
```

Markers:

| Marker | Meaning     |
| ------ | ----------- |
| `[ ]`  | pending     |
| `[~]`  | in progress |
| `[x]`  | completed   |
| `[-]`  | skipped     |

---

Rules:

* Long titles wrap.
* List height is bounded.
* Markdown remains expandable.

Execution progress remains separate:

```
Execution Step 2/8
Running tests
```

---

# 18. Verification

## Classifier

Tests:

* arithmetic
* standalone generation
* workspace actions
* external retrieval
* ambiguity fallback

---

## Router

Tests:

* direct route
* tool route
* grounded route
* chat route
* agent route

---

## AgentSession

Verify:

```
2 + 2
```

does not initialize:

* session
* tools
* workflow
* events

---

## Executor

Direct:

* no ToolExecutor
* no runTask
* no artifacts

Agent:

* existing lifecycle preserved

---

## Persistence

Verify:

* markdown remains canonical
* sidecar creation
* sidecar updates
* failure recovery
* legacy resume

---

## TUI

Verify:

* tasks reach UI state
* markers render
* markdown remains accessible

---

# 19. Routing Regression Tests

## Direct

```
Write a Bash one-liner
```

Expected:

```
direct
```

---

## Agent

```
Write this Bash command to script.sh
```

Expected:

```
agent
```

---

## Direct

```
Explain this SQL query
```

Expected:

```
direct
```

---

## Agent

```
Find all uses of this SQL query in the repository
```

Expected:

```
agent
```

---

# 20. End-to-End Validation

Direct:

Input:

```
2 + 2
```

Expected:

* immediate response
* no session artifact
* no plan
* no workflow events

---

Agent:

Input:

```
Implement this feature in my repository
```

Expected:

* plan generated
* task checklist displayed
* execution lifecycle begins

---

# 21. Implementation Order

1. Implement `ActionClassifier`.
2. Add arithmetic parser.
3. Integrate shared router.
4. Add AgentSession preflight.
5. Add direct executor.
6. Add RouteDiagnostic observer.
7. Add plan task extraction.
8. Add task sidecar persistence.
9. Extend `AgentTurnResult`.
10. Add TUI checklist rendering.
11. Run regression suite.

---

# Final Status

**Approved Design — Ready for Implementation Planning**

The final routing model:

```
Answer only
    |
    v
Direct path


Gather information or perform work
    |
    v
Agent path
```

This gives ALiX fast conversational behavior while preserving governed autonomous execution when real work is required.

