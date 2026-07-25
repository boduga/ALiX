# Action-Based Routing and Visible Execution Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved implementation plan

## Goal

Route answer-only requests through a stateless direct execution path while preserving ALiX’s governed workflow for any request requiring retrieval, workspace context, tools, execution, planning, or ambiguity.

Expose generated execution plans as visible structured task lists in the TUI while preserving Markdown plans as the canonical human-readable artifact.

---

# Architecture

ALiX routing is based on the requested **action**, not the presence of code or technical language.

## Direct path

The direct path handles requests where the user wants ALiX to produce an answer.

Examples:

* `2 + 2`
* `Explain recursion`
* `Write a Fibonacci function in Python`
* `Generate SQL for this query`
* `Write a regex`
* `Write a Bash one-liner`
* translation
* rewriting
* general explanations
* greetings

Rules:

* zero workflow initialization;
* zero tools;
* zero repository/workspace loading;
* zero memory/session state;
* zero plan creation;
* arithmetic may return without a provider;
* generation uses exactly one provider call.

---

## Agent path

The agent path handles requests where ALiX must gather information or perform work.

Examples:

* `Implement Fibonacci in my repository`
* `Fix this bug`
* `Run tests`
* `Modify package.json`
* `Review this PR`
* `Find all usages of this function`
* `Search the web for current information`
* `Perform deep research`
* ambiguous prompts.

Rules:

* existing workflow lifecycle remains unchanged;
* planning/tool execution remains available.

---

## Retrieval compatibility route

External retrieval remains mapped to the existing grounded route.

Examples:

* `Search latest Kubernetes security issues`
* `Find current pricing for X`
* `Research recent papers about Y`

Route:

```
external_retrieval
        |
        v
grounded_chat
        |
        v
existing retrieval executor
```

It does **not** create a new AgentSession lifecycle unless workspace/action execution is also required.

---

# Tech Stack

* TypeScript ESM
* Node 24
* `node:test`
* Vitest
* Existing provider registry
* Existing daemon JSON-line protocol
* Existing TUI renderer/state model
* Existing `.alix` artifact storage

---

# Global Constraints

* Routing must be deterministic and model-free.
* `ActionClassifier` must have no side effects.
* Classifier uncertainty routes to agent.
* Arithmetic must use a safe parser only.
* Invalid arithmetic falls through normally.
* Direct execution cannot load:

  * tools;
  * workspace;
  * repository state;
  * memory;
  * MCP;
  * workflow state;
  * session artifacts.
* Existing shell/file routes remain unchanged.
* Existing `AgentTurnResult` fields remain compatible.
* New plan fields are additive only.
* Markdown plans remain canonical.
* `.tasks.json` is derived execution state only.
* Sidecar failures are warnings only.
* Phase one task statuses are initialized only as `pending`.
* No live task mutation system is introduced.
* Web UI support is future scope only.

---

# File Map

| File                               | Purpose                                     |
| ---------------------------------- | ------------------------------------------- |
| `src/runtime/action-classifier.ts` | Action classification and arithmetic parser |
| `src/runtime/task-router.ts`       | Shared route selection                      |
| `src/runtime/route-executor.ts`    | Direct execution, `RuntimeContext`, and diagnostic callback wiring |
| `src/daemon/daemon-types.ts`       | Direct response protocol types              |
| `src/daemon/daemon-server.ts`      | Direct daemon fast path                     |
| `src/agent/session.ts`             | Session preflight                           |
| `src/planning/plan-task.ts`        | Task parser and sidecar schema              |
| `src/run/plan-phase.ts`            | Plan persistence                            |
| `src/session/resume.ts`            | Sidecar restore                             |
| `src/tui/state.ts`                 | TUI state                                   |
| `src/tui/app.ts`                   | Result propagation                          |
| `src/tui/views/agent-view.ts`      | Task rendering                              |

Tests:

| Test                      | Runner    |
| ------------------------- | --------- |
| runtime classifier/router | node:test |
| daemon                    | node:test |
| plan parser               | node:test |
| session                   | Vitest    |
| TUI                       | Vitest    |

---

### Task 1: Add Action Classifier and Arithmetic Parser

**Files:**

Create:

```
src/runtime/action-classifier.ts
tests/runtime/action-classifier.test.ts
```

---

## Interfaces

