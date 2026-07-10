# M1 — Runtime Contract Standardization Design Spec

**Date:** 2026-07-10
**Status:** Design
**Phase:** M1 — Runtime Contract Standardization
**Depends on:** Existing ALiX Runtime (src/agent/, src/providers/, src/tools/, src/mcp/, src/events/, src/autonomy/)
**Checkpoint target:** `alix-m1-runtime-contract-standardization-complete`

---

## 1. Primary Invariant

M1 extracts stable interfaces from existing runtime implementations. It never rewrites, replaces, or duplicates existing runtime code. Every contract produced by M1 must be implementable by the code that already exists.

M1 produces **contracts**, not implementations. The contracts are TypeScript interfaces and type definitions that formalize what the runtime already does — enabling downstream layers (P11.9, X-series, A-series) to depend on stable abstractions rather than coupling to implementation internals.

---

## 2. Purpose

The ALiX runtime has evolved organically through P-series implementation. Agent lifecycle, provider routing, tool execution, MCP integration, event recording, memory, and autonomy controls all exist as working code — but without formal contracts that downstream consumers can reliably depend on.

M1 extracts and formalizes those contracts:

- What is an agent? What states can it be in? What owns it?
- What is a provider? What capabilities does it declare? How is it routed?
- What is a tool? How does it declare capabilities? What is its provenance?
- What is an event? What schema does it follow? How is it correlated?
- What is a context? What owns it? How is it transferred?
- What is a memory? How is it stored? How is it retrieved?
- How does the runtime produce evidence for governance?

---

## 3. Existing Capability Inventory

The following already exist and are NOT being built by M1:

| Area | Files | Existing Capabilities |
|------|-------|----------------------|
| Agent Runtime | src/agent/ | Agent creation, execution loop, streaming, messages, sub-agent spawning, mutations |
| Providers | src/providers/ | 15 LLM providers, registry, discovery, circuit breakers, capability metadata, health checks, spec validation |
| Tools | src/tools/ | Tool registry, executor, routing, file/shell/web tools, collaboration tools, safety wrappers, capability map |
| MCP | src/mcp/ | Client, server lifecycle, discovery, tool catalog, provenance, selection, transport abstraction, caching |
| Events | src/events/ | Event log, event types, append-only recording |
| Autonomy | src/autonomy/ | State machine, scope tracking, run limits |
| Memory | src/utils/memory/ | Memory store, recall, context building |

M1 does NOT rebuild any of these. It formalizes their interfaces so downstream consumers can depend on contracts instead of implementations.

---

## 4. Core Boundary

M1 is explicitly prohibited from:

- rewriting existing runtime code
- duplicating existing runtime modules
- replacing existing runtime implementations
- adding new runtime capabilities
- bypassing P14–P30 governance
- creating execution engine logic (deferred to X-series)
- creating autonomous evolution logic (deferred to A-series)
- adding provider implementations (deferred to provider ecosystem)

M1 produces contracts. Downstream consumers implement against those contracts.

---

## 5. M1.1 — Agent Runtime Contract

**Source:** `src/autonomy/scope-tracker.ts`, `src/autonomy/state-machine.ts`, `src/agent/agent.ts`

### 5.1 Agent State

```typescript
// Source: src/autonomy/scope-tracker.ts (line 7)
export type AgentState =
  | "idle"
  | "planning"
  | "executing"
  | "verifying"
  | "repairing"
  | "summarizing"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "stopped";
```

### 5.2 Agent Identity Context

```typescript
// Source: src/agent/agent.ts (line 20+)
export type AgentContext = {
  sessionId: string;
  sessionDir: string;
  log: EventLog;
  config: Awaited<ReturnType<typeof loadConfig>>;
  provider: ModelAdapter;
  editFormatPolicy: ReturnType<typeof buildEditFormatPolicy>;
  mcpManager: McpManager | null;
  // ... additional fields
};
```

### 5.3 Run Controls

