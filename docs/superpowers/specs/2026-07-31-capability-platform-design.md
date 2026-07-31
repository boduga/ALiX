# ALiX Capability Platform — Design Spec

**Status:** Draft  
**Date:** 2026-07-31  
**Origin:** Wayfinder map #308 ("Everything from the TUI") — evolved from "a command palette" into an execution platform. All decisions below confirmed through brainstorming with the operator.

---

## 1. Destination

A reusable execution substrate: the **Capability Platform**. ALiX becomes self-aware of its own functions through a declarative capability registry, and every interface — TUI, CLI, Web UI, MCP server, slash commands, agents, plugins — is a thin consumer of the same discovery/routing/execution/observation core. The TUI's Capability Explorer and Command Palette are the first two consumers (Phase 2).

## 2. Architecture

```
Capability Definitions  (pure data — registerCapability)
        │
        ▼
CapabilityRegistry     ← what exists?       metadata + discovery
        │
        ▼
ExecutionResolver      ← how should this invocation run?  routing → plan
        │
        ▼
ExecutionPlan          ← the resolved plan (executor, timeout, hooks, policy)
        │
        ▼
CapabilityRuntime      ← how is it run?     invocation lifecycle (stateless)
        │
        ▼
ExecutorRegistry       ← who executes?      pluggable backends
        │
        ▼
EventBus               ← who observes?      system-wide events
```

**Five core responsibilities:**
- **CapabilityRegistry** — answers *what exists?*
- **ExecutionResolver** — answers *how should this invocation execute?*
- **CapabilityRuntime** — answers *how is it run?*
- **ExecutorRegistry** — answers *who executes it?*
- **EventBus** — answers *who observes it?*

**Derived consumers** (not core): `CapabilityGraph` (dependency projection), search index, documentation, the Explorer, the Palette.

## 3. Capability — pure data contract

```typescript
interface Capability {
  id: string;                       // namespaced: "core.session.list"
  version: string;
  kind: "core"|"tool"|"skill"|"custom"|"workflow"|"plugin";
  title: string;
  description: string;
  aliases?: string[];
  tags: string[];
  category: string;
  risk: "low"|"medium"|"high"|"critical";
  permissions: "operator"|"admin"|"developer"|"internal";
  argsSchema?: JSONSchema;
  resultSchema?: JSONSchema;
  examples?: string[];
  execution: {
    strategy: string;               // "native"|"tool"|"daemon"|"agent"|"cli"|"docker"|...
    timeout?: number;               // ms
    cancellable?: boolean;
  };
  dependencies?: string[];          // metadata only: "git.commit"
  extensions?: Record<string, unknown>;
}
```

- **Fully serializable** — `registry.export()` produces the whole registry with zero stripping. No functions.
- **No runtime state in metadata.** Hooks (`validate`, `canInvoke`, `beforeInvoke`, `afterInvoke`, `cancel`) register against the runtime/executor layer keyed by capability id — never embedded in the data.

### 3.1 CapabilityStatus — separated runtime state

Dynamic state lives in a separate record, never mutating the registry:

```typescript
interface CapabilityStatus {
  capabilityId: string;
  availability: "available" | "unavailable" | "degraded";
  health: "healthy" | "warning" | "error";
  lastChecked: number;
}
```

Allows plugins to unload, daemons to disconnect, Docker to stop, remote services to disappear — without touching the registry. The runtime/executor publishes `AvailabilityChanged` events on change.

## 4. CapabilityRegistry — metadata only

```
register(cap)
unregister(id)
find(id): Capability | undefined
query({ text, tags, category, risk, permissions, kinds, namespaces }): Capability[]
list(): Capability[]
describe(id): Capability | undefined
reload()            // hot-reload custom commands / plugins
watch(cb)           // registration-change subscription
export(): ManifestJSON
```

No execution. Namespaces (`core.`, `tool.`, `git.`, `workflow.`, `plugin.`) participate in discovery, filtering, permissions, and docs.

## 5. ExecutionResolver — routing rules → ExecutionPlan

Answers *"given capability X and this invocation context, what actually runs?"* Produces an `ExecutionPlan`, not raw dispatch:

```typescript
interface ExecutionPlan {
  executor: string;                 // resolved strategy
  timeout: number;
  hooks: Array<HookName>;           // validate, canInvoke, beforeInvoke, afterInvoke, cancel
  permissions: string[];
  retryPolicy?: { attempts: number; backoffMs: number };
  scheduling?: unknown;             // reserved for future batching/scheduling
}
```

