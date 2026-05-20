# Implementation Readiness

## Implementation Status

**MVP: ✅ Complete**

All 12 feature areas from the research doc have been implemented:

| # | Feature | Components |
|---|---------|------------|
| 1 | Context Selection | `ContextBundleBuilder`, `ContextRanker`, `GitActivityReader`, `RepoMapLite`, `SymbolExtractor`, `DependencyGraph` |
| 2 | Tool Security | `PolicyEngine`, `CapabilityRegistry`, `SecretScanner` |
| 3 | Patch Reliability | `EditFormatSelector`, `PatchParser`, `StructuredPatchApplier`, `DiffRenderer`, `RollbackManager` |
| 4 | Verification Quality | `CommandDiscovery`, `CommandRunner`, `VerificationReporter`, `VerificationPipeline`, `ChangeClassifier`, `TestMapper`, `VerificationPlanner` |
| 5 | Frontend Observability | `EventLog`, `Replay`, `SessionReader`, `Projection`, UI components |
| 6 | Provider Neutrality | 13 providers (Anthropic, OpenAI, Gemini, Groq, Deepseek, Ollama, etc.) |
| 7 | Autonomy Control | `TaskStateMachine`, `RunLimiter`, `ScopeTracker`, `CheckpointManager` |
| 8 | Extension Model | `ExtensionRegistry`, `SkillLoader`, `HookRunner`, `MCP Manager`, `Skills catalog` |
| 9 | Tool Schema Explosion | `ToolCatalog`, `ToolDiscovery`, `ToolSelector`, `ToolCache`, `MetaTool` |
| 10 | Multi-Agent | `SubagentManager`, `OwnershipRegistry`, `MergeCoordinator`, `ResultContractValidator` |
| 11 | Memory | `RepoIndexStore`, `UserPreferenceStore`, `MemoryInspector`, `ToolCache` |
| 12 | Server/Transport | `Server`, `SSE` transport |

## MVP Definition Of Done — Complete

- ✅ User can start a session from CLI.
- ✅ ALiX creates an event log.
- ✅ ALiX builds RepoMapLite before planning.
- ✅ ALiX can request a model response through an adapter.
- ✅ ALiX can request approval for risky tool calls.
- ✅ ALiX can apply a validated patch.
- ✅ ALiX creates a checkpoint before edits.
- ✅ ALiX can run at least one verifier command.
- ✅ ALiX shows final diff and verification status.
- ✅ Local UI can replay the session timeline.

## Implementation Order (How It Was Built)

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
15. MCP, skills, hooks, and subagents.

## Source Structure

```
src/
  agents/       # Multi-agent coordination (SubagentManager, MergeCoordinator, OwnershipRegistry)
  autonomy/     # State machine and run limits
  checkpoints/  # Git/file checkpoints and rollback
  config/       # Config loading and schema
  context/      # Context building (ContextBundleBuilder, ContextRanker)
  events/       # Event log, replay, types
  extensions/   # Extension registry and manifest
  hooks/        # Lifecycle hooks
  inspector/    # Session inspection and projection
  mcp/          # MCP client, tool catalog, discovery, selection
  memory/       # Memory stores (repo index, user preferences)
  patch/        # Patch engine (format selection, parsing, applying, rollback)
  policy/       # Policy engine and capability registry
  providers/    # 13 provider adapters
  repomap/      # Repo mapping (RepoMapLite, SymbolExtractor, DependencyGraph)
  security/      # Secret scanning
  server/       # SSE server for UI
  skills/       # Skills system (loader, catalog, dispatcher, factory)
  tools/        # Built-in tools (file, shell, git, etc.)
  ui/           # Vanilla JS inspector UI
  utils/        # Utilities (tokens, session digest)
  verification/ # Verification system (discovery, runner, reporter, pipeline)
  verifier/     # Verifier planner (change classifier, test mapper, risk report)
```

## Known Deferred Work

The following remain as future considerations:
- Semantic/symbolic search index (Tree-sitter-based repo map)
- LSP diagnostics (via MCP adapter)
- Browser automation
- Docker and remote runtimes
- ACP compatibility