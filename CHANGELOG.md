# Changelog

## 2026-06-08 — M0.9 Governance/Demo Baseline

### Added
- **Kernel primitives**: WorkflowRun, single-node TaskGraph, PolicyDecision, minimal metrics
- **Canonical event envelope**: EventSink adapter wrapping existing EventLog events
- **SQLite migrations**: `alix db doctor`, `alix db migrate` with 6 kernel tables
- **Demo path**: `alix demo local` with mutation safety guard and kernel artifact display
- **Metrics**: `alix metrics` with summary/raw mode, `--session <id>` support
- **CLI arg parser**: Positional flag parsing replacing fragile regex stripping
- **Capability mapping**: `legacyCapabilityToCanonical()` for PRD taxonomy alignment
- **Argument hash**: SHA-256 on all tool events for audit trail
- **Event metadata**: Optional workflowId/graphId/nodeId/traceId/spanId field
- **Session artifacts**: Large tool outputs moved from `/tmp` to session directories
- **Model routing validation**: Script + 15 curated test cases (requires GPU to execute)

### Fixed
- Tool repair now runs before PolicyDecision creation (correct order)
- Terminal events use correct status (failed vs completed) for non-completion reasons
- DB migration reads from single-source SQL file
- Policy events use correct sessionId (not empty string)
- model_calls_total emitted for every model call, not only when usage returned
- demo verifies zero mutation events (exits with error if found)
- TUI shows bypass-mode disclosure on startup
- Metrics command finds latest session by mtime, not name sort

### Tests
- 39 new kernel tests (event envelope, WorkflowRun, TaskGraph, PolicyDecision, metrics)
- 73 new pre-M0.9 tests (CLI parser, capability mapping, event meta, artifacts)
- Total: 1495 pass, 0 fail

### Tagged
- `m0.9-governance-demo-baseline`


## 2026-06-13 — ALiX 0.3.0-rc.1

### Added
- **Model Profiles**: `alix config profiles list|show|apply|install`, with `models doctor` and `models fit`
  - `minimal-local`, `balanced-local`, `power-local`, `cloud-balanced`, `all-cloud`
  - Dynamic profile switching and model-provider resolution
- **Ownership Boundaries (M0.75)**:
  - Lock-protected `OwnershipRegistry` with atomic acquire/release/renew
  - Deterministic `PathScope` overlap detection (symmetric overlap + directional contains)
  - `OwnershipLock` with UUID token, PID liveness check, cross-host safety
  - Classification-driven mutation-target extraction (`known-write` / `unknown-write` / `no-write`)
  - `OwnershipGate` integrated into `ToolExecutor` (runs on every tool call including continuation-resume)
  - `alix ownership {list|show|history|acquire|release|renew|conflicts|prune}`
  - Auto-acquire with config switch; explicit-lease mode for parallel agents
  - 81 ownership-specific tests, Greptile 5/5
- **Tool-Aware Routing**: Intent-based tool filtering with capability inference
- **WorkspacePathResolver**: Centralized path validation with sensitive-path detection
- **Daemon enhancements**: Assistant streaming, stable readline/cursor handling
- **TUI improvements**: Responsive laptop layout, stable interactive mode
- **Continuation compatibility**: `migrationIssue` field for legacy continuations missing `agentId`

### Fixed
- Continuation-resume now passes through OwnershipGate (not just PolicyGate)
- Config schema extended with `ownership` namespace
- `sessionMode: "ask"` correctly creates fresh approvals (does not reuse stale ones)
- Test suite reliability: routing tests use `PERMIT_ALL_CONFIG` fixture, vitest/node isolation
- 22 pre-existing test failures resolved across executor, patch, PolicyGate, and skill suites

### Tests
- 81 new ownership tests (path-scope, lock, registry, gate, mutation-targets, CLI)
- 2484 total passing, 0 failing
- Full CI clean: unit, integration, typecheck, TUI smoke
- Vitest suites separated from node:test runner

### Tagged
- `m0.75-ownership-registry`


## 2026-06-13 — ALiX 0.3.0-rc.2

### Fixed
- **Fresh-install onboarding**: `models doctor`, `models fit`, and `models list-profiles` now work before a model is configured — `loadConfig` accepts `{ requireModel: false }` for diagnostic commands
- **`alix init` no longer writes empty model name**: When Ollama is auto-detected but has no installed models (or Ollama is absent), config writes `model: {}` instead of `model: { provider: "ollama", name: "" }` and shows remediation guidance
- **Ollama model auto-detection**: `init` now queries `ollama list` to select the first installed model when Ollama is the detected provider

