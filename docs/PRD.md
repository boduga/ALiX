# ALiX — Product Requirements Document

**Version:** 0.1.0
**License:** MIT
**Author:** Babasola Oduga (boduga)
**Repository:** github.com/boduga/ALiX
**Status:** Pre-open-source

---

## 1. Product Overview

ALiX (Agentic Lifecycle & Intelligence eXchange) is a local-first, CLI-driven coding agent harness built for developers who want AI-assisted coding that is **understandable, reviewable, and safe**.

It runs in your workspace, plans work, applies edits through a strict patch engine, runs verification, preserves a replayable event log, and can be inspected through a local web UI. It is provider-neutral — supporting Anthropic, OpenAI, Google, OpenRouter, Groq, Ollama, Perplexity, MiniMax, ZhipuAI, GrokAI, DeepSeek, and a local mock provider.

ALiX is not a wrapper around Claude Code, Codex CLI, or any other harness. It is a clean-room implementation of patterns proven in production, designed to be owned and extended by the developer community.

---

## 2. Why ALiX Exists

Current agentic coding tools share a set of persistent problems:

- **Opaque execution** — you see the result, not the process. Failed runs offer no trail to diagnose.
- **Vendor lock-in** — the best UX patterns are proprietary and Anthropic-specific.
- **Unsafe edits** — models write files directly. One bad rewrite can destroy hours of work.
- **No verification** — tools apply patches and move on without confirming the changes actually work.
- **Unbounded runs** — agents can wander, expand scope, or retry indefinitely without stopping.

ALiX was designed around these failure modes. Every design decision traces back to one of these pain points.

---

## 3. Who ALiX Is For

**Primary user:** A developer working in a local repository who wants an AI coding agent that helps with code changes while remaining fully transparent and safe.

**Secondary user:** A team that wants to evaluate, contribute to, or build on an open agentic harness without depending on a proprietary platform.

ALiX is not for:
- Non-developers who want a general-purpose AI assistant
- Teams that want a hosted, managed agentic service
- Users who prefer GUI-based tools over CLI

---

## 4. Core Features (v0.1.0)

### Provider Abstraction

- 12 provider adapters (Anthropic, OpenAI, Google, OpenRouter, Groq, Ollama, Perplexity, MiniMax, ZhipuAI, GrokAI, DeepSeek, mock)
- Shared `BaseProvider` class handles HTTP, auth, and error normalization
- Per-provider edit format preference (structured_patch, search_replace, full_file)
- tiktoken-based token counting with encoding-aware budget management
- Streaming support with auto-disable in non-TTY environments

### Agent Loop

- Model-agnostic run loop with tool call iteration
- Policy engine with allow/ask/deny decisions on every tool call
- Approval queue for risky operations (file writes, shell commands)
- Automatic context truncation when token budget is exceeded
- Session digest synthesized from event log for long-running sessions

### Tool System

- Built-in file tools: read, write, patch, create, delete, glob, grep
- Shell tool with output truncation (80KB max), stderr separation, approval gating
- MCP server support with on-demand schema resolution and fuzzy tool search
- Extensible hooks via `.alix/hooks.json` (pre_task, post_task, on_change)

### Observability

- Append-only JSONL event log for every session under `.alix/sessions/<id>/events.jsonl`
- Local inspector web UI at `http://127.0.0.1:4137` with SSE streaming
- Session replay from disk via the inspector
- Rolling session digest replacing removed context messages on truncation

### Safety

- Patch engine with preimage validation before any edit
- Checkpoints created before file changes (git-aware)
- Rollback on failed patch or failed verification
- Protected path policy (denies writes to `.git`, `.env`, and configured paths by default)

---

## 5. Architecture

```
alix run "<task>"
       |
       v
  Session Kernel (event-sourced JSONL log)
       |
       v
  Context Builder (repo map + token budget)
       |
       v
  Agent Loop  ──────────────────────────────┐
       |                                     |
       v                                     v
  Policy Engine ──> Tool Executor ──> Verifier
       |                                     |
       v                                     v
  Patch Engine ──> File System          CLI / Inspector UI
       |                                     ^
       v                                     |
  Checkpoints ───────────────────────────────┘
```

**Key directories:**
- `src/cli.ts` — CLI entrypoint and command routing
- `src/run.ts` — agent loop and session orchestration
- `src/providers/` — 12 provider adapters with shared `BaseProvider`
- `src/tools/` — built-in tool implementations
- `src/mcp/` — MCP server registry, tool deferral, stdio transport
- `src/policy/` — policy engine and approval queue
- `src/patch/` — patch engine with preimage validation
- `src/hooks/` — hook discovery and runner
- `src/utils/tokens.ts` — tiktoken encoder cache and budget truncation
- `src/utils/session-digest.ts` — event log replay and digest synthesis
- `src/server/` — local inspector SSE server
- `src/ui/` — vanilla JavaScript inspector UI

---

## 6. Non-Goals (v0.1.0)

ALiX v0.1.0 does **not** include:

- Multi-agent worker orchestration
- Browser automation
- Docker or remote runtime sandboxes
- IDE or desktop extensions
- Semantic/symbolic search index
- Tree-sitter-based repo map
- Skills, recipes, or custom command bundles
- ACP compatibility
- Production-grade provider cost tracking
- Autonomous long-running issue solving

These are post-v0.1.0 roadmap items. The single-agent loop must be reliable and well-understood before these features are added.

---

## 7. Community Model

### What Contributions Look Like

ALiX is built for developers who want to understand and extend their coding agent. Contributions are welcome at all levels:

- **Bug reports and issue triage** — reproducible issues with clear steps
- **Provider adapter improvements** — better error messages, streaming fixes, model-specific prompting
- **New tools and hooks** — well-scoped, documented, with tests
- **Documentation** — clearer explanations, better examples, working copy
- **Performance work** — token budget optimization, faster startup, leaner tool resolution

### What Good PRs Look Like

- Small, focused, reviewable in under 15 minutes
- Includes tests that verify behavior, not just presence
- Does not expand scope beyond the stated change
- Has a clear description of what and why
- Passes `npm run check` (build + typecheck + tests)

### Test Requirements

All PRs must pass:
```bash
npm run check
```

This runs:
```bash
npm run build   # TypeScript compilation
npm test        # 198 tests (194 passing, 4 skipped — require API credentials)
```

Integration tests that require a live model API are skipped by default. They can be enabled via the `TEST_WITH_LIVE_API=1` environment variable.

### Code Style

- TypeScript with strict mode
- No external runtime dependencies beyond the existing package set
- Prefer `src/` organization over `lib/`
- No placeholder TODOs in committed code
- Error messages must be actionable (what failed, why, how to fix)

---

## 8. Roadmap

The roadmap reflects **honest near-term work**, not a fantasy backlog. Items are not committed timelines.

### v0.1.0 — Initial Open Source (current)

Everything already implemented and passing tests. This is what ships on day one.

### v0.2.0 — Developer Experience

- Implement or remove the broken `alix config list-models` command
- Improve generic error messages across provider adapters (no more bare `throw new Error(\`API error ${status}\`)`)
- Add `.github/` templates for issues and pull requests
- Write `CONTRIBUTING.md` with setup instructions
- Populate `CHANGELOG.md` from current commit history

### v0.3.0 — Observability Improvements

- Add token usage reporting to session events (input/output per call)
- Make inspector UI render live session events during a run
- Add session replay scrubber (seek to any event in the log)
- Surface verification results in both CLI output and inspector

### v0.4.0 — MCP Ecosystem

- Add more MCP server discovery sources
- Support MCP resource subscriptions
- MCP tool provenance tracking in event log

### v0.5.0 — Context Intelligence

- File change history from git log for context prioritization
- Test-file-to-source-file mapping from naming conventions
- Configurable token budget per task type (exploration vs. editing)

---

## 9. License

ALiX is released under the **MIT License**.

```
MIT License

Copyright (c) 2026 Babasola Oduga

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Appendix: Relationship to Prior Work

This document builds on:
- **MVP Product Spec** (`docs/mvp-product-spec.md`) — product definition, acceptance criteria, non-goals
- **Agentic Harness Research** (`docs/agentic-harness-research.md`) — competitive analysis, design rationale, architecture decisions

The implementation is tracked in plans under `docs/superpowers/plans/`. All 8 plans are complete and their checkboxes reflect the current shipped state.