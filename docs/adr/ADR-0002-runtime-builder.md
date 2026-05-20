# ADR-0002: RuntimeBuilder — Centralized Runtime Assembly

## Status

Accepted

## Context

Following [ADR-0001](./ADR-0001-hub-and-spoke-orchestration.md), `run.ts` grew as the central orchestrator accumulating module instantiation and wiring. This created several issues:

1. **Testing difficulty** — `run.ts` requires mocking 15+ modules
2. **Initialization order is implicit** — easy to break
3. **God module risk** — `run.ts` grows with every new dependency
4. **No reusable runtime** — the main CLI can't share a configured runtime with other entry points

ADR-0001 identified extracting `RuntimeBuilder` as a deepening opportunity.

## Decision

**Introduce `RuntimeBuilder` as the canonical runtime factory.** It encapsulates all module instantiation and wiring, returning a typed `Runtime` interface.

### Runtime Interface

```typescript
export interface Runtime {
  close(): Promise<void>;
  eventLog: EventLog;
  policyEngine: PolicyEngine;
  toolExecutor: ToolExecutor;
  contextCompiler: ContextCompiler;
  scopeTracker: ScopeTracker;
  subagentManager?: SubagentManager;
}
```

### Modules Wired by RuntimeBuilder

| Module | Purpose | Initialization |
|--------|---------|----------------|
| `EventLog` | Append-only session event log | Always |
| `PolicyEngine` | Policy decisions per tool call | Always |
| `ToolExecutor` | Tool execution after policy approval | Always |
| `CheckpointManager` | File-based session snapshots | Always |
| `ContextCompiler` | Context bundle compilation for prompts | Always |
| `ScopeTracker` | File mutation boundary enforcement | Always |
| `SubagentManager` | Child process delegation | Conditional (when `autonomy.enableSubagents` is set) |

### Builder Pattern

```typescript
const runtime = await new RuntimeBuilder(root)
  .withConfig(config)
  .withSession(sessionId)
  .build();

// Access modules
runtime.eventLog.append(...);
runtime.scopeTracker.checkMutation(path);
runtime.contextCompiler.compileContext(...);

// Cleanup
await runtime.close();
```

## Consequences

**Positive:**
- `run.ts` remains the primary orchestrator but delegates instantiation to `RuntimeBuilder`
- Modules are independently testable via dependency injection
- A reusable runtime can be shared between CLI, tests, and future entry points
- Initialization order is explicit and centralized
- `run.ts` shrinks — only orchestration logic remains

**Trade-offs:**
- `RuntimeBuilder` becomes a "god factory" — all dependencies must be registered there
- Optional modules (`subagentManager`) require runtime checks
- Configuration lives in two places: schema (for types) and builder (for wiring)

**Deferred:**
- Refactor `run.ts` to use `RuntimeBuilder` (tracked in post-MVP backlog)
- Add `McpManager` wiring when cache manager work is complete

## Alternatives Considered

**Pure DI container** (e.g., `tsyringe` or `awilix`): Rejected because the runtime modules are heterogeneous (event log, checkpoint manager, policy engine) and don't fit a generic container model well. The builder pattern is explicit and TypeScript-friendly.

**Factory functions per module**: Each module creates its own dependencies. Rejected because initialization order matters (event log must exist before policy engine can log).

**Singleton global runtime**: A single configured runtime for the process. Rejected because tests need isolated runtimes and the CLI may need multiple sessions.