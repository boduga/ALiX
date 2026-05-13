# Implementation Readiness

## Status

The research is complete enough to begin implementation planning after these specs are accepted.

The implementation should start with one high-quality single-agent loop:

```text
chat -> repo map lite -> plan -> approve -> patch -> verify -> diff -> summarize
```

## Required Specs

- [Event Kernel Schema](./event-kernel-schema.md)
- [Patch Engine Protocol](./patch-engine-protocol.md)
- [Configuration Format](./config-format.md)
- [Provider Adapter Interface](./provider-adapter-interface.md)
- [RepoMapLite](./repomap-lite.md)
- [Frontend Transport Design](./frontend-transport.md)

## Recommended Implementation Order

1. Project skeleton and CLI entrypoint.
2. Config loader and merged effective config.
3. Event kernel with JSONL append and replay.
4. RepoMapLite.
5. Provider adapter interface with a mock provider.
6. File read/search tools.
7. Policy engine and approval queue.
8. Patch engine with structured patch and search/replace.
9. Git/file checkpoint manager.
10. Shell tool with approval.
11. Verification planner and command runner.
12. Local server and SSE stream.
13. Vanilla JS inspector UI.
14. Real provider adapters.
15. MCP, skills, hooks, and subagents after MVP.

## MVP Definition Of Done

- User can start a session from CLI.
- ALiX creates an event log.
- ALiX builds RepoMapLite before planning.
- ALiX can request a model response through an adapter.
- ALiX can request approval for risky tool calls.
- ALiX can apply a validated patch.
- ALiX creates a checkpoint before edits.
- ALiX can run at least one verifier command.
- ALiX shows final diff and verification status.
- Local UI can replay the session timeline.

## Known Deferred Work

- Full Tree-sitter/PageRank repo map.
- Semantic search.
- LSP diagnostics.
- Browser automation.
- Docker and remote runtimes.
- MCP extension ecosystem.
- Skills and recipes.
- Subagents.
- ACP compatibility.

## Open Decisions Before Coding

1. Runtime language: TypeScript/Node remains the assumed stack.
2. Package manager: choose `pnpm`, `npm`, or `bun`.
3. CLI package name: `alix`.
4. First real provider adapter: choose Anthropic, OpenAI, or Gemini.
5. Git repo initialization: this workspace is not currently a git repository.

## Recommendation

Start implementation planning only after choosing the package manager and first real provider adapter. Until then, use a mock provider to develop the kernel, policy, patch, and UI layers without burning API calls.
