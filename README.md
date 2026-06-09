# ALiX — Agent Operating System

**Agentic Lifecycle & Intelligence eXchange**

A local-first AI Agent OS. Run tasks, enforce policies, approve actions, audit everything, and persist work across sessions.

```bash
npm install -g alix
alix config set-default-model
alix run "explain the architecture of this project"
```

---

## Features

| Feature | What it does |
|---------|-------------|
| **Graph execution** | Structured multi-node TaskGraphs with dependency ordering, timeouts, and rerun |
| **Capability registry** | Agent/tool cards declare what each component can do. Resolve capabilities to agents and tools |
| **Policy engine** | First-match-wins policy rules: allow/ask/deny per capability, risk level, or tool |
| **Approval queue** | File-backed approval requests. CLI-first: list, approve, deny. Cooperative cancel |
| **Audit trail** | Append-only JSONL audit for policy decisions, approval lifecycle, and runtime outcomes |
| **RuntimeIndex** | Unified event index across sessions, graphs, approvals, audit, and daemon tasks |
| **SOP packs** | Repeatable multi-node workflows (research.deep_report, infra.docker_compose_audit) |
| **Persistent daemon** | Background process with Unix socket, task queue, cooperative cancel, crash recovery |
| **Inspector UI** | Local web dashboard with live sessions, graph view, policy, approvals, audit, registry, daemon |
| **Autonomous loop** | Plans first, then executes. Reviews the plan with you before touching files |
| **12 LLM providers** | Anthropic, OpenAI, Google, DeepSeek, Groq, Ollama, Perplexity, and more |
| **MCP support** | Full Model Context Protocol client — tool discovery, deferral, caching, transport |
| **Patch engine** | Structured patches with preimage validation, git-aware checkpoints, automatic rollback |
| **Local llama.cpp** | Auto-starts `llama-server` on demand. Grammar-constrained tool calling |

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
| `alix run "<task>"` | Default flow: plan → approve → execute. Supports `--no-plan`, `--mode=bypass`, `--resume <id>` |
| `alix chat` | Interactive chat with web search tools |
| `alix tui` | Multi-task terminal UI |
| `alix serve` | Start the inspector web UI at `localhost:4137` |
| `alix daemon start|stop|status` | Persistent background daemon lifecycle |
| `alix daemon tasks|cancel|doctor` | Task queue management and daemon health |
| `alix submit "<task>"` | Submit a task to the daemon (streaming output) |
| `alix sop list|show|run|doctor` | SOP pack catalog and execution |
| `alix policy list|doctor|eval` | Policy rule management and evaluation |
| `alix approvals list|pending|approve|deny` | Approval queue management |
| `alix audit list|by-graph|by-approval|by-action` | Audit trail queries |
| `alix runtime events|timeline` | Unified runtime event queries |
| `alix graph run|preflight|rerun|continue` | Graph execution and management |
| `alix registry list|agents|tools|doctor` | Agent/tool card registry |
| `alix doctor` | Comprehensive system health check |
| `alix config show` | Show current configuration |
| `alix config set-default-model` | Interactive provider + model selection |
| `alix session list|show` | Session management |

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

## Walkthrough: Plan → Approve → Execute

When you run `alix run "<task>"`, plan mode is the default. Here's what happens:

### 1. Task classification

ALiX classifies your task type (feature, bugfix, refactor, docs, research) and selects relevant context.

### 2. Context compilation

The repo is analyzed — related files, tests, symbol definitions, and git activity are ranked by relevance to your task within your token budget.

### 3. Plan generation

The model generates a structured plan without calling any tools:

```
$ alix run "add a healthz endpoint to src/server.ts"

## Plan: Add /healthz endpoint
**Type:** feature | **Complexity:** low | **Risk:** low

### Changes
1. **Create** `src/routes/health.ts`
   - GET handler returning `{ status: "ok", timestamp: Date.now() }`
2. **Modify** `src/server.ts`
   - Import and register `/healthz` route

### Verification
- `npm run build` passes
- `curl localhost:3000/healthz` returns 200

### Impact
- No callers affected
- No breaking changes

Approve plan? [Y/n/e/d] _
```

### 4. Approval

| Key | Action |
|-----|--------|
| **Y** / Enter | Approve and execute |
| **n** | Reject — cancels the task |
| **e** | Edit — opens `$EDITOR` to modify the plan before approving |
| **d** | Detail — shows full context and expanded plan |

Once approved, the plan is injected into the agent's system prompt as a shared commitment.

### 5. Execution

The agent executes the plan step by step, calling tools (file read, search, edit, shell) as needed. Each tool call is logged and the output is shown. On completion, verification runs automatically.

### 6. Resume Interrupted Sessions

If a session is interrupted (max iterations, crash, Ctrl+C), you can resume it:

```bash
# List all sessions to find the interrupted one
alix session list

# Resume it
alix run --resume <session-id>
```

The agent picks up from where it left off — prior context, scope approvals, and plan are restored. No tool calls are re-executed.

```bash
# Short read-only tasks skip plan generation automatically
alix run "list files in src/" --session-mode bypass

# Development task with plan
alix run "fix the TS2322 error in src/auth.ts"
# → Plan prints, approve with Y
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

ALiX is a layered Agent OS. See `docs/architecture/runtime-spine.md` for the full reference.

```
Execution    → runTask(), GraphExecutor, daemon-server
Governance   → CapabilityResolver, RuleEvaluator, RuntimeGate, ApprovalStore
Observability→ RuntimeIndex, GraphProjection, Inspector UI
Registry     → CardRegistry, AgentCard, ToolCard
Workflow     → SOP packs (research, infra)
Daemon       → DaemonManager, TaskRegistry, Unix socket server
```

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
