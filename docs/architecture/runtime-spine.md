# ALiX Runtime Spine

> ALiX is a local-first AI Agent Operating System. This document describes the architecture of its runtime spine.

## Overview

```
   CLI ──► Daemon ──► runTask() ──► Provider (LLM)
    │                    │
    │                    ▼
    │              EventLog (events.jsonl)
    │                    │
    │                    ▼
    │         ┌──────────────────┐
    │         │  Storage Layer   │
    │         │  .alix/          │
    │         │  ├─ sessions/    │
    │         │  ├─ graphs/      │
    │         │  ├─ approvals/   │
    │         │  ├─ audit/       │
    │         │  ├─ policies/    │
    │         │  ├─ cards/       │
    │         │  └─ daemon-*.json│
    │         └──────────────────┘
    │                    │
    ▼                    ▼
 RuntimeIndex ─── Inspector (Web UI)
```

## Layers

### 1. Execution Layer

| Component | File | Purpose |
|-----------|------|---------|
| `runTask()` | `src/agents/agent/agent-loop.ts` | Single-task execution loop |
| `GraphExecutor` | `src/coordination/kernel/graph-executor.ts` | Multi-node sequential executor |
| `GraphPlanner` | `src/coordination/kernel/graph-planner.ts` | Model-based graph generation |
| `daemon-server` | `src/operations/daemon/daemon-server.ts` | Persistent background runtime |

### 2. Governance Layer

| Component | File | Purpose |
|-----------|------|---------|
| `CapabilityResolver` | `src/capabilities/registry/capability-resolver.ts` | Can ALiX do this? |
| `RuleEvaluator` | `src/governance/policy/rule-evaluator.ts` | Is ALiX allowed to do this? |
| `RuntimeGate` | `src/governance/policy/runtime-gate.ts` | Two-layer gate (capability + policy + approval) |
| `ApprovalStore` | `src/governance/approvals/approval-store.ts` | User approval queue |
| `AuditStore` | `src/governance/audit/audit-store.ts` | Append-only audit trail |

### 3. Observability Layer

| Component | File | Purpose |
|-----------|------|---------|
| `RuntimeIndex` | `src/runtime-state/runtime/runtime-index.ts` | Unified event index (6 backends) |
| `GraphProjection` | `src/coordination/kernel/graph-projection.ts` | Run state reconstruction |
| `Inspector` | `src/interfaces/ui/` + `src/interfaces/server/` | Read-only web UI |

### 4. Registry Layer

| Component | File | Purpose |
|-----------|------|---------|
| `CardRegistry` | `src/capabilities/registry/card-registry.ts` | Agent/tool identity |
| `AgentCard` | `src/capabilities/registry/agent-card.ts` | Agent capability declarations |
| `ToolCard` | `src/capabilities/registry/tool-card.ts` | Tool capability declarations |

### 5. Workflow Layer

| Component | File | Purpose |
|-----------|------|---------|
| `SopRegistry` | `src/coordination/sop/sop-registry.ts` | SOP pack catalog |
| `SOP `research.deep_report` | `src/coordination/sop/research-deep-report.ts` | 6-node research workflow |
| `SOP `infra.docker_compose_audit` | `src/coordination/sop/infra-docker-compose-audit.ts` | Docker compose audit |

### 6. Daemon Layer

| Component | File | Purpose |
|-----------|------|---------|
| `DaemonManager` | `src/operations/daemon/daemon-manager.ts` | PID/status lifecycle |
| `TaskRegistry` | `src/operations/daemon/task-registry.ts` | File-backed task queue |
| `daemon-server` | `src/operations/daemon/daemon-server.ts` | Unix socket command server |

## Data Flow

```
Graph execution (with enforcement):
  GraphExecutor node start
    → CapabilityResolver (does capability exist?)
    → RuleEvaluator (is it allowed?)
    → ApprovalStore (ask → pending approval, allow → execute)
    → runTask() (model call)
    → EventLog.append() (persist)
    → Socket client (stream) if daemon

Task submission (with daemon):
  alix submit "task"
    → Unix socket → daemon-server
    → TaskRegistry.create (queued)
    → processQueue → handleRun
    → registry.update (running)
    → runTask() → event streaming
    → registry.update (completed/failed)
    → RuntimeIndex picks up session events + daemon tasks
```

## Storage Layout (`.alix/`)

```
.alix/
├── sessions/<id>/events.jsonl    — raw session events
├── graphs/<id>.json              — graph definitions + node status
├── graphs/<id>.runs.json         — rerun attempts
├── approvals/approvals.json      — approval lifecycle
├── audit/audit.jsonl             — append-only audit trail
├── policies/*.json               — custom policy rules
├── cards/agents/*.json           — custom agent cards
├── cards/tools/*.json            — custom tool cards
├── daemon.json                   — daemon status + heartbeat
├── daemon.pid                    — daemon process ID
├── daemon-tasks.json             — task registry
└── alixd.sock                    — daemon Unix socket
```

## Key Invariants

- **Inspector is read-only** — no POST endpoints for execution
- **CLI-first** for all approval, audit, and daemon actions
- **Two-layer gate** — capability existence checked before policy
- **Append-only audit** — no mutation, no deletion
- **On-the-fly RuntimeIndex** — no new storage, queries 6 backends
- **DOX governance** — AGENTS.md files are binding contracts
