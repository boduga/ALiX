# ADR-0007: Agent / Subagent Execution Architecture

**Status:** Accepted (2026-07-13)
**Deciders:** Architecture team
**Scope:** Subagent dispatch, isolation, communication, and lifecycle

---

## 1. Context

ALiX uses multiple autonomous reasoning workers (subagents) with different capabilities: exploration, review, implementation, research, and investigation. These workers need to operate independently, sometimes concurrently on the same project, without interfering with each other or with the orchestrator process.

The problem space has several dimensions:

- **Isolation:** A subagent must not corrupt another subagent's in-progress work or the orchestrator's state.
- **Auditability:** Every subagent action must be recorded in a deterministic, replayable form.
- **Contract enforcement:** The orchestrator must be able to rely on structured outputs from subagents, not free-form text that requires parsing.
- **Resource control:** The orchestrator must control which model, tool set, and timeout applies to each subagent invocation.
- **Ownership:** When multiple subagents mutate files, they must not conflict.

Running subagents as in-process function calls was rejected early: it risks context contamination (shared memory, overlapping tool calls), makes audit difficult (no isolation boundary between orchestrator and worker), and prevents concurrent execution.

---

## 2. Decision

ALiX adopts a **process-isolated subagent architecture** with structured I/O, centralized dispatch, and optional worktree isolation for write operations.

### 2.1 Architecture

```
                        Orchestrator
                             │
                   SubagentManager
                 ┌───────┼───────┐
                 │       │       │
            Subagent  Subagent  Subagent
            (child   (child    (child
             proc)    proc)     proc)
                 │       │       │
            JSONL   JSONL   JSONL
            log     log     log
                 │       │       │
          Worktree  (none)  Worktree
          (write)  (read)   (write)
```

### 2.2 Dispatch Model

The `SubagentManager` is the single point of control. Subagents are never self-spawning — they are always dispatched by the orchestrator through the manager.

```
Orchestrator
     │
     ▼
SubagentManager.spawn(task: SubagentTask)
     │
     ├── Validate ownership (no overlapping ownedPaths)
     ├── Resolve role → model tier → provider
     ├── Emit subagent.started event to EventLog
     ├── Spawn child process: `alix run --subagent <role> --task-id <id> --prompt <bundle>`
     │       │
     │       ▼
     │   SubagentCLI.main()
     │       │
     │       ├── Load config
     │       ├── Build context (ContextCompiler)
     │       ├── Select tools (ToolSelector + ToolPolicy)
     │       ├── Invoke model (Provider)
     │       ├── Execute tool calls (ToolExecutor)
     │       ├── Collect findings
     │       └── Write result to stdout
     │
     ├── Collect SubagentResult from child stdout
     ├── Emit subagent.completed event
     └── Return SubagentResult to orchestrator
```

### 2.3 Process Isolation

Every subagent runs as a separate OS process, spawned via `child_process.spawn()`.

**Rationale:** Process isolation provides the strongest boundary between orchestrator and worker. The subagent cannot modify the orchestrator's in-memory state, cannot access its file handles, and can be killed independently if it times out or becomes unresponsive.

The child process loads the ALiX configuration from the project root, resolves its own provider and model, builds its own tool set, and communicates results back through stdout as a single JSON structure.

### 2.4 Worktree Isolation (Write Mode)

Subagents in `"write"` mode receive an isolated git worktree. Subagents in `"read_only"` mode operate on the working tree directly.

**Rationale:** When multiple subagents mutate files concurrently (e.g., an implementer and a reviewer working on different parts of the codebase), shared-filesystem access creates race conditions and ownership conflicts. Git worktrees provide cheap, disposable isolation:

- Each write-mode subagent gets its own worktree via `git worktree add`
- The worktree is on a temporary branch from the orchestrator's HEAD
- Changes are merged back or discarded based on review outcome
- If unchanged, the worktree is auto-cleaned

**Rejected alternative:** In-memory virtual filesystems were considered but rejected because they prevent subagents from using real tooling (git, compilers, linters) that expect a real filesystem.

### 2.5 Ownership Registry

The `SubagentManager` maintains a path-level ownership registry. Before spawning a write-mode subagent, the manager checks that none of the subagent's owned paths overlap with paths owned by an active worker.

```
spawn(task):
  if task.mode == "write" and task.ownedPaths:
    for path in task.ownedPaths:
      if path owned by active agent:
        reject with "overlapping ownership"
    register paths for this task
```

On subagent completion, owned paths are released.

**Rationale:** Without ownership enforcement, two subagents assigned to modify the same file would produce conflicting changes. The ownership registry provides a lightweight, explicit locking protocol without introducing a full distributed lock manager.

### 2.6 Structured Output Contracts

Every subagent returns a `SubagentResult`:

```typescript
type SubagentResult = {
  id: string;
  role: SubagentRole;
  status: "success" | "failed" | "rejected";
  findings: SubagentFinding[];       // Structured evidence artifacts
  events: string[];                  // Session events (JSONL)
  error?: string;
};

type SubagentFinding = {
  type: "file_ref" | "code_location" | "summary" | "risk_flag" | "web_source" | "synthesis";
  content: string;
  confidence: "high" | "medium" | "low";
  refs?: string[];
};
```

Findings are typed, structured artifacts, not free-form text. The orchestrator can aggregate, filter, and act on findings without parsing natural language.

**Rejected alternative:** Free-form text output was used in early prototypes but required fragile regex parsing to extract structured information (file paths, risk levels, code locations). The structured finding model eliminates this parsing layer.

