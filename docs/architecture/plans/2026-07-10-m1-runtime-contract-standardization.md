# M1 — Runtime Contract Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Extract stable TypeScript contracts from existing ALiX runtime implementations — formalizing the dependency boundary for P11.9, X-series, and A-series.

**Architecture:** Contracts in `src/runtime/contracts/` document existing types from `src/agent/`, `src/providers/`, `src/tools/`, `src/events/`, `src/autonomy/`, `src/utils/memory/`. No runtime code is modified. Event contract first (everything emits events, governance depends on events). All P14–P30 governance invariants preserved.

**Tech Stack:** TypeScript, node:test

## Global Constraints

- No existing runtime code is modified (`src/agent/`, `src/providers/`, `src/tools/`, `src/mcp/`, `src/events/`, `src/autonomy/`, `src/utils/memory/`)
- Contracts formalize what already exists — never new abstractions
- `src/runtime/contracts/` is the single dependency boundary for future consumers
- Once released, breaking changes require governed migration (Contract Stability Rule)
- Event contract first — everything emits events, governance depends on events
- P14–P30 governance invariants are preserved
- import type for type-only symbols
- Tests validate contracts match actual source types

---

## File Structure

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| M1.1 | `src/runtime/contracts/event-contract.ts` | AlixEvent<TType,TPayload>, EventActor, EventMeta, EventLogContract |
| M1.2 | `src/runtime/contracts/agent-contract.ts` | AgentState, RunLimits, RunCounters, StateSnapshot, RunResult, TaskScope, ScopeTracker |
| M1.3 | `src/runtime/contracts/provider-contract.ts` | ModelCapabilities, ModelAdapter, ProviderRegistry, ProviderSelectionMetadata, CostProfile |
| M1.4 | `src/runtime/contracts/tool-contract.ts` | ToolCallRequest, ToolResult, ToolName, ToolArgs, tool safety boundary |
| M1.5 | `src/runtime/contracts/context-contract.ts` | ALiXContext, ContextTransfer |
| M1.6 | `src/runtime/contracts/memory-contract.ts` | MemoryType, MemoryEntry, MemoryConfig, MemoryStoreContract |
| M1.7 | `src/runtime/contracts/observability-contract.ts` | RuntimeEvidence, governance bridge |

### Untouched Files

- All files in `src/agent/`, `src/providers/`, `src/tools/`, `src/mcp/`, `src/events/`, `src/autonomy/`, `src/utils/memory/`

---

### Task 1: M1.1 — Event Contract

**Files:**
- Create: `src/runtime/contracts/event-contract.ts`
- Test: `tests/runtime/event-contract.test.ts`

**Contract types (from `src/events/types.ts` + `src/events/event-log.ts`):**
- `EventActor` union: "user" | "agent" | "system" | "tool" | "policy" | "verifier" | "subagent" | "authorization" | "coordination"
- `EventMeta`: workflowId?, graphId?, nodeId?, traceId?, spanId?, replayId?
- `AlixEvent<TType, TPayload>`: id, seq, version, sessionId, runId?, parentEventId?, timestamp, type, actor, payload, meta?
- `NewEvent<TType, TPayload>`: Omit<AlixEvent, "id" | "seq" | "version" | "timestamp">
- `EventLogContract`: path, init(), append(), readAll(), close(), watch(), unwatch()
- Event immutability documentation (append-only, no rewrite, no delete, no mutation)
- Event type categories (15+ categories with references to source constants)

**Tests:**
1. AlixEvent generic type compiles with tool/patch/agent event payloads
2. EventLogContract interface matches EventLog class structure
3. Event immutability rules documented as type-level constants

Commit: `feat(M1.1): add runtime event contract — AlixEvent, EventActor, EventLogContract`

---

### Task 2: M1.2 — Agent Contract

**Files:**
- Create: `src/runtime/contracts/agent-contract.ts`
- Test: `tests/runtime/agent-contract.test.ts`

**Contract types (from `src/autonomy/scope-tracker.ts`, `src/autonomy/state-machine.ts`, `src/agent/agent.ts`):**
- `AgentState`: "idle" | "planning" | "executing" | "verifying" | "repairing" | "summarizing" | "waiting_approval" | "completed" | "failed" | "stopped"
- `RunLimits`, `RunCounters`, `StateSnapshot`, `RunResult`
- `TaskScope`, `ScopeSnapshot`
- `AgentContext` (sessionId, sessionDir, log, config, provider, mcpManager, etc.)

**Tests:**
1. AgentState has exactly 10 states matching scope-tracker.ts
2. RunLimits/RunResult types match state-machine.ts
3. ScopeTracker contract (setInitialScope, checkMutation, approveScope, etc.)

Commit: `feat(M1.2): add runtime agent contract — AgentState, RunLimits, ScopeTracker`

---

### Task 3: M1.3 — Provider Contract

**Files:**
- Create: `src/runtime/contracts/provider-contract.ts`
- Test: `tests/runtime/provider-contract.test.ts`

**Contract types (from `src/providers/types.ts`, `src/providers/base.ts`, `src/providers/registry.ts`):**
- `ModelCapabilities`: provider, model, inputTokenLimit, outputTokenLimit, supportsTools, supportsStreaming, supportsStructuredOutput
- `TokenUsage`, `CostProfile`, `NormalizedMessage`
- `ModelAdapter`: provider, model, complete(), stream?(), embed?()
- `ProviderResult`: message, usage, cost?, finishReason?
- `ProviderRegistry`: getProvider(), hasProvider(), listProviders(), getCapabilities()
- `ProviderSelectionMetadata`: provider, model, capabilities, availability — describes capability, never decides "best"