```typescript
// Source: src/autonomy/state-machine.ts
export type RunLimits = {
  maxIterations: number;
  maxRepairs: number;
  maxFileChanges: number;
  maxShellCommands: number;
  maxRuntimeMs: number;
};

export type RunCounters = {
  iterations: number;
  repairs: number;
  fileChanges: number;
  shellCommands: number;
  runtimeMs: number;
};

export type StateSnapshot = {
  state: AgentState;
  counters: RunCounters;
};

export type RunResult = {
  success: boolean;
  reason: string;
  state: AgentState;
  counters: RunCounters;
};
```

### 5.4 Scope Tracker

```typescript
// Source: src/autonomy/scope-tracker.ts
export type TaskScope = {
  goal: string;
  files: string[];
  approvedAt?: string;
};

export type ScopeSnapshot = {
  scope: TaskScope | undefined;
  expansions: Expansion[];
  approvedPaths: string[];
  deniedPaths: string[];
  pendingApproval: string | null;
};
```

---

## 6. M1.2 — Provider Contract

**Source:** `src/providers/types.ts`, `src/providers/base.ts`, `src/providers/registry.ts`

### 6.1 Model Capabilities

```typescript
// Source: src/providers/types.ts
export type ModelCapabilities = {
  provider: string;
  model: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  effectiveContextBudget?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type CostProfile = {
  currency: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  inputTiers?: CostTier[];
  outputTiers?: CostTier[];
};

export type NormalizedMessage = {
  role: "user" | "assistant";
  content: string | ContentPart[];
};
```

### 6.2 Provider Interface

```typescript
// Source: src/providers/base.ts
export interface ModelAdapter {
  readonly provider: string;
  readonly model: string;
  complete(messages: NormalizedMessage[], opts?: CompleteOptions): Promise<ProviderResult>;
  stream?(messages: NormalizedMessage[], opts?: CompleteOptions): AsyncIterable<ProviderChunk>;
  embed?(texts: string[]): Promise<number[][]>;
}

export type ProviderResult = {
  message: NormalizedMessage;
  usage: TokenUsage;
  cost?: number;
  finishReason?: string;
};

export type CompleteOptions = {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  structuredOutput?: Record<string, unknown>;
};
```

### 6.3 Provider Registry

```typescript
// Source: src/providers/registry.ts
export interface ProviderRegistry {
  getProvider(model: string): ModelAdapter;
  hasProvider(model: string): boolean;
  listProviders(): string[];
  getCapabilities(model: string): ModelCapabilities | null;
}
```

---

## 7. M1.3 — Tool Contract

**Source:** `src/tools/types.ts`, `src/tools/executor.ts`, `src/tools/tool-registry.ts`

### 7.1 Tool Call Request

```typescript
// Source: src/tools/types.ts
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
};
```

### 7.2 Tool Result

```typescript
// Source: src/tools/types.ts — discriminated union
export type ToolResult =
  | { kind: "success"; content?: string; output?: string; value?: string;
      matches?: FileMatch[]; changedFiles?: string[]; exitCode?: number;
      createdPath?: string; deletedPath?: string; exists?: boolean; completed?: boolean }
  | { kind: "error"; message: string; retryable?: boolean; hint?: string };
```

### 7.3 Tool Names & Typed Args

```typescript
// Source: src/tools/types.ts
export type ToolName = "file.read" | "file.create" | "file.delete" | "file.exists"
  | "dir.search" | "shell.run" | "patch.apply" | "done";

export type ToolArgs = {
  "file.read": { root: string; path: string };
  "dir.search": { root: string; pattern: string; extensions: string[] };
  "shell.run": { command: string; cwd: string; timeoutMs?: number };
  "patch.apply": { root: string; format: string; patchText: string };
};
```

---

## 8. M1.4 — Event Contract

**Source:** `src/events/types.ts`, `src/events/event-log.ts`

### 8.1 Core Event