### 2.7 Role-Based Model Routing

Subagent roles map to model tiers:

| Role | Typical Tier | Typical Model | Purpose |
|------|-------------|---------------|---------|
| `explorer` | fast | Haiku | Codebase exploration |
| `researcher` | standard | Sonnet | Web research, analysis |
| `reviewer` | standard | Sonnet | Code review, verification |
| `worker` | capable | Opus/Fable | Code modification |
| `test_investigator` | standard | Sonnet | Test analysis |
| `docs_researcher` | fast | Haiku | Documentation search |

The model tier is resolved at dispatch time by the `SubagentManager`, not hardcoded in the agent. This allows the orchestrator to adjust model selection based on cost, availability, or task priority without changing agent code.

**Rationale:** Separating model selection from agent logic means that adding a new model or changing pricing doesn't require updating subagent implementations. The agent's role defines its capability requirements; the manager satisfies them.

### 2.8 Context Bundles

Subagents receive a serialized context bundle as their prompt, built by the `ContextCompiler` from:

- Relevant file contents and structure
- Prior conversation context
- Task-specific instructions
- Tool availability and policies

The context bundle is a single serialized string (`contextBundle` in `SubagentTask`) that the subagent loads at startup.

**Rationale:** Building context once in the orchestrator avoids redundant file reads across subagents and ensures that all subagents in a task see the same context snapshot. This is critical for determinism — if two reviewers see different files, they produce different reviews.

### 2.9 Event Log Integration

Every subagent lifecycle event is recorded in the session's `EventLog`:

- `subagent.started` — task ID, role, model selected, owned paths
- `subagent.completed` — task ID, status, finding count
- `subagent.failed` — task ID, error message

The event log is persisted as JSONL and replayed during session resume.

---

## 3. Architectural Invariants

1. **Agents never mutate the orchestrator's state directly.** All communication is through structured I/O (stdout JSON for results, EventLog for lifecycle).
2. **Every agent execution produces a structured transcript.** The transcript is persisted as JSONL in the event log.
3. **Every mutation goes through governed paths.** Write-mode subagents operate on worktrees; their changes are subject to review before merging.
4. **Worktrees provide isolation boundaries.** No write agent touches the orchestrator's working tree.
5. **Structured output contracts are mandatory.** Subagents return `SubagentResult`, not free-form text. Findings are typed.
6. **Model selection is a routing decision, not an agent concern.** The role defines the capability; the manager resolves the model.
7. **Ownership is explicit.** Path ownership is declared at spawn time and enforced by the manager.
8. **Dispatch is centralized.** Subagents never self-spawn. The `SubagentManager` is the sole entry point.

---

## 4. Consequences

### 4.1 Positive

- **Strong isolation:** Process boundaries prevent state corruption between agents.
- **Concurrent execution:** Worktree isolation and ownership registry enable safe parallel write agents.
- **Deterministic audit:** Every lifecycle event is recorded in the JSONL event log.
- **Clean model upgrades:** Role-to-model mapping is a configuration change, not a code change.
- **Replayable execution:** The event log can be replayed to reconstruct session state.
- **Structured integration:** Downstream consumers (reviewers, governance) consume typed findings, not parsed text.

### 4.2 Negative

- **Process overhead:** Each subagent spawns a new Node.js process, adding ~200-500ms startup latency and memory overhead.
- **Serialized context:** The context bundle is passed as a string, so large contexts increase IPC payload size and subagent startup time.
- **Ownership complexity:** The ownership registry is in-memory and per-manager; distributed ownership across multiple orchestrator instances (if ever needed) would require external coordination.
- **Worktree cost:** Git worktrees add disk space overhead and setup time (~200-500ms per worktree).

---

## 5. Alternatives Considered

| Decision | Adopted | Rejected Alternative | Reason |
|----------|---------|---------------------|--------|
| Isolation model | Child process + worktree | In-process function calls | Risk of context contamination; no isolation boundary |
| Output format | Structured `SubagentResult` | Free-form text | Fragile parsing; no typed findings |
| Dispatch | Centralized `SubagentManager` | Agent self-spawning | No resource control; impossible to enforce ownership |
| Filesystem isolation | Git worktree | In-memory virtual FS | Real tooling (git, compilers) needs real filesystem |
| Model selection | Role-based routing | Agent-chosen model | Couples agent logic to provider configuration |
| Context | Prebuilt context bundle | Per-agent file reads | Duplicate I/O; inconsistent snapshots |
| Path ownership | Declared at spawn, enforced by registry | Advisory file locks | Locks don't carry agent identity; can't detect conflicts |

---

## 6. Key References

- `src/agents/subagent-manager.ts` — SubagentManager (dispatch, ownership, lifecycle)
- `src/agents/subagent-cli.ts` — SubagentCLI (agent entry point, model invocation, tool execution)
- `src/config/schema.ts` — `SubagentTask`, `SubagentResult`, `SubagentRole`, `ModelTierConfig`
- `src/agents/tool-policy.ts` — Per-role tool filtering
- `src/agents/ownership-registry.ts` — Path-based ownership enforcement
- `src/repomap/context-compiler.ts` — ContextBundle construction
- `src/events/event-log.ts` — EventLog (JSONL session persistence)
- `src/providers/registry.ts` — Model provider resolution
- `src/tools/executor.ts` — Tool execution
- `src/patch/edit-format-policy.ts` — Edit format enforcement for mutation agents
