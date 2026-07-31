# ALiX Capability Platform — Design Specification

**Status:** Implemented (Phase 1)
**Date:** 2026-07-31
**Origin:** Wayfinder #308 — "Everything from the TUI"
**Purpose:** Define the reusable execution substrate behind all ALiX interfaces.

---

# 1. Vision

The Capability Platform transforms ALiX from a collection of interfaces and commands into a self-describing execution system.

The platform is the product. Interfaces are consumers.

Every ALiX surface:

* TUI
* CLI
* Web UI
* MCP server
* Slash commands
* Agents
* Plugins
* Automation workflows

discovers and executes capabilities through the same platform APIs.

The TUI Capability Explorer and Command Palette are only the first consumers.

The platform answers five fundamental questions:

| Question                     | Component          |
| ---------------------------- | ------------------ |
| What exists?                 | CapabilityRegistry |
| How should it execute?       | ExecutionResolver  |
| What execution should occur? | ExecutionPlan      |
| How does execution proceed?  | CapabilityRuntime  |
| Who performs the work?       | ExecutorRegistry   |
| Who observes the system?     | EventBus           |

---

# 2. Architecture Overview

```
Capability Definitions
(registerCapability / META)
          │
          ▼
CapabilityRegistry
"What exists?"
(metadata + discovery)
          │
          ▼
ExecutionResolver
"How should this run?"
(routing + policy)
          │
          ▼
ExecutionPlan
(resolved execution contract)
          │
          ▼
CapabilityRuntime
(invocation lifecycle)
          │
          ▼
ExecutorRegistry
(execution backends)
          │
          ▼
EventBus
(system observation)
```

## Core Principles

### 1. Capability is pure data

Capabilities describe available functionality.

They do not contain:

* executable functions
* lifecycle hooks
* runtime state
* executor instances

The registry remains fully serializable.

---

### 2. Execution is separated from discovery

The registry knows what exists.

The runtime knows how to execute.

Executors know how to perform work.

No layer owns responsibilities belonging to another.

---

### 3. Consumers never depend on executors

A CLI command, TUI action, or web button does not know whether execution happens through:

* native code
* a daemon
* an agent
* a container
* a remote worker

Everything resolves into an Invocation.

---

# 3. Capability Contract

```typescript
interface Capability {

  id: string;
  // Namespaced identifier:
  // core.session.list
  // tool.file.read
  // git.commit

  version: string;

  kind:
    | "core"
    | "tool"
    | "skill"
    | "custom"
    | "workflow"
    | "plugin";

  title: string;

  description: string;

  aliases?: string[];

  tags: string[];

  category: string;

  risk:
    | "low"
    | "medium"
    | "high"
    | "critical";

  permissions:
    | "operator"
    | "admin"
    | "developer"
    | "internal";

  argsSchema?: JSONSchema;

  resultSchema?: JSONSchema;

  examples?: string[];

  execution: {

    strategy: string;
    // native
    // tool
    // daemon
    // agent
    // cli
    // docker
    // remote

    timeout?: number;

    cancellable?: boolean;
  };

  dependencies?: string[];

  extensions?: Record<string, unknown>;
}
```

---

# 4. Capability Data Invariants

Capabilities must always be:

* serializable
* deterministic
* transportable
* storage-independent

`registry.export()` must reproduce the complete capability manifest.

No fields may require stripping because of functions or runtime objects.

---

# 5. Runtime State Separation

Dynamic state does not belong in Capability.

Example:

```typescript
interface CapabilityStatus {

  capabilityId: string;

  availability:
    | "available"
    | "unavailable"
    | "degraded";

  health:
    | "healthy"
    | "warning"
    | "error";

  lastChecked: number;
}
```

Examples:

* daemon disconnected
* plugin unloaded
* Docker unavailable
* remote worker offline

are status events, not metadata mutations.

---

# 6. CapabilityRegistry

The registry answers:

> "What capabilities exist?"

Responsibilities:

* registration
* discovery
* querying
* metadata export

API:

```typescript
register(capability)

unregister(id)

find(id)

query({
  text?,
  tags?,
  category?,
  risk?,
  permissions?,
  kinds?,
  namespaces?
})

list()

describe(id)

reload()

watch(callback)

export()
```

The registry does **not**:

* execute capabilities
* validate arguments
* select executors
* manage invocations

---

# 7. ExecutionResolver

The resolver answers:

> "Given this capability and context, what execution should occur?"

Input:

```typescript
Capability + InvocationContext
```

Output:

```typescript
ExecutionPlan[]
```

Example:

```
core.session.list
        ↓
native executor


tool.file.read
        ↓
tool executor


git.commit
        ↓
cli executor


workflow.release
        ↓
workflow executor
```

---

## ExecutionPlan