```ts
export type ActionIntent =
  | "arithmetic"
  | "standalone_generation"
  | "workspace_action"
  | "external_retrieval"
  | "ambiguous";

export interface ActionClassification {
  intent: ActionIntent;
  reason: string;
  confidence?: number;
  arithmeticAnswer?: string;
}

export function classifyAction(
  input: string
): ActionClassification;

export function evaluateArithmetic(
  input: string
): number | null;
```

---

## Steps

* [ ] Write failing tests.

Required cases:

```ts
"2 + 2"
"(10 * 4) / 5"
"Write Fibonacci function in Python"
"Add Fibonacci implementation to my repo"
"Find all usages of this function"
"Search latest Kubernetes vulnerabilities"
"2 + apples"
```

Expected:

* arithmetic → direct;
* standalone generation → direct;
* workspace → agent;
* retrieval → grounded;
* malformed arithmetic → no match.

---

* [ ] Run:

```bash
pnpm build
node --test dist/tests/runtime/action-classifier.test.js
```

Expected:

FAIL.

---

* [ ] Implement deterministic classifier.

Precedence:

```
arithmetic
 ↓
workspace/action
 ↓
external retrieval
 ↓
standalone generation
 ↓
ambiguous
```

Workspace/action indicators dominate retrieval indicators. For example, `Search my repo for Kubernetes vulnerabilities` is `workspace_action` and routes to `agent`; `Search the web for current Kubernetes vulnerabilities` is `external_retrieval` and routes to `grounded_chat`.

---

* [ ] Implement recursive-descent arithmetic parser.

Allowed:

```
numbers
+
-
*
/
%
^
()
unary -
```

Reject:

* variables;
* identifiers;
* malformed syntax;
* divide by zero;
* non-finite values.

---

* [ ] Verify:

```bash
pnpm build
node --test dist/tests/runtime/action-classifier.test.js
```

---

* [ ] Commit.

```bash
git add src/runtime/action-classifier.ts tests/runtime/action-classifier.test.ts
git commit -m "feat: add deterministic action classifier"
```

---

### Task 2: Integrate Shared Routing

**Files:**

Modify:

```
src/runtime/task-router.ts
src/runtime/route-executor.ts
tests/runtime/task-router.test.ts
tests/runtime/route-executor.test.ts
```

---

## Interfaces

```ts
export interface RouteDiagnostic {
  classification: ActionIntent;
  route:
    | "direct"
    | "tool"
    | "grounded_chat"
    | "agent"
    | "chat";
  reason: string;
  confidence?: number;
}
```

---

```ts
export type TaskRoute =
  | {
      kind: "direct";
      prompt: string;
      answer?: string;
      diagnostic: RouteDiagnostic;
    }
  | {
      kind: "tool";
      tool: string;
      args: Record<string, unknown>;
      diagnostic?: RouteDiagnostic;
    }
  | {
      kind: "chat";
      prompt: string;
      diagnostic?: RouteDiagnostic;
    }
  | {
      kind: "grounded_chat";
      prompt: string;
      allowedTools: string[];
      diagnostic: RouteDiagnostic;
    }
  | {
      kind: "agent";
      task: string;
      diagnostic: RouteDiagnostic;
    };
```

`RuntimeContext` in `src/runtime/route-executor.ts` gains:

```ts
onRouteDiagnostic?: (diagnostic: RouteDiagnostic) => void;
```

`RuntimeExecutor` gains:

```ts
executeDirect(
  route: TaskRoute & { kind: "direct" },
  ctx: RuntimeContext,
): Promise<string>;
```

---

## Diagnostic delivery

Diagnostics are:

* attached to routes;
* optionally forwarded through:

```ts
onRouteDiagnostic?: (
 diagnostic: RouteDiagnostic
)=>void;
```

Rules:

* callback failures ignored;
* no persistence;
* no events.

---

## Route invariants

The router must preserve ownership boundaries:

```text
direct:
  no lifecycle, tools, or artifacts

tool:
  existing ToolExecutor path

grounded_chat:
  existing retrieval executor only

agent:
  full AgentSession/workflow lifecycle
```

These invariants must be covered by route-executor regression tests.

---

## Steps

* [ ] Add route regression tests.

Required:

| Prompt                 | Route      |
| ---------------------- | ---------- |
| `2+2`                  | direct     |
| Fibonacci function     | direct     |
| Explain SQL            | direct     |
| Write SQL into file    | agent/tool |
| Find SQL usage in repo | agent      |
| Search latest docs     | grounded   |
| Implement feature      | agent      |

