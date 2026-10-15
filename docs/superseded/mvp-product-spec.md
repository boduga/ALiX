# ALiX MVP Product Spec

## Project Goal

Build ALiX, the Agentic Lifecycle & Intelligence eXchange: a new open, local-first agentic coding harness.

ALiX is not a router for Claude Code, OpenAI Codex CLI, Gemini CLI, OpenHands, OpenCode, Aider, or Goose. It is a new framework and CLI that combines the strongest ideas from those systems into one coherent harness.

ALiX should feel like a Claude Code-style coding agent, but be provider-neutral, observable, patch-safe, extensible, and inspectable through a local vanilla JavaScript UI.

## One-Sentence Product Definition

ALiX is a CLI-first coding agent harness that can understand a repository, plan work, safely edit files through a strict patch engine, run verification, show diffs, and preserve a replayable event log.

## MVP Loop

```text
chat -> repo map lite -> plan -> approve -> patch -> verify -> diff -> summarize
```

## Primary User

The primary user is a developer working inside a local repository who wants an AI coding agent that can help with code changes while remaining understandable, reviewable, and safe.

## MVP User Experience

The user can run:

```bash
alix run "fix the failing test"
```

ALiX then:

1. Starts a session and writes an event log.
2. Builds a lightweight map of the repository.
3. Sends the request and selected context to a model provider.
4. Produces a short plan.
5. Requests approval before risky actions.
6. Applies edits only through the patch engine.
7. Creates a checkpoint before file changes.
8. Runs configured or discovered verification commands.
9. Shows a final diff and verification summary.
10. Leaves a replayable trace for the CLI and local UI.

## MVP Scope

The MVP includes:

- TypeScript/Node CLI.
- npm package setup.
- Event-sourced JSONL session kernel.
- RepoMapLite.
- Mock provider adapter.
- Provider adapter interface.
- File read/search tools.
- Shell tool with approval gate.
- Policy engine.
- Approval queue.
- Patch engine with structured patch and search/replace support.
- Checkpoint and rollback support.
- Basic verifier command runner.
- Local server with SSE event streaming.
- Vanilla JavaScript inspector UI for timeline, diffs, terminal output, approvals, and replay.

## MVP Non-Goals

The MVP does not include:

- Multi-agent worker orchestration.
- Full Tree-sitter/PageRank repo map.
- Semantic search.
- Browser automation.
- Docker or remote runtimes.
- MCP extension ecosystem.
- Skills and recipes.
- IDE extension.
- ACP compatibility.
- Production-grade provider routing.
- Autonomous long-running issue solving.

These are post-MVP extensions once the single-agent loop is reliable.

## Product Principles

### Local-First

ALiX runs in the user's local workspace and treats the local repo as the source of truth.

### Event-Sourced

Every meaningful action and observation is written to an append-only event log. CLI, UI, replay, approvals, and future subagents read from the same source of truth.

### Patch-Safe

Models do not write files directly. All edits pass through a strict patch engine with preimage validation, policy checks, checkpoints, diffs, and rollback.

### Provider-Neutral

ALiX supports multiple model providers through adapters. Provider differences are normalized where possible and preserved where they matter.

### Observable

The user can see what the agent planned, what tools it requested, what policy allowed or denied, what changed, what verification ran, and what remains risky.

### Extensible Later

The architecture leaves room for MCP, hooks, skills, recipes, subagents, browser automation, runtime sandboxes, and IDE/desktop surfaces.

## Acceptance Criteria

The MVP is complete when:

- `alix run "<task>"` starts a session and creates an event log.
- The event log can be replayed into the same session timeline.
- RepoMapLite runs before the first model plan.
- A mock provider can complete a full session without external API calls.
- File reads and shell commands go through policy checks.
- Risky actions can be approved or denied.
- A valid patch applies only after preimage validation.
- A checkpoint is created before file changes.
- A failed patch or failed verification can be rolled back.
- The verifier can run at least one discovered or configured command.
- The final output includes changed files, verification results, and residual risk.
- The local UI can show session timeline, approvals, diffs, terminal output, and replayed events.

## Recommended Defaults

```text
Runtime: TypeScript + Node
Package manager: npm
CLI name: alix
Initial provider: mock provider
First real provider: OpenAI or Anthropic
UI transport: SSE
UI implementation: vanilla JavaScript
Runtime provider: local process
```

## Relationship To Other Docs

- [Research Notes](./agentic-harness-research.md)
- [Event Kernel Schema](./architecture/event-kernel-schema.md)
- [Patch Engine Protocol](./architecture/patch-engine-protocol.md)
- [Configuration Format](./architecture/config-format.md)
- [Provider Adapter Interface](./architecture/provider-adapter-interface.md)
- [RepoMapLite](./architecture/repomap-lite.md)
- [Frontend Transport Design](./architecture/frontend-transport.md)
- [Implementation Readiness](./architecture/implementation-readiness.md)
