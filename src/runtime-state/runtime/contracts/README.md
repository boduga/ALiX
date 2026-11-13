# Runtime Contracts

## Overview

The M1/X-series contract surface: type-only modules that pin the shape of runtime state, events, tools, providers, memory, context, observability, and governed execution. Each file re-exports concrete types from its implementation module (for example `agent-contract.ts` aliases `src/planning/autonomy/scope-tracker.ts` and `state-machine.ts`) and adds a `const` assertion object that acts as a compile-time and documentary anchor for the invariants it describes. The implementation modules remain the reference; these contracts are the interface that consumers code against and that must not drift (`agent-contract.ts:AgentState`, `event-contract.ts:EVENT_IMMUTABILITY`).

Most files contain no runtime logic. The exceptions are `execution-intent-contract.ts`, which implements canonical hashing and status derivation, and `execution-runtime-contract.ts`, which defines the execution state enum and error classes.

## Interface

- `AgentState`, `TaskScope`, `Expansion`, `ChangeEvaluation`, `RunLimits`, `RunCounters`, `RunResult`, `StateSnapshot` — re-exported agent lifecycle types (`agent-contract.ts:AgentState`).
- `ScopeTrackerContract`, `RunLimiterContract`, `TaskStateMachineContract`, `RunTransitionContext` — behavioural interfaces mirroring the concrete autonomy classes (`agent-contract.ts:ScopeTrackerContract`, `agent-contract.ts:TaskStateMachineContract`).
- `AGENT_INVARIANTS` — singleton asserting the ten-state closed set and mutation rules (`agent-contract.ts:AGENT_INVARIANTS`).
- `AlixEvent`, `EventActor`, `EventMeta`, `NewEvent`, `EventLogContract`, `EventLogListener`, `EVENT_IMMUTABILITY` — append-only event log contract (`event-contract.ts:EventLogContract`, `event-contract.ts:EVENT_IMMUTABILITY`).
- `TOOL_EVENT_TYPES`, `PATCH_EVENT_TYPES`, `FILE_EVENT_TYPES`, `AGENT_EVENT_TYPES`, `MCP_EVENT_TYPES`, `OWNERSHIP_EVENT_TYPES`, `COORDINATION_EVENT_TYPES`, `COLLABORATION_EVENT_TYPES`, `CONFLICT_EVENT_TYPES`, `SUBAGENT_EVENT_TYPES`, `CONTEXT_EVENT_TYPES`, `POLICY_EVENT_TYPES`, `ARTIFACT_EVENT_TYPES`, `APPROVAL_EVENT_TYPES`, `REPLAY_EVENT_TYPES`, `ROLLBACK_EVENT_TYPES` — canonical event-type constants re-exported from the event implementation (`event-contract.ts` re-export block).
- `ModelCapabilities`, `TokenUsage`, `CostProfile`, `NormalizedMessage`, `ModelAdapter`, `ProviderResult`, `ProviderInfo`, `ProviderRegistry`, `ProviderAvailability`, `ProviderSelectionMetadata`, `SELECTION_METADATA_INVARIANT` — provider adapter and registry contract (`provider-contract.ts:ProviderRegistry`, `provider-contract.ts:ProviderSelectionMetadata`).
- `ToolName`, `ToolCallRequest`, `ToolResult`, `ToolArgs`, `FileMatch`, `TOOL_SAFETY_BOUNDARY` — descriptive tool protocol types (`tool-contract.ts:ToolResult`, `tool-contract.ts:TOOL_SAFETY_BOUNDARY`).
- `MemoryType`, `MemoryEntry`, `MemoryConfig`, `DEFAULT_MEMORY_CONFIG`, `MemoryQuery`, `MemoryStoreContract`, `MEMORY_INVARIANTS` — memory store contract and defaults (`memory-contract.ts:MemoryStoreContract`, `memory-contract.ts:DEFAULT_MEMORY_CONFIG`).
- `ALiXContext`, `ContextTransfer`, `CONTEXT_INVARIANTS` — context identity, ownership, and transfer records (`context-contract.ts:ALiXContext`, `context-contract.ts:ContextTransfer`).
- `RuntimeEvidence`, `GovernanceEvidenceFilter`, `OBSERVABILITY_INVARIANTS` — observability evidence record and governance bridge (`observability-contract.ts:RuntimeEvidence`, `observability-contract.ts:GovernanceEvidenceFilter`).
- `ExecutionIntent`, `ExecutionIntentStatus`, `ExecutionIntentEvent`, `ExecutionConstraints`, `ExecutionEvidence`, `createIntentId`, `createIntentHash`, `deriveIntentStatus`, `EXECUTION_INTENT_INVARIANTS` — immutable intent document plus deterministic hashing (`execution-intent-contract.ts:ExecutionIntent`, `execution-intent-contract.ts:createIntentHash`, `execution-intent-contract.ts:deriveIntentStatus`).
- `ExecutionState`, `ExecutionContext`, `ExecutionResult`, `ExecutionEventType`, `ExecutionEvidenceEmitter`, `RetryPolicy`, `BackoffStrategy`, `RollbackIntent`, `ExecutionRuntime` — governed execution lifecycle (`execution-runtime-contract.ts:ExecutionState`, `execution-runtime-contract.ts:ExecutionRuntime`).
- `IllegalStateTransitionError`, `UnknownExecutionError`, `DuplicateExecutionError` — runtime error classes (`execution-runtime-contract.ts:IllegalStateTransitionError`, `execution-runtime-contract.ts:DuplicateExecutionError`).