---

* [ ] Run:

```bash
pnpm build
node --test dist/tests/runtime/task-router.test.js
```

---

* [ ] Integrate classifier.

---

* [ ] Add direct executor.

Add `executeDirect` to `RuntimeExecutor` and add the `"direct"` branch to `executeRoute` in `src/runtime/route-executor.ts`.

Rules:

Arithmetic:

```
return answer
```

Generation:

```
one provider call
```

Forward `route.diagnostic` through `ctx.onRouteDiagnostic` when the callback exists. Swallow callback failures and never import `ToolExecutor` or `runTask` for this route.

---

* [ ] Verify.

```bash
pnpm build
node --test \
dist/tests/runtime/task-router.test.js \
dist/tests/runtime/route-executor.test.js
```

---

* [ ] Commit.

```bash
git commit -am "feat: add action based routing"
```

---

### Task 3: Add Daemon Direct Protocol

**Files:**

Modify:

```
src/daemon/daemon-types.ts
src/daemon/daemon-server.ts
tests/daemon/daemon-server.test.ts
```

---

## Protocol additions

```ts
{
 type:"request.received",
 requestId:string
}

{
 type:"direct.completed",
 requestId:string,
 text:string
}
```

---

## Steps

* [ ] Add failing tests.

Verify:

* no session events;
* no task registry;
* no `.alix/plans`;
* no `.alix/sessions`.

---

* [ ] Run:

```bash
pnpm build
node --test dist/tests/daemon/daemon-server.test.js
```

---

* [ ] Resolve route before lifecycle creation.

Direct requests:

```
requestId
   |
request.received
   |
direct.completed
```

No:

```
session.started
task.accepted
task.completed
session.ended
```

---

* [ ] Commit.

```bash
git commit -am "feat: add daemon direct execution path"
```

---

### Task 4: Protect AgentSession

**Files:**

Modify:

```
src/agent/session.ts
```

Create:

```
tests/agent/session-direct-path.vitest.ts
```

---

## AgentTurnResult

Preserve existing:

```ts
export interface AgentTurnResult {
 summary:string;
 sessionId:string;
 toolCalls:readonly ToolCall[];
 streamed?:boolean;
 reason?:string;

 planContent?:string;
 planTasks?:readonly PlanTask[];
}
```

---

## AgentSessionConfig diagnostic hook

Extend the existing `AgentSessionConfig` in `src/agent/session.ts`:

```ts
onRouteDiagnostic?: (diagnostic: RouteDiagnostic) => void;
```

`processTurn()` invokes this callback after preflight classification and before returning a direct result. Callback failures are ignored. Direct requests must not fall through to the agent workflow when the provider is unavailable; return the existing no-provider response shape without calling `initialize()`.

---

## Direct generation rules

Before:

```ts
initialize()
```

perform:

```ts
classifyAction()
```

Cases:

Arithmetic:

```
provider calls: 0
initialize: false
```

Generation:

```
provider calls: <=1
initialize: false
```

No provider:

```
return controlled error
never fallback into workflow
```

---

## Steps

* [ ] Add tests.

Required:

```
processTurn("2+2")
```

and:

```
processTurn(
"Write Fibonacci function in Python"
)
```

Verify:

* no initialization;
* no workflow;
* no artifacts.

---

* [ ] Run:

```bash
pnpm vitest run \
tests/agent/session-direct-path.vitest.ts \
--config vitest.config.mts
```

---

* [ ] Implement preflight.

---

* [ ] Commit.

```bash
git commit -am "feat: bypass workflow for direct session requests"
```

---

### Task 5: Add Plan Task Persistence

**Files:**

Create:

```
src/planning/plan-task.ts
tests/planning/plan-task.test.ts
```

Modify:

```
src/run/plan-phase.ts
tests/plan-phase.test.ts
```

---

## Interfaces

```ts
export type PlanTaskStatus =
 "pending" |
 "in_progress" |
 "completed" |
 "skipped";
```

---

```ts
export interface PlanTask {
 id:string;
 index:number;
 title:string;
 detail?:string;
 status:PlanTaskStatus;
}
```

---

```ts
export interface PlanTaskList {
 schemaVersion:1;
 sessionId:string;
 summary:string;
 tasks:PlanTask[];
}
```

