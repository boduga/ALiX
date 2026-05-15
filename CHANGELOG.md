# Changelog

All notable changes to ALiX are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-15

### Added

- **Autonomous Task Loop** — Agent runs verification after every tool iteration and autonomously repairs failures by feeding output back to the model. No approval gate. Docs tasks skip verification.
- **Task Classifier** — Classifies prompts into bugfix/feature/refactor/docs/unknown for task-type-aware loop behavior.
- **Verification Discovery** — Auto-discovers `test`, `build`, `typecheck`, `lint`, and `check` scripts from `package.json` to use as verification checks.
- **Autonomous Repair** — Failed verification triggers a repair loop with a configurable budget (default 3 repairs). Verification output is fed directly to the model.
- **`maxIterations` Configurable** — Model config supports `maxIterations` to override the default 10-iteration limit per session.
- **MCP Tool Deferral** — On-demand schema resolution with fuzzy search fallback. Tool schemas are no longer injected into every prompt; the model requests full schemas only when needed.
- **tiktoken Token Counting** — Accurate token counting using tiktoken encoders (`cl100k_base`, `o200k_base`) with encoding-aware budget management.
- **Context Truncation** — Automatic truncation when token budget is exceeded, with a synthesized session digest replacing removed messages.
- **Session Log Replay** — Reads `.alix/sessions/<id>/events.jsonl` to synthesize an authoritative digest of file changes for long-running sessions.
- **Consolidated Session Digest** — Rolling summary of created/changed/deleted files and fatal errors replaces the prior per-iteration `[State]` messages.
- **Extensible Verification Hooks** — Hook system via `.alix/hooks.json` with `pre_task`, `post_task`, and `on_change` events.
- **Shell Output Truncation** — Shell tool output capped at 80KB with line-based truncation reporting. stdout and stderr are separated with a visible marker.
- **Interactive MCP Discover** — `alix mcp discover` now prompts for confirmation and saves new servers to the project config.
- **Streaming Auto-Disable** — Streaming is automatically disabled in non-TTY environments and CI. `--no-stream` flag added to `alix run` for manual override.
- **MCP CLI** — Full `alix mcp` subcommand suite: `list`, `add`, `remove`, `discover`, `test`.
- **12 Provider Adapters** — Anthropic, OpenAI, Google, OpenRouter, Groq, Ollama, Perplexity, MiniMax, ZhipuAI, GrokAI, DeepSeek, and mock.
- **Inspector UI** — Local web UI at `http://127.0.0.1:4137` with session timeline, diff viewer, terminal stream, and approval panel.
- **Policy Engine** — Allow/ask/deny decisions on every tool call with protected path policy.
- **Patch Engine** — Preimage validation, checkpoints, diffs, and rollback on failed edits.
- **Event-Sourced Session Kernel** — Append-only JSONL event log under `.alix/sessions/<id>/events.jsonl`.

### Fixed

- `closeAll()` now closes registry servers in addition to process manager servers, eliminating a hang in test teardown.
- `StdioTransport.send()` now properly rejects when a process exits before responding, instead of hanging indefinitely.
- MCP tool names no longer have server prefix doubled when called.
- `McpManager.discoverServer()` falls back from `uvx` to `npx` when a package is not found.
- Stdio transport no longer has a race condition between response routing and pending callbacks.

### Changed

- `npm run check` is the single command to run build, typecheck, and tests.
- 4 integration tests are skipped by default (require `TEST_WITH_LIVE_API=1` to run).

### Documentation

- PRD added (`docs/PRD.md`) covering product overview, architecture, community model, and honest roadmap.
- `CONTRIBUTING.md` and this `CHANGELOG.md` added to support open-source contribution.