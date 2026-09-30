# Exact Tool Names Design

The model-facing execution surface uses only `alix_*` built-ins and `mcp__*` dynamic tools. Tool calls resolve by exact name against the tools offered for the current turn. Unknown names, including dot notation and old underscore aliases, return an error listing the offered names and never reach execution.

The built-in manifest records executable model names and their existing internal executor names. Capability IDs and policy keys stay unchanged. Live extension handlers, the gated state proposal, and coordination collaboration tools receive canonical names; phantom names are removed from model-facing policy and scoping. Dynamic MCP names are opaque, collision-safe handles mapped to their registered executor entries for the current session.

The main agent and worker use the same resolution rule. A denied name cannot be revived by a fuzzy lookup, selected-tool `execName`, or unscoped registry entry. MCP search remains a built-in (`alix_mcp_search_tools`). Existing internal executor names may remain where needed for policy and routing; they are never accepted as model calls.

Validation covers exact acceptance, legacy rejection, available-tool errors, dynamic MCP collisions, worker collaboration, state proposal, typecheck, unused-code gate, and focused integration tests. Fresh worktree state is used for runtime smoke tests. Deployment must stop old sessions before activation; shared user state is not deleted by repository code.