```typescript
// Source: src/events/types.ts (line 12)
export type EventActor = "user" | "agent" | "system" | "tool" | "policy" | "verifier" | "subagent" | "authorization" | "coordination";

export type EventMeta = {
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  traceId?: string;
  spanId?: string;
  replayId?: string;
};

export type AlixEvent<TType extends string = string, TPayload = unknown> = {
  id: string;
  seq: number;
  version: 1;
  sessionId: string;
  runId?: string;
  parentEventId?: string;
  timestamp: string;
  type: TType;
  actor: EventActor;
  payload: TPayload;
  meta?: EventMeta;
};

export type NewEvent<TType extends string = string, TPayload = unknown> = Omit<
  AlixEvent<TType, TPayload>,
  "id" | "seq" | "version" | "timestamp"
>;
```

### 8.2 Event Type Categories

```typescript
// Source: src/events/types.ts
// 15+ event type categories with typed payloads:
// TOOL:    tool.requested, tool.started, tool.output, tool.completed, tool.failed
// PATCH:   patch.proposed, patch.applied, patch.rolled_back, etc.
// FILE:    file.created, file.deleted
// AGENT:   agent.message, agent.reasoning, agent.decision
// MCP:     mcp.tool_invoked
// OWNER:   ownership.acquired, ownership.released, ownership.conflict, etc.
// COORD:   coordination.aggregate.*, coordination.synthesis.*
// COLLAB:  collaboration.finding.*, collaboration.artifact.*, collaboration.tool.*
// CONFLICT: collaboration.conflict.*
// CONTEXT: context.repo_map_created, context.bundle_created, etc.
// POLICY:  policy.decision, approval.requested, approval.resolved
// APPROVAL: approval.created, .resolved, .expired, .revoked, etc.
// REPLAY:  replay.* lifecycle events
// ROLLBACK: rollback.* lifecycle events
```

### 8.3 Event Log Interface

```typescript
// Source: src/events/event-log.ts
export interface EventLogContract {
  readonly path: string;
  init(): Promise<void>;
  append<TType extends string, TPayload>(event: NewEvent<TType, TPayload>): Promise<AlixEvent<TType, TPayload>>;
  readAll(): Promise<AlixEvent[]>;
  close(): Promise<void>;
  watch(listener: (event: AlixEvent) => void): void;
  unwatch(listener: (event: AlixEvent) => void): void;
}
```

This contract directly enables P23 replay, P24 drift detection, and P30 lineage by standardizing event fields that governance already consumes.

---

## 9. M1.5 — Context Contract

### 9.1 Context Identity

```typescript
export interface ALiXContext {
  contextId: string;
  kind: "task" | "session" | "execution" | "governance";
  ownerId: string;
  parentContextId: string | null;
  createdBy: string;
  createdAt: string;
  data: Record<string, unknown>;
}
```

### 9.2 Context Transfer

```typescript
export interface ContextTransfer {
  contextId: string;
  fromAgentId: string;
  toAgentId: string;
  transferredAt: string;
  includesData: string[];     // which top-level keys were transferred
}
```

---

## 10. M1.6 — Memory Contract

**Source:** `src/utils/memory/types.ts`, `src/utils/memory/store.ts`, `src/utils/memory/recall.ts`

### 10.1 Memory Entry

```typescript
// Source: src/utils/memory/types.ts
export type MemoryType = "user" | "project" | "feedback" | "reference";

export type MemoryEntry = {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  createdAt: string;
  modifiedAt: string;
  confidence: number;    // 0.0-1.0, starts at 0.5
  confirmations: number;
  source?: string;
};
```

### 10.2 Memory Config

```typescript
// Source: src/utils/memory/types.ts
export type MemoryConfig = {
  decayEnabled: boolean;
  decayDays: number;
  maxEntriesPerType: number;
  consolidateSchedule: "daily" | "weekly" | "manual";
  indexMaxLines: number;
};
```

### 10.3 Memory Store Interface