## Invariants

- The agent state set is closed at ten states, exactly one state is active at a time, `stopped` is a terminal sink, and scope governs mutation (`agent-contract.ts:AGENT_INVARIANTS`).
- Run limits (`maxIterations`, `maxRepairs`, `maxRuntimeMs`) are checked at every transition; the contract has no post-hoc runtime validator (`agent-contract.ts:AgentInvariantsAssertion`).
- A mutation outside the initial scope yields `scope_expansion` and must be resolved via `approveScope`/`denyScope` before execution proceeds (`agent-contract.ts:ScopeTrackerContract.checkMutation`).
- Event logs are append-only: no rewrite, delete, or mutation; `seq` is monotonic and `id` is write-once (`event-contract.ts:EVENT_IMMUTABILITY`).
- `EventLogContract.append` accepts everything except `id`, `seq`, `version`, and `timestamp`, which the log assigns (`event-contract.ts:EventLogContract.append`).
- Tool types describe capability only; permission is granted by a separate security layer, and `ToolResult` must be narrowed on `kind` before field access (`tool-contract.ts:TOOL_SAFETY_BOUNDARY`).
- `ToolName` derives from `ALIX_BUILTIN_EXECUTORS` and holds internal dispatch ids; model-facing `alix_*` names are resolved before reaching this layer (`tool-contract.ts:ToolName`).
- Provider adapters are immutable after construction; registry listings are deterministic and selection metadata never embeds ranking (`provider-contract.ts:ProviderRegistry`, `provider-contract.ts:SELECTION_METADATA_INVARIANT`).
- Memory identity is `name` + `type`; `createdAt` is append-only; `confidence` is monotonic; exactly four types exist; saving the same identity updates rather than duplicates (`memory-contract.ts:MEMORY_INVARIANTS`).
- `MemoryConfig.decayDays` must be positive when decay is enabled (`memory-contract.ts:MemoryConfig`).
- Context `contextId` and `kind` are immutable after creation, every context has exactly one `ownerId`, and transfers list explicit data keys (`context-contract.ts:CONTEXT_INVARIANTS`).
- Observability evidence is append-only and identity-immutable; `governanceRelevant` is the sole gate for governance forwarding, and empty `traceIds` is valid (`observability-contract.ts:OBSERVABILITY_INVARIANTS`).
- Execution intents carry no `status` field; status is derived from the append-only event stream, and an empty stream throws (`execution-intent-contract.ts:ExecutionIntent`, `execution-intent-contract.ts:deriveIntentStatus`).
- `createIntentHash` hashes `"alix-execution-v1:"` plus canonical sorted-key JSON with SHA-256, so identical inputs always produce the same digest (`execution-intent-contract.ts:createIntentHash`).
- `createIntentId` truncates the SHA-256 hex digest to 16 characters (`execution-intent-contract.ts:createIntentId`).
- Synthesized governor approvals use `authorizationSource: "system"`, never `"operator"` (`execution-intent-contract.ts:ExecutionIntent`).
- Terminal execution states (`SUCCEEDED`, `FAILED`, `CANCELLED`, `ROLLED_BACK`) are immutable, and every transition emits evidence (`execution-runtime-contract.ts:ExecutionRuntime`).
- Cancellation is allowed only from `READY` or `RUNNING`; rollback only from `FAILED`; `RetryPolicy.maxAttempts` is at least 1 (`execution-runtime-contract.ts:ExecutionRuntime.cancel`, `execution-runtime-contract.ts:RetryPolicy`).
- X4 controls execution mechanics only; governance stays observational and external (`execution-runtime-contract.ts` module header).

## Side Effects

- None from the type-only modules (`agent-contract.ts`, `context-contract.ts`, `event-contract.ts`, `memory-contract.ts`, `observability-contract.ts`, `provider-contract.ts`, `tool-contract.ts`).
- `createIntentId` and `createIntentHash` read the system clock only when `createIntentId` is called without a timestamp (`execution-intent-contract.ts:createIntentId`).
- `createIntentHash` uses `node:crypto` `createHash` and `canonicalStringify`; it performs no I/O (`execution-intent-contract.ts:createIntentHash`).
- Constructing the runtime errors sets `name`, `kind`, and identifier fields; no I/O (`execution-runtime-contract.ts:IllegalStateTransitionError`).

## Verification

- Run: `pnpm test`