**Tests:**
1. ModelCapabilities type matches providers/types.ts
2. ModelAdapter interface matches providers/base.ts
3. ProviderSelectionMetadata is descriptive only (no selection logic)

Commit: `feat(M1.3): add runtime provider contract — ModelAdapter, ProviderRegistry, ProviderSelectionMetadata`

---

### Task 4: M1.4 — Tool Contract

**Files:**
- Create: `src/runtime/contracts/tool-contract.ts`
- Test: `tests/runtime/tool-contract.test.ts`

**Contract types (from `src/tools/types.ts`, `src/tools/tool-registry.ts`):**
- `ToolCallRequest`: toolCallId, name, args, agentId?, sessionId?
- `ToolResult`: discriminated union (kind "success" | "error")
- `ToolName`, `ToolArgs`
- Tool safety boundary: "tool exposes capability, security grants permission"

**Tests:**
1. ToolCallRequest type matches tools/types.ts
2. ToolResult discriminated union matches tools/types.ts
3. Tool safety boundary documented at type level

Commit: `feat(M1.4): add runtime tool contract — ToolCallRequest, ToolResult, safety boundary`

---

### Task 5: M1.5 — Context Contract

**Files:**
- Create: `src/runtime/contracts/context-contract.ts`
- Test: `tests/runtime/context-contract.test.ts`

**Contract types:**
- `ALiXContext`: contextId, kind ("task" | "session" | "execution" | "governance"), ownerId, parentContextId?, createdBy, createdAt, data
- `ContextTransfer`: contextId, fromAgentId, toAgentId, transferredAt, includesData[]

**Tests:**
1. ALiXContext has all required fields
2. ContextTransfer preserves origin and target agent IDs

Commit: `feat(M1.5): add runtime context contract — ALiXContext, ContextTransfer`

---

### Task 6: M1.6 — Memory Contract

**Files:**
- Create: `src/runtime/contracts/memory-contract.ts`
- Test: `tests/runtime/memory-contract.test.ts`

**Contract types (from `src/utils/memory/types.ts`, `src/utils/memory/store.ts`):**
- `MemoryType`: "user" | "project" | "feedback" | "reference"
- `MemoryEntry`: name, description, type, content, createdAt, modifiedAt, confidence, confirmations, source?
- `MemoryConfig`: decayEnabled, decayDays, maxEntriesPerType, consolidateSchedule, indexMaxLines
- `MemoryStoreContract`: save(), read(), query(), delete(), list(), consolidate()

**Tests:**
1. MemoryEntry type matches utils/memory/types.ts
2. MemoryConfig has all required fields
3. MemoryStoreContract interface is structurally sound

Commit: `feat(M1.6): add runtime memory contract — MemoryEntry, MemoryConfig, MemoryStoreContract`

---

### Task 7: M1.7 — Observability Contract

**Files:**
- Create: `src/runtime/contracts/observability-contract.ts`
- Test: `tests/runtime/observability-contract.test.ts`

**Contract types:**
- `RuntimeEvidence`: eventId, timestamp, sourceType, description, governanceRelevant, traceIds[]
- Links runtime events to P14–P30 governance

**Tests:**
1. RuntimeEvidence compiles with all fields
2. governanceRelevant field enables P14–P30 filtering

Commit: `feat(M1.7): add runtime observability contract — governance evidence bridge`

---

### Task 8: M1.8 — Contract Compatibility Audit

**Files:**
- Test: `tests/runtime/contract-compatibility-audit.test.ts`

**Audit checks:**
1. AgentState in contract matches `src/autonomy/scope-tracker.ts`
2. RunLimits in contract matches `src/autonomy/state-machine.ts`
3. ModelCapabilities in contract matches `src/providers/types.ts`
4. ToolCallRequest in contract matches `src/tools/types.ts`
5. AlixEvent in contract matches `src/events/types.ts`
6. EventLogContract matches `src/events/event-log.ts`
7. MemoryEntry in contract matches `src/utils/memory/types.ts`

**Tests (7):**
One test per contract verifying it can be satisfied by the actual source types.

Commit: `test(M1.8): add contract compatibility audit — verify contracts match runtime`

---

### Task 9: M1.9 — Checkpoint + Tag

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-10-m1-9-runtime-contract-standardization-checkpoint.md`

**Checklist:**
- 7 contracts created in `src/runtime/contracts/`
- Compatibility audit passes (7/7)
- No runtime code modified
- tsc clean
- All P14–P30 governance tests still pass
- Tag: `alix-m1-runtime-contract-standardization-complete`

Commit: `docs(M1.9): runtime contract standardization checkpoint`

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| M1.1 | 2 | 3 | `feat(M1.1): add runtime event contract` |
| M1.2 | 2 | 3 | `feat(M1.2): add runtime agent contract` |
| M1.3 | 2 | 3 | `feat(M1.3): add runtime provider contract` |
| M1.4 | 2 | 3 | `feat(M1.4): add runtime tool contract` |
| M1.5 | 2 | 2 | `feat(M1.5): add runtime context contract` |
| M1.6 | 2 | 3 | `feat(M1.6): add runtime memory contract` |
| M1.7 | 2 | 2 | `feat(M1.7): add runtime observability contract` |
| M1.8 | 1 | 7 | `test(M1.8): add contract compatibility audit` |
| M1.9 | 1 | — | `docs(M1.9): runtime contract standardization checkpoint` |
| **Total** | **16 files** | **26 tests** | **9 commits** |
