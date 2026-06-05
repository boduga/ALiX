# ALiX

**Agentic Lifecycle & Intelligence eXchange**

A local-first, CLI-driven coding agent harness. Give it a task and walk away — it plans, edits files, runs verification, and repairs failures autonomously.

```bash
npm install -g alix
alix config set-default-model deepseek deepseek-v4-flash
alix run "fix the null pointer in user.ts"
```

---

## Features

| Feature | What it does |
|---------|-------------|
| **Autonomous loop** | Plans first, then executes. Reviews the plan with you before touching files. Approve, reject, or edit — or skip with `--no-plan` |
| **12 LLM providers** | Anthropic, OpenAI, Google, DeepSeek, Groq, Ollama, Perplexity, MiniMax, ZhipuAI, GrokAI, OpenRouter, Mock |
| **Multi-embedder context** | Semantic + code embedding models fused with task-type-aware weights. Kernel/grounding-set file prioritization based on dependency graph connectivity |
| **Web search** | Built-in `web_search` and `web_fetch` tools via Brave Search API |
| **MCP support** | Full Model Context Protocol client — tool discovery, deferral, caching, transport |
| **Subagent delegation** | Role-based subagents (explorer, reviewer, worker, etc.) with file ownership tracking |
| **Self-extensible hooks** | `create_hook` generates TypeScript hook code from plain language — the agent extends its own harness (Pi Agent pattern) |
| **Patch engine** | Structured patches with preimage validation, git-aware checkpoints, and automatic rollback on failure |
| **Policy engine** | Allow/ask/deny for every tool call. Session modes: auto, ask, bypass. Secret scanning |
| **Inspector UI** | Local web dashboard at `localhost:4137` with live SSE event stream, session replay, cost tracking, decision timeline |
| **Local llama.cpp** | Auto-starts `llama-server` on demand. Grammar-constrained tool calling via JSON schema |
| **TUI mode** | `alix tui` — multi-task terminal UI with continuous session and streaming output |
| **Verification** | Auto-discovers `npm test`, `build`, `typecheck`, `lint`. Runs after every change. Skips on read-only tasks |
| **Event log** | Append-only JSONL per session in `.alix/sessions/<id>/events.jsonl`. Replay any session |

---

## Quick Start

### Requirements

- Node 24+
- An API key from one of the supported providers (free tier available on Google, DeepSeek)

### Install

```bash
npm install -g alix
# or from source:
git clone https://github.com/boduga/ALiX.git
cd ALiX
npm install
npm run build
```

### Set up a provider

```bash
alix config set-default-model
# Follow the interactive menu — picks provider, sets API key, downloads model list
```

### Run your first task

```bash
alix run "list the files in src/" --session-mode bypass
```

### Open the inspector

```bash
alix serve
# Visit http://127.0.0.1:4137
```

---

## Commands

| Command | Description |
|---------|-------------|
| `alix run "<task>"` | Default flow: plan → approve → execute. Supports `--no-plan`, `--no-stream`, `--mode=bypass` |
| `alix chat` | Interactive chat with web search tools |
| `alix tui` | Multi-task terminal UI (continuous session) |
| `alix serve` | Start the inspector web UI |
| `alix config show` | Show current configuration |
| `alix config set-default-model` | Interactive provider + model selection (live API) |
| `alix config set-tier [tier]` | Set model for a subagent tier |
| `alix config set-key` | Set an API key |
| `alix mcp list` | List connected MCP servers |
| `alix mcp add` | Add an MCP server |
| `alix agent <role> "<prompt>"` | Spawn a subagent directly |
| `alix memory list` | List memory entries |

---

## Examples

```bash
# Fix a bug (plan mode is default — you approve before any file changes)
alix run "fix the TS2322 error in src/auth.ts"
# → Plan prints, you approve: [Y/n/e/d]

# Approve plan non-interactively
echo "y" | alix run "fix the TS2322 error"

# Skip plan mode entirely for quick tasks
alix run "list files in src/" --no-plan

# Research question (auto-approves plan — read-only task)
alix run "who is the current president of Nigeria" --session-mode bypass

# Multi-task in TUI
alix tui
> list files in src/
> fix the null pointer in user.ts
> who is the current president

# Create a hook (Pi-style self-extensibility)
alix run "use create_hook to register a hook that logs every file.delete to audit.txt"

# Use web search
alix run "what are the latest developments in AI agents" --session-mode bypass
```

---

## Configuration

Config files are loaded in priority order:

1. **Project**: `.alix/config.json` (in your project root)
2. **User**: `~/.config/alix/config.json` (homedir XDG)
3. **Global**: `/etc/alix/config.json`

### Subagent tiers

Subagent roles use model tiers that you can set independently:

```bash
alix config set-tier thinking   # Strategic reasoning, planning
alix config set-tier coding     # Code generation, tool execution
alix config set-tier fast       # Quick classification, routing
```

Each tier inherits from the main model if not explicitly configured.

See `docs/configuration.md` for the full reference.

---

## Architecture

```
task → classify → context bundle → model → tool calls → execute → verify
                 ↑                                          |
                 └──────────────── repair (max 3) ──────────┘
```

The agent runs an event-sourced loop backed by an append-only JSONL log. Every model response, tool result, and verification check is recorded and replayable.

### Seven modules

| Module | Responsibility |
|--------|---------------|
| `src/providers/` | 12 provider specs + unified dispatcher |
| `src/agent/` | Agent loop, initialization, streaming |
| `src/run/` | Task loop (tool execution, verification, repair) |
| `src/tools/` | File, shell, patch, web, MCP tool routers |
| `src/repomap/` | Repo mapping, context compilation, multi-embedder search |
| `src/extensions/` | Extension registry, hook runner, skill lifecycle |
| `src/tui/` | Terminal UI (split-screen, event-driven status) |

---

## Web Tools

ALiX can search the web and fetch page content with built-in tools.

```bash
export BRAVE_API_KEY="BSA..."
```

Free key at [api.search.brave.com/app/dashboard](https://api.search.brave.com/app/dashboard)

---

## Local Inference

ALiX can run entirely locally with llama.cpp:

```bash
export ALIX_LLAMA_MODEL_PATH="~/llama.cpp/models/your-model.gguf"

# ALiX auto-starts llama-server on demand — no manual server management
alix run "explain the dependency injection pattern" --session-mode bypass
```

Grammar-constrained tool calling ensures the local model produces valid tool call JSON. Supports Phi-3, Qwen2.5-Coder, DeepSeek Coder, and any GGUF model.

---

## Development

```bash
npm run build          # TypeScript compilation
npm test               # Full test suite (node:test + vitest)
npm run check          # Build + test + verify:deps
npm run verify:deps    # Check all deps are pinned
```

### Project structure

```
src/          — Source code
tests/        — Test suite (node:test)
dist/         — Compiled output
docs/         — Specs, plans, architecture
.alix/        — Agent config, sessions, embeddings
```

---

## Supply-Chain Policy

- All direct dependencies are pinned to exact versions
- `.npmrc` enforces `save-exact=true` and `min-release-age=2`
- `npm run verify:deps` checks all deps are pinned

---

## License

MIT