```typescript
// Source: src/utils/memory/store.ts
export interface MemoryStoreContract {
  save(entry: MemoryEntry): Promise<void>;
  read(name: string): Promise<MemoryEntry | null>;
  query(type: MemoryType, pattern?: string): Promise<MemoryEntry[]>;
  delete(name: string): Promise<boolean>;
  list(): Promise<MemoryEntry[]>;
  consolidate(): Promise<void>;
}
```

---

## 11. M1.7 — Runtime Observability Contract

### 11.1 Evidence Bridge

```typescript
export interface RuntimeEvidence {
  eventId: string;
  timestamp: string;
  sourceType: string;
  description: string;
  governanceRelevant: boolean;
  traceIds: string[];
}
```

This bridge connects the runtime to P14–P30 governance, ensuring every runtime event that governance needs (replay, lineage, audit) can be correlated.

---

## 12. Module Boundaries

### 12.1 Created Files

| Slice | File | Purpose |
|-------|------|---------|
| M1.1 | `src/runtime/agent-contract.ts` | Agent identity, lifecycle, capabilities |
| M1.2 | `src/runtime/provider-contract.ts` | Provider contract, capability, health |
| M1.3 | `src/runtime/tool-contract.ts` | Tool contract, provenance, result |
| M1.4 | `src/runtime/event-contract.ts` | Universal event model, correlation |
| M1.5 | `src/runtime/context-contract.ts` | Context identity, transfer |
| M1.6 | `src/runtime/memory-contract.ts` | Memory provider, entry, query |
| M1.7 | `src/runtime/observability-contract.ts` | Runtime evidence bridge |
| M1.0 | `docs/architecture/specs/<date>-m1-0-*.md` | Design spec |

Note: Contracts are placed in `src/runtime/` — a new top-level directory for M-series contracts, separate from existing `src/agent/`, `src/providers/`, etc. which hold implementations.

### 12.2 Touched Files

None. M1 does not modify existing implementation code.

### 12.3 Untouched Files

- All files in `src/agent/`, `src/providers/`, `src/tools/`, `src/mcp/`, `src/events/`, `src/autonomy/`, `src/utils/memory/`

---

## 13. Testing Plan

Each contract file gets a type-level test verifying the documented types match the actual source types.

### M1.1–M1.7 — Contract Tests (7 tests)

1. AgentState type matches `src/autonomy/scope-tracker.ts` (10 states: idle, planning, executing, verifying, repairing, summarizing, waiting_approval, completed, failed, stopped)
2. RunLimits/RunResult types match `src/autonomy/state-machine.ts`
3. ModelCapabilities/CostProfile types match `src/providers/types.ts`
4. ToolCallRequest/ToolResult types match `src/tools/types.ts`
5. AlixEvent generic type matches `src/events/types.ts`
6. EventLogContract interface matches `src/events/event-log.ts`
7. MemoryEntry/MemoryConfig types match `src/utils/memory/types.ts`

**Total: 7 tests.**

---

## 14. M1 Seal Criteria

- All 7 tests pass
- No existing runtime code is modified
- No runtime implementations are duplicated
- All contracts can be satisfied by existing runtime code
- tsc clean
- Tag: `alix-m1-runtime-contract-standardization-complete`

---

## 15. Proposed Slice Plan

```text
M1.0 — Design Spec
M1.1 — Agent Runtime Contract (src/runtime/agent-contract.ts) — 1 test
M1.2 — Provider Contract (src/runtime/provider-contract.ts) — 1 test
M1.3 — Tool Contract (src/runtime/tool-contract.ts) — 1 test
M1.4 — Event Contract (src/runtime/event-contract.ts) — 1 test
M1.5 — Context Contract (src/runtime/context-contract.ts) — 1 test
M1.6 — Memory Contract (src/runtime/memory-contract.ts) — 1 test
M1.7 — Observability Contract (src/runtime/observability-contract.ts) — 1 test
M1.8 — Checkpoint
```

---

## 16. Next Steps

```text
M1.0 — Runtime Contract Standardization Design Spec
```

This document is M1.0.