### Added
- `LoadConfigOptions.requireModel` in `loader.ts` — strict default preserved for production paths
- `getInstalledOllamaModels()` exported from `catalog.ts`

### Tests
- 7 new fresh-install regression tests (env-var isolation, scoped CWD fixtures)
- 2491 total passing, 0 failing

### Tagged
- `v0.3.0-rc.2`


## 2026-06-05 — Multi-Embedder Intelligence

### Added
- Multi-embedder search with weighted fusion (semantic + code embedding models fused with task-type-aware weights)
- Kernel/grounding-set boost — high-connectivity files get score boost based on dependency graph impact
- Cosine guardrails — EmbeddingCache.checkGuardrail() validates proposed edits stay within similarity threshold
- EmbeddingCache now supports configurable models via EmbedderConfig with separate cache directories

### Fixed
- All 12 pre-existing test failures — provider tests, patch tests, context compiler, inspector, discover tests
- Zero build errors across entire TypeScript codebase
- Embedding cache miss log changed from console.warn to console.debug


## 2026-06-04 — Self-Extensible Hooks + Agent Observability

### Added
- create_hook tool that generates TypeScript hooks from natural language (Pi Agent pattern)
- HookRunner.listHooks() introspection method
- 6 observability plans: agent state in SSE, subagent activity, reasoning trail, decision timeline, cost tracking, tool call visualization
- Cost calculator module with provider rate tables
- agent.reasoning, agent.decision, subagent.started, subagent.result event types

### Fixed
- Subagent deleting files it creates (worker prompt now says "Do NOT delete files")
- Subagent CWD resolution uses process.cwd() instead of hardcoded source path
- Ownership registry leak on subagent spawn failure
- Broken renderTokens function in inspector app.js

## 2026-06-03 — Zero-Default Config + TUI Redesign

### Added
- Zero-default model configuration — all 24 hardcoded model names removed
- alix config set-tier — menu-driven CLI for per-tier model config
- TUI split-screen redesign with bottom-pinned status bar (Claude Code pattern)
- Subagent tier inheritance — unset tiers inherit from main model
- Self-extensibility: create_skill, list_extensions, inspect_extension tools

### Fixed
- OOM: repomap ignores .worktrees, .alix, test-folder directories
- OOM: embedding model load deferred (saves 68MB ONNX load)
- OOM: Node heap limit wrapper via child_process.spawn
- Google API 404 with {model} placeholder in baseUrl
- Verification loop skip for read-only queries

## 2026-06-02 — Local LLM + Web Search

### Added
- Local llama.cpp auto-start via ALIX_LLAMA_MODEL_PATH env var
- Grammar-constrained tool calling via JSON schema
- web_search and web_fetch tools with Brave Search API
- MCP integration via .alix/llama-mcp.json
- Native OpenAI tools format with --jinja flag support

## 2026-06-01 — TUI + Subagent Fixes

### Added
- TUI differential rendering (line-level LCS diff)
- alix tui command wired into CLI

### Fixed
- Cursor overflow in TUI status area (removed 10fps timer)
- Subagent ownership release and CLI arg fixes

## 2026-05-31 — Unified LLM API + Agent Runtime Split

### Added
- 12 provider classes refactored to spec modules (60% line reduction)
- unified-complete.ts dispatcher with retry logic
- Spec inheritance — 7 OpenAI-compatible providers share one base spec
- Agent runtime split — run.ts decomposed into 5 focused modules
- TUI layout constants, spinner phases, color-coded budget bar
- MCP error normalization, retry helper, server registry
- In-process extension registry
- Lazy import helper and context bundle cache

## 2026-05-30 — TUI Merged

### Added
- TUI implementation merged from worktree
- Terminal UI with state machine, agent tree, budget bar
- Event log bridge for real-time TUI updates

## 2026-05-20 — Initial Release

### Added
- Core agent loop (classification, tool execution, verification)
- Provider abstraction for 12 providers
- File tools (read, write, patch, create, delete, exists, search)
- Patch engine with preimage validation and checkpoints
- Policy engine with allow/ask/deny
- Event-sourced JSONL log
- Basic inspector web UI
- Build system, test suite, supply-chain hardening