```typescript
interface ExecutionPlan {

  executor: string;

  timeout: number;

  hooks: string[];

  permissions: string[];

  retryPolicy?: {

    attempts: number;

    backoffMs: number;
  };

  scheduling?: unknown;
}
```

The resolver owns:

* routing rules
* policy decisions
* execution selection

The runtime does not contain routing knowledge.

---

# 8. CapabilityRuntime

The runtime owns invocation lifecycle.

API:

```typescript
runtime.invoke(
  capabilityId,
  args,
  context
): Invocation


runtime.cancel(invocationId)


runtime.subscribe(handler)


runtime.registerHooks(
  capabilityId,
  hooks
)
```

The runtime:

* resolves execution plans
* validates execution
* creates Invocation objects
* coordinates executors
* publishes events

The runtime does not:

* store history
* own UI state
* persist executions

---

# 9. Invocation

Invocation is the universal execution abstraction.

```typescript
interface Invocation {

  id: string;

  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "timeout";


  startedAt?: number;

  completedAt?: number;


  cancel(): void;


  subscribe(handler): void;


  wait(): Promise<InvocationResult>;


  result():
    | InvocationResult
    | undefined;


  events():
    AsyncIterable<CapabilityEvent>;
}
```

All consumers operate on Invocation.

No consumer receives executor-specific handles.

---

# 10. CapabilityContext

Every executor receives the same context.

```typescript
interface CapabilityContext {

  invocationId: string;

  requestId: string;

  actor: string;

  permissions: string[];

  cwd: string;

  workspace: string;

  sessionId: string;

  cancellationToken: AbortSignal;

  logger: Logger;

  eventBus: EventBus;

  progressReporter: ProgressReporter;
}
```

This provides a single integration point for:

* governance
* auditing
* policy enforcement
* metrics
* cancellation
* progress reporting

---

# 11. ExecutorRegistry

Executors are pluggable implementations.

Example:

```typescript
executors.register(
  "native",
  NativeExecutor
);

executors.register(
  "tool",
  ToolExecutor
);

executors.register(
  "daemon",
  DaemonExecutor
);

executors.register(
  "agent",
  AgentExecutor
);

executors.register(
  "cli",
  CliAdapter
);
```

Future:

```
docker
kubernetes
remote
sandbox
worker
```

Executors are implementation details.

They are not capability identities.

---

# 12. EventBus

The EventBus provides platform-wide observation.

Events:

```
CapabilityRegistered

CapabilityRemoved

InvocationStarted

InvocationProgress

InvocationOutput

InvocationCompleted

InvocationFailed

InvocationCancelled

PermissionDenied

AvailabilityChanged
```

Streaming is a consumer of EventBus.

It is not a separate execution mechanism.

The daemon protocol transports these same events externally.

---

# 13. CapabilityGraph

CapabilityGraph is a projection.

Source:

```
Capability.dependencies[]
```

Purpose:

* visualization
* dependency analysis
* health propagation
* impact analysis
* workflow planning

It is:

* not authoritative
* not stored separately
* rebuildable anytime

---

# 14. InvocationStore

Invocation persistence is intentionally separate.

Future consumers:

* dashboards
* replay
* audit history
* analytics

Architecture:

```
Runtime
   |
   creates
   |
Invocation
   |
   consumed by
   |
InvocationStore
```

Phase 1 does not implement persistence.

---

# 15. Phase 1 Scope

## Included

### Capability Core

* Capability interface
* CapabilityRegistry
* registration API
* metadata querying
* export manifest

### Execution Core

* ExecutionResolver
* ExecutionPlan
* CapabilityRuntime
* Invocation lifecycle

### Executor Infrastructure

* ExecutorRegistry
* native executor
* existing tool executor adapter

### Observation

* EventBus
* invocation events

### Initial Capabilities

Migration of existing ALiX functionality into capability definitions.

---

# 16. Phase 1 Non-Goals

Not included:

* TUI UI components
* Capability Explorer
* Command Palette
* Plugin loading framework
* Remote execution
* Docker execution
* Kubernetes execution
* CapabilityGraph UI
* Invocation persistence
* Workflow composition engine

---

# 17. Phase 2 Consumers

Phase 2 builds interfaces.

## Capability Explorer

Primary interface:

* searchable capability catalog
* documentation
* schemas
* examples
* permissions
* availability
* dependencies
* execution history

Actions:

```
Enter → invoke

Tab → documentation
```

---

## Command Palette

Accelerator interface:

```
Ctrl+P

/
```

Uses:

```
registry.query()

runtime.invoke()
```

Nothing else.

---

# 18. Final Architecture Statement

ALiX Capability Platform consists of:

```
CapabilityRegistry
        +
ExecutionResolver
        +
ExecutionPlan
        +
CapabilityRuntime
        +
ExecutorRegistry
        +
EventBus
```

Together they provide:

**Discovery → Resolution → Execution → Observation**

Everything else is a consumer.

The platform is the foundation.
The interfaces are views of the platform.

