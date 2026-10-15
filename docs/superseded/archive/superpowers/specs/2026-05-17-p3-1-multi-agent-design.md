# P3.1 Multi-Agent Coordination — Design

**Date:** 2026-05-17
**Status:** ✅ Completed (M0.7)

## Goal

Add multi-agent coordination to ALiX: one parent agent manages subagents that do focused, isolated work (exploring, reviewing, investigating, writing). Subagents are spawned by the parent or by the user via CLI.

**MVP constraint:** Read-only subagents only for the first iteration. Write-capable (`worker`) subagent is part of MVP scope.

---

## Architecture

One parent agent + N subagents. Subagents are separate Node.js processes. Parent spawns them and coordinates results.

- **User spawns directly:** `alix agent explorer "explore the auth module"`
- **Parent spawns:** model calls a `delegate` tool, `SubagentManager` spawns the subagent process

Each subagent runs as a child process with its own model call. It gets a task-scoped context slice (reusing the P0.1 ContextCompiler). Results flow back via the shared event log.

---

## Roles

| Role | Mode | Model | Retry | Description |
|---|---|---|---|---|
| `explorer` | read-only | fast model | 1x | Understand and map code regions |
| `reviewer` | read-only | fast model | 1x | Code review, style, quality |
| `test_investigator` | read-only | same as parent | 1x | Map tests to code, diagnose failures |
| `docs_researcher` | read-only | fast model | 1x | Find and summarize docs |
| `worker` | write | same as parent | 0x | Apply changes to owned file paths |

Role defaults in config (`mcpServers`-style array). Adding a new role is a config entry + optional `SubagentRole` type update. Most new roles are config-only.

---

## Data Model

```ts
type SubagentRole = "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";

type SubagentTask = {
  id: string;
  role: SubagentRole;
  prompt: string;
  mode: "read_only" | "write";
  ownedPaths?: string[];           // only for write mode
  expectedOutput?: string;        // freeform, for result validation
  contextBundle?: ContextBundle;  // from P0.1 ContextCompiler
};

type SubagentResult = {
  id: string;
  role: SubagentRole;
  status: "success" | "failed" | "rejected";
  findings: SubagentFinding[];
  events: SessionEvent[];         // events written to shared log
  error?: string;
};

type SubagentFinding = {
  type: "file_ref" | "code_location" | "summary" | "risk_flag";
  content: string;
  confidence: "high" | "medium" | "low";
  refs?: string[];                 // file paths or symbol names
};
```

`SubagentEventBridge` tags each event in the shared log with `{ subagentId, role }`.

---

## Components

| Component | Responsibility |
|---|---|
| `SubagentManager` | Spawns, tracks, and terminates subagent processes. Manages concurrent subagent lifecycle. |
| `TaskDelegator` | Converts a parent delegation decision into a `SubagentTask`, builds context slice via ContextCompiler, passes to manager. |
| `OwnershipRegistry` | Tracks which `worker` subagent owns which file paths. Answers ownership queries. |
| `SubagentEventBridge` | Tags and writes subagent events to the shared session log. |
| `ResultContractValidator` | Validates subagent output against `expectedOutput` if provided. |
| `MergeCoordinator` | Parent-side helper: receives multiple `SubagentResult`s, identifies conflicts, feeds into parent decision loop. |

---

## Lifecycle

### User spawns a subagent
```
user: /agent explorer "explore the auth module"
  → TaskDelegator.buildTask(role, prompt, context)
  → SubagentManager.spawn(task) → child process starts
  → SubagentEventBridge writes "subagent.started"
```

### Parent spawns a subagent
```
parent: "I need to understand the auth module"
  → calls delegate(tool_call)
  → TaskDelegator.buildTask() with context slice
  → SubagentManager.spawn(task) → child process starts
  → parent continues its own loop (parallel)
```

### Subagent runs
```
subagent process: parse args → run ContextCompiler → build prompt → call model → write events → exit
  → SubagentEventBridge tags events with subagentId
```

### Subagent completes
```
parent receives result (via stdio + callback)
  → ResultContractValidator.check()
  → MergeCoordinator.reconcile() if multiple results
  → parent incorporates findings into its message stream
```

### Ownership conflict
```
worker subagent owns "src/auth/*"
  → parent or another subagent tries to write "src/auth/login.ts"
  → OwnershipRegistry.claim(ownedPaths)
  → user prompt: "block or override?"
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Read-only subagent fails | Retry 1x silently. If it fails again, log to event log, parent continues. |
| Write-capable subagent fails | Log to event log. Pause parent. Prompt user: retry, discard partial writes, or abort. |
| Subagent timeout | Treat as failure per role rules above. |
| Subagent writes to unowned file | Blocked. Prompt user to allow or deny. |
| Ownership conflict (two workers own same path) | Prevented at task assignment time. `TaskDelegator` checks `OwnershipRegistry` before spawning. |
| Result contract mismatch | `ResultContractValidator` flags warning in event log. Does not halt. |

---

## Testing

- Read-only subagent cannot call write tools — verified by blocking write-mode tools for read-only roles at the tool policy layer.
- Parent timeline includes subagent started/result/errors — tested via session replay (P1.1 infrastructure).
- Two write-capable subagents cannot own the same file path — `TaskDelegator` throws at spawn time if paths overlap.
- Parent can reject a subagent result without changing files — parent decides what to incorporate into its message stream.
- Concurrent subagent spawning and result aggregation — unit test `SubagentManager` with mock child processes.

---

## Future Upgrades

| Item | Description |
|---|---|
| Streaming subagent progress | SSE fan-out for real-time subagent output (currently: result only on completion) |
| Per-invocation model override | Let parent or user specify model per subagent invocation, overriding role defaults |
| Configurable retry counts | Per-role retry counts in config instead of hardcoded 1x/0x |
| Sub-session isolation | Separate event log files per subagent, parent references sub-session IDs (for complex debugging) |
| Context delivery upgrade | Move from CLI args to shared temp file for context bundles if real size limits emerge |
| Role schema extension | Typed schema for `expectedOutput` per role — e.g., `test_investigator` returns a structured test map |