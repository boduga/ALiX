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

### 5.1 Agent Identity

```typescript
export interface AgentIdentity {
  agentId: string;
  name: string;
  kind: string;           // e.g., "assistant", "researcher", "coder"
  createdAt: string;
  parentAgentId: string | null;  // null for root agents
  ownerId: string;
}
```

### 5.2 Agent Lifecycle

```typescript
export type AgentState =
  | "CREATED"
  | "REGISTERED"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "PAUSED"
  | "FAILED"
  | "COMPLETED"
  | "RETIRED";
```

### 5.3 Agent Capabilities

```typescript
export interface AgentCapabilities {
  providerIds: string[];
  allowedTools: string[];
  maxConcurrency: number;
  allowedSubAgents: string[];
  maxRuntimeMs: number;
}
```

### 5.4 Agent Contract Interface

```typescript
export interface AgentContract {
  identity: AgentIdentity;
  state: AgentState;
  capabilities: AgentCapabilities;
  ownedResources: string[];
  sessionId: string;
}
```

---

## 6. M1.2 — Provider Contract

### 6.1 Provider Identity

```typescript
export interface ProviderContract {
  id: string;
  name: string;
  version: string;
  capabilities: ProviderCapability[];
  health(): Promise<ProviderHealth>;
  execute(request: ProviderRequest): Promise<ProviderResponse>;
}
```

### 6.2 Provider Capability

```typescript
export interface ProviderCapability {
  name: string;
  version: string;
  models: string[];
  features: string[];     // e.g., "streaming", "tool_use", "vision"
  maxTokens: number;
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}
```

### 6.3 Provider Health

```typescript
export interface ProviderHealth {
  status: "healthy" | "degraded" | "unhealthy";
  lastChecked: string;
  responseTimeMs: number;
  errorRate: number;
}
```

---

## 7. M1.3 — Tool Contract

### 7.1 Tool Identity

```typescript
export interface ToolContract {
  name: string;
  version: string;
  kind: string;             // e.g., "file", "shell", "web", "mcp", "collaboration"
  capabilities: string[];
  provenance: ToolProvenance;
  execute(input: unknown): Promise<ToolResult>;
}
```

### 7.2 Tool Provenance

```typescript
export interface ToolProvenance {
  source: "built-in" | "mcp" | "plugin" | "custom";
  serverId?: string;         // for MCP tools
  pluginId?: string;         // for plugin tools
  registeredAt: string;
  registeredBy: string;
}
```

### 7.3 Tool Result

```typescript
export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
  durationMs: number;
  evidence?: ToolEvidence;
}
```

---

## 8. M1.4 — Event Contract

### 8.1 Universal Event

```typescript
export interface ALiXEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  source: string;
  sourceType: "agent" | "provider" | "tool" | "mcp" | "governance" | "system";
  correlationId: string;
  causationId: string | null;
  payload: Record<string, unknown>;
}
```

### 8.2 Event Correlation

```typescript
export interface EventCorrelation {
  correlationId: string;
  eventIds: string[];
  rootEventId: string;
  trace: string[];
}
```

This contract directly enables P23 replay and P30 lineage by standardizing event fields that governance already consumes.

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

### 10.1 Memory Provider

```typescript
export interface MemoryProvider {
  id: string;
  kind: "vector" | "graph" | "key-value" | "episodic";
  store(entry: MemoryEntry): Promise<void>;
  query(spec: MemoryQuery): Promise<MemoryEntry[]>;
  stats(): Promise<MemoryStats>;
}
```

### 10.2 Memory Entry

```typescript
export interface MemoryEntry {
  id: string;
  content: unknown;
  metadata: {
    source: string;
    timestamp: string;
    provenance: string[];
    correlationId: string;
  };
  embedding?: number[];
}
```

### 10.3 Memory Query

```typescript
export interface MemoryQuery {
  text?: string;
  filter?: Record<string, unknown>;
  limit?: number;
  minScore?: number;
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

Each contract file gets a type-level test verifying the interface is structurally sound.

### M1.1–M1.7 — Contract Tests (7 tests)

1. AgentContract interface compiles with all required fields
2. ProviderContract interface compiles with capability/health specifications
3. ToolContract interface compiles with provenance/result specifications
4. ALiXEvent interface compiles with correlation fields
5. ALiXContext interface compiles with transfer specifications
6. MemoryProvider interface compiles with entry/query specifications
7. RuntimeEvidence interface compiles with governance bridge fields

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
