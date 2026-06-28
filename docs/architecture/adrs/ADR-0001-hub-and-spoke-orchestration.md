# ADR-0001: Hub-and-Spoke Orchestration

## Status

Accepted

## Context

ALiX is an AI coding agent that executes tasks in a session. The runtime must coordinate:
- Model invocation and tool execution
- Policy enforcement (capabilities, network, protected paths)
- Context compilation (repo map, symbol extraction, ranking)
- Subagent delegation and result merging
- Verification and repair loops
- Event logging for replay and diagnostics

Early explorations suggested a micro-kernel or pipe-and-filter approach. The codebase settled on a hub-and-spoke topology.

## Decision

**`run.ts` is the central orchestrator.** It imports and directly instantiates all runtime modules, owns the task state machine, and wires together:

- `PolicyEngine` — policy decisions per tool call
- `ToolExecutor` — executes tools after policy approval
- `ContextCompiler` — compiles context bundle for system prompt
- `McpManager` — manages MCP server connections and tool deferral
- `ScopeTracker` — enforces file mutation boundaries
- `SubagentManager` — spawns child processes for delegation
- `VerificationRunner` — runs post-execution checks
- `EventLog` — append-only session event log

`run.ts` owns the event loop:

```
tick → model.call(messages) → ToolExecutor.execute() → verify() → repair()
```

Each module has a focused interface. Dependencies are constructor-injected where possible, but the runtime wiring lives in `run.ts`.

## Consequences

**Positive:**
- Single place to understand the runtime flow
- Easy to trace a tool call from model output to execution
- Modules are independently testable via dependency injection
- Adding a new tool type requires only adding to `ToolExecutor.execute()` switch

**Negative:**
- `run.ts` grows with every new dependency — risk of becoming a god module
- Initialization order is implicit in `run.ts`, easy to break
- `run.ts` is hard to unit test (requires mocking 15+ modules)
- Cross-cutting concerns (events, checkpoints, policy) are woven into multiple modules

## Alternatives Considered

**Micro-kernel**: Embedding the agent in a minimal core with plugin extensions. Rejected because the tool execution pipeline is core, not plugin.

**Pipe-and-filter**: Each stage (classify → compile → execute → verify) as a pipeline. Rejected because the feedback loop (verify → repair → re-execute) breaks the linear pipeline model.

## Notes

The negative consequences are being tracked as deepening opportunities:
- Tool Execution Path refactor (extract ToolRouter interface)
- Context Pipeline coordination (separate stages)
- Policy subsystem injection (constructor-required dependencies)
- run.ts as god module (extract RuntimeBuilder)

See [CLAUDE.md](./CLAUDE.md) for current architectural work items.

**Retained decisions:**
- Event log is append-only; replay reads from log
- Checkpoints are file-based snapshots, not event-sourced
- Subagents are separate processes, not threads