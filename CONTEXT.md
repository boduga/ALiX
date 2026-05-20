# ALiX Domain Model

Agentic Lifecycle & Intelligence eXchange — an AI coding agent that executes tasks in a session, with policy enforcement, subagent delegation, and verification loops.

## Core Entities

### Session

The fundamental unit of work. A session has a UUID, a working directory (cwd), and tracks an event log at `.alix/sessions/{sessionId}/`. A session begins with `session.started`, accepts a `user.message` task, and ends with `session.ended` carrying a reason (`completed`, `max_repairs`, `max_iterations`, `rejected_scope_expansion`).

### Task

The user's request/goal passed as a string to `alix run`. Tasks are classified into types: `bugfix`, `refactor`, `feature`, `docs`, `test`, `unknown`. Task type influences context bundle compilation, verification policy, and repair loop behavior.

### ToolCall

An invocation by the model of a tool (e.g., `alix_file_read`, `alix_patch_apply`). Each tool call has a unique `id`, a `name`, and `args`. Tool calls pass through the Policy Engine before execution and are logged to the EventLog.

## Autonomy Layer

### Scope

A boundary defining which files the agent may mutate. Extracted from the task string at session start. Files mentioned in the task (paths like `src/`, `lib/`, `./`, `../`) become the initial scope. Scope lives in a **ScopeTracker**.

### ScopeTracker

Tracks the current scope, pending expansions, and approved/denied paths. Its `checkMutation(path)` returns:
- `allowed` — in scope
- `denied` — explicitly blocked
- `scope_expansion` — outside scope, needs approval
- `approved` — user approved an expansion

### ScopeExpansion

When a mutation tool targets a file outside the initial scope, a scope expansion is triggered. In `auto` mode, expansion is auto-approved. In `ask` mode, the user is prompted. Non-TTY ask mode fails fast.

### AgentState

The task state machine: `idle` → `planning` → `executing` → `verifying` → `repairing` → `summarizing` → `completed`. Also: `waiting_approval`, `failed`, `stopped`.

## Policy Layer

### PolicyEngine

The central authority for tool call decisions. Given a `ToolCallRequest`, it checks capability risk, shell command risk, network destination, and protected paths. Returns a `PolicyDecision` with `decision`: `allow`, `ask`, or `deny`.

### Capability

A named action the agent can take: `shell.readonly`, `shell.mutating`, `file.read`, `file.write`, `network.fetch`, `tool.use`. Each capability has a `RiskLevel` (`low`, `medium`, `high`, `critical`).

### SessionMode

Controls how permission decisions are resolved: `auto` (ask → allow), `ask` (blocking prompt), `bypass` (override deny to allow).

## Delegation

### Subagent

A child process spawned via `alix run --subagent <role>` to perform specialized work. Has a `role`, `mode` (`read_only` | `write`), `ownedPaths`, and returns a `SubagentResult` with `status` and `findings`.

### SubagentRole

The specialization of a subagent:
- `auto` — adaptive
- `explorer` — understand code regions, report findings
- `reviewer` — code quality analysis
- `test_investigator` — map tests to code, diagnose failures
- `docs_researcher` — find and summarize docs
- `worker` — apply changes to owned files only

### OwnershipRegistry

Maps file paths to the `subagentId` that owns them. Prevents overlapping write ownership.

## Context

### RepoMap

The complete map of a repository: source files, test files, config files, dependency graph, extracted symbols, and git activity.

### ContextCompiler

Compiles a `ContextBundle` for injection into the system prompt. Uses `warm()` to build/load the RepoMap, then ranks files by task mentions, dependency proximity, and symbol matches.

### ContextBundle

The ranked, token-budgeted selection of context for a task. Contains `primaryFiles`, `supportingFiles`, `tests`, and `pinned` files.

## Verification

### VerificationCheck

A post-execution check to confirm correctness. Has a `command` to run and a `reason`.

### VerificationPolicy

Determines when to run verification based on `SessionMode` and `scopeApproved`.

### RepairLoop

When verification fails, the session enters a repair loop. After `maxRepairs` attempts, the session ends with `reason: "max_repairs"`.

## Memory and Events

### MemoryStore

Persists memory entries to `.alix/memory/{user,project,feedback,reference}/`. Entries have `name`, `description`, `type`, `content`, and `confidence`.

### EventLog

Append-only log of all session events. Events have `actor` (`user`, `agent`, `system`, `tool`, `policy`, `verifier`, `subagent`), `type`, `timestamp`, and `payload`. Used for replay and diagnostics.

### CheckpointManager

Creates checkpoints before applying patches to mutable files. Located at `sessions/{sessionId}/checkpoints/`. Used for rollback.

## Patch

### Patch

A structured change to files. Formats: `search_replace` (unified diff-like) and `structured_patch` (JSON). `full_file` rewrite is only for new files.

### EditFormatPolicy

Determines which patch formats are allowed and which is preferred, based on provider model.