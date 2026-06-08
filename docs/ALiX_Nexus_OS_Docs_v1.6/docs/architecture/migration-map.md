# Migration Map

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 27. Current Repo Migration Map

This section converts the current ALiX coding-agent harness into the Agent OS architecture without a rewrite. Existing behavior must remain compatible while new primitives are introduced underneath the current CLI flow.

| Current Repo Area | Preserve | Refactor Into | Migration Action | Primary Risk | Required Compatibility Test |
|---|---|---|---|---|---|
| CLI `alix run` task entry | Yes | WorkflowRun creator | Wrap current run loop in a workflow envelope | Breaking existing user commands | `alix run "explain this repo"` still completes |
| Current task/classification loop | Yes | Intent Kernel + Graph Planner | Emit a single-node TaskGraph first, then expand to multi-node graphs | Planner over-complexity | Single-node graph output matches legacy run quality |
| Existing subagent/delegation features | Yes | Agent Registry + Agent Cards | Convert each current role into a manifest-backed Agent Card | Duplicate role logic | `alix agent list` includes legacy subagents |
| Existing tools: file, shell, patch, web, MCP | Yes | Tool Cards + Capability Registry | Add risk tier, schema, sandbox, and policy metadata around every tool | Tool bypass of policy | No tool executes without a PolicyDecision |
| Existing event log / SSE stream | Yes | Canonical Event Bus | Normalize event envelope while preserving legacy event payloads under `payload.legacy` during migration | Replay incompatibility | New Inspector can read old and new events |
| Existing Inspector | Partial | Projection UI over persisted state | Keep legacy timeline until TaskGraph persistence is complete; then replace with graph projections | UI rewrite risk | Inspector displays WorkflowRun and TaskGraph IDs |
| Existing memory command | Yes | Memory Kernel | Keep CLI command but back it with typed MemoryRecords | Memory pollution | `alix memory list/search/explain` works |
| Current MCP integration | Yes | MCP Gateway | First consume MCP tools, then expose ALiX as an MCP server | Protocol drift | MCP tool calls emit ToolInvocation events |
| Existing hooks/skills | Yes | Skill Registry + Extension System | Wrap generated hooks/skills in Skill Cards with tests and permissions | Unsafe self-extension | Skill cannot install without validation |
| Local llama.cpp / Ollama support | Yes | Model Router | Add model profiles and health checks around existing providers | Missing model failures | `alix models doctor` reports install status |

### 27.1 Migration Principles

- No big-bang rewrite. Every new kernel primitive must be introduced behind existing commands.
- Every legacy run must produce a WorkflowRun and at least one TaskNode.
- Every new feature must write canonical events.
- The Inspector must only become the primary UI after durable persistence exists.
- Legacy events must be readable until a formal migration command is shipped.

### 27.2 Migration Commands

```
alix migrate status
alix migrate events --dry-run
alix migrate events --apply
alix db doctor
alix db migrate
alix db export --format jsonl
```

---