---

```ts
export type PlanPhaseResult =
  | {
      action: "approved";
      planContent: string;
      planTasks?: readonly PlanTask[];
    }
  | {
      action: "rejected";
      planContent: string;
      planTasks?: readonly PlanTask[];
    };
```

---

## Steps

* [ ] Add parser tests.

* [ ] Implement parser.

IDs:

```
sessionId:task:index
```

Initial:

```
status:"pending"
```

---

* [ ] Persist:

```
.alix/plans/<id>.md

.alix/plans/<id>.tasks.json
```

---

* [ ] Sidecar failure:

warning only.

---

* [ ] Run:

```bash
pnpm build

node --test \
dist/tests/planning/plan-task.test.js \
dist/tests/plan-phase.test.js
```

---

* [ ] Commit.

```bash
git add src/planning/plan-task.ts src/run/plan-phase.ts \
  tests/planning/plan-task.test.ts tests/plan-phase.test.ts
git commit -m "feat: persist structured plan tasks"
```

---

### Task 6: Resume and Session Integration

**Files:**

Modify:

```
src/session/resume.ts
src/agent/session.ts
```

Create:

```
tests/session-resume.vitest.ts
```

---

## ReconstructedSession extension

Extend the existing `ReconstructedSession` in `src/session/resume.ts`:

```ts
planContent: string | null;
planTasks?: readonly PlanTask[];
completed: boolean;
```

`reconstructSession()` loads and validates `.tasks.json` when present. Missing, malformed, or schema-incompatible sidecars fall back to `parsePlanTasks(planContent, sessionId)` without failing resume.

---

## Steps

* [ ] Return plan fields from AgentSession.

* [ ] Load sidecar.

* [ ] Fallback:

```
tasks.json missing
       |
parse markdown
```

---

* [ ] Verify:

```bash
pnpm vitest run tests/session-resume.vitest.ts
```

---

* [ ] Commit.

```bash
git add src/session/resume.ts src/agent/session.ts tests/session-resume.vitest.ts
git commit -m "feat: restore persisted plan tasks on resume"
```

---

### Task 7: TUI Checklist Rendering

**Files:**

Modify:

```
src/tui/state.ts
src/tui/app.ts
src/tui/views/agent-view.ts
```

Create:

```
tests/tui/views/agent-view.vitest.ts
```

---

## State

```ts
planContent?:string;

planTasks?:readonly PlanTask[];
```

---

## Rendering

Example:

```
PLAN TASKS

[ ] 1. Add router
[~] 2. Update session
[x] 3. Add tests
[-] 4. Optional
```

---

## Steps

* [ ] Add tests.

Verify:

* all markers;
* wrapping;
* bounded list;
* markdown preserved.

---

* [ ] Propagate fields.

Clear stale tasks on new turn.

---

* [ ] Verify:

```bash
pnpm vitest run \
tests/tui/app.vitest.ts \
tests/tui/views/agent-view.vitest.ts \
--config vitest.config.mts
```

---

* [ ] Commit.

```bash
git add src/tui/state.ts src/tui/app.ts src/tui/views/agent-view.ts \
  tests/tui/app.vitest.ts tests/tui/views/agent-view.vitest.ts
git commit -m "feat: render plan tasks in the TUI"
```

---

### Task 8: Final Verification

## Steps

* [ ] Runtime tests.

```bash
pnpm build

node --test \
dist/tests/runtime/*.test.js
```

---

* [ ] Vitest.

```bash
pnpm vitest run \
--config vitest.config.mts
```

---

* [ ] Typecheck.

```bash
pnpm typecheck
```

---

* [ ] Full suite.

```bash
pnpm test
```

---

* [ ] TUI smoke test.

Direct:

```
2 + 2
```

Expected:

```
4
```

No:

* plans;
* sessions;
* events;
* tools.

Agent:

```
Implement this feature in my repository
```

Expected:

* Markdown plan;
* `.tasks.json`;
* visible checklist.

---

* [ ] Final review.

Confirm:

* direct path cannot initialize workflow;
* retrieval still uses grounded route;
* AgentTurnResult compatibility preserved;
* Markdown remains canonical;
* TUI displays execution plans.

---

* [ ] Final commit.

```bash
git add src tests
git commit -m "feat: implement action based routing and visible execution plans"
```