Routing rules live here, not in the runtime. Examples: `core.session.list → native`, `tool.file.read → tool`, `git.commit → cli`, `workflow.release → workflow`, `plugin.foo.bar → plugin`. Testable in isolation.

**Composition note:** a capability may eventually resolve into one *or more* execution plans (workflows, fan-out). The resolver's contract returns `ExecutionPlan[]` to leave that door open without changing any API today.

## 6. CapabilityRuntime — invocation lifecycle, intentionally stateless

```
invoke(id, args, ctx): Invocation
cancel(invocationId)
subscribe(handler)
registerHooks(id, { validate, canInvoke, beforeInvoke, afterInvoke, cancel })
```

- Executes `ExecutionPlan`s produced by the resolver — it does **not** interpret capabilities directly.
- **Stateless**: does not own invocation storage. It creates `Invocation`s; a separate `InvocationStore` tracks them (history, replay, persistence, web dashboards). The store is a consumer-side concern, not part of the core runtime.

## 7. Invocation — first-class object

```typescript
interface Invocation {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";
  startedAt?: number;
  completedAt?: number;
  cancel(): void;
  subscribe(handler): void;
  wait(): Promise<InvocationResult>;
  result(): InvocationResult | undefined;
  events(): AsyncIterable<CapabilityEvent>;
}
```

Every consumer (CLI, daemon, TUI, web) deals with `Invocation`, never executor-specific handles.

## 8. CapabilityContext — passed to every invocation

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

Governance, auditing, progress, and cancellation have a consistent home.

## 9. ExecutorRegistry — pluggable backends

```typescript
executors.register("native", NativeExecutor)
executors.register("tool", ToolExecutor)
executors.register("daemon", DaemonExecutor)
executors.register("agent", AgentExecutor)
executors.register("cli", CliAdapter)    // adapter, NOT canonical
```

Open for future backends (`docker`, `kubernetes`, `remote`) without touching the capability model. Executors are drivers, not identities — a strategy like `native` may later dispatch to local/sandboxed/worker-thread variants behind the same `ExecutionPlan.executor` key.

## 10. EventBus — generic system observation

One event stream, published by the platform, subscribed by all consumers:

```
CapabilityRegistered | CapabilityRemoved
InvocationStarted | InvocationProgress | InvocationOutput
InvocationCompleted | InvocationFailed | InvocationCancelled
PermissionDenied | AvailabilityChanged
```

Streaming is one consumer of the event system, not a separate mechanism. The daemon protocol (wayfinder #313: `invoke` envelope, `invoke.output`/`completed`/`failed`/`not_found`/`timeout` events, cancel by requestId) carries these events over the socket; in-process consumers get them directly.

## 11. Derived: CapabilityGraph

A projection over registry `dependencies` metadata — rebuilt from the registry at any time. Enables dependency visualization, health propagation, impact analysis, workflow composition. **Not a core component, not a second source of truth.** Lives alongside the Explorer, search index, and documentation as a consumer of the registry.

## 12. InvocationStore (consumer-side, Phase-appropriate)

Tracks invocation history. Enables replay, persistence, and dashboards later. The runtime creates invocations; the store records them. Out of core scope for Phase 1, referenced here to keep the runtime's stateless contract explicit.

---

## Phase 2 (separate spec): TUI Capability UI

Two consumers of the same platform:
- **Capability Explorer** — persistent tab, the *primary* interface. Searchable catalog with docs, examples, permissions, execution, availability, dependencies, history. Enter executes, Tab docs.
- **Command Palette** — Ctrl+P and `/` prefix, the *accelerator* into the same platform.

Both call `registry.query()` + `runtime.invoke()` only. Nothing else.

## Non-goals (Phase 1)

- No TUI coupling — the platform is a library with no UI assumptions
- No plugin *loading* system (registration API only; plugins can register)
- No `CapabilityGraph` beyond the derived projection
- No `InvocationStore` persistence (API surface referenced only)
- No composition / multi-plan execution (reserved via `ExecutionPlan[]`)
- No remote execution backends

## Dependencies

- Wayfinder #312 — manifest schema (superseded by this richer capability model; `registry.export()` is the optional serialization)
- Wayfinder #313 — daemon `invoke` protocol, adopted as the `daemon` executor's wire format
- Wayfinder #314 — palette UX (Phase 2)
- Wayfinder #309/#310/#311 — research grounding (TUI architecture, CLI non-introspectability → `registerCapability` over `META` auto-detection, custom-command patterns → skills-loader extension)
