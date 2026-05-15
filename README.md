# ALiX

**Agentic Lifecycle & Intelligence eXchange**

A local-first agentic coding harness for developers who want the agent to own a task end-to-end: plan, execute file changes, run verification, and repair failures — without stopping to ask.

## What it does

Give ALiX a task and walk away. It classifies the task, calls tools, runs your `test`/`build`/`typecheck` scripts after every change, and loops until verification passes. It stops after 3 failed repair attempts so you don't come back to a machine gone wrong.

```
$ alix run "fix the null pointer in user.ts"
```

## Key Features

- **Autonomous loop** — runs until verification passes and the model signals done
- **On-device agents** — works with any OpenAI-compatible API (Anthropic, OpenAI, Google, Groq, Ollama, DeepSeek, etc.)
- **MCP tools** — discover and use MCP servers as first-class tools
- **Verification discovery** — finds `test`, `build`, `typecheck`, `lint` from `package.json`
- **Policy gating** — approve dangerous operations before they run
- **Event log** — every tool call, model response, and verification result is recorded in `.alix/sessions/`
- **Inspector UI** — local web UI showing session timeline, diff viewer, and live event stream

## Quick Start

### Requirements

- Node 24+

### Install

```bash
npm install
npm run build
```

### Configure an API key

```bash
alix config set-key anthropic
# paste your API key when prompted
```

### Run a task

```bash
alix run "add OAuth login to the auth module"
```

### Start the inspector

```bash
alix serve
# open http://127.0.0.1:4137
```

### MCP servers

```bash
alix mcp discover mcp-server-fetch  # install an MCP server
alix mcp list                       # see connected servers
alix mcp test github                # test a server works
```

## Architecture

```
task → model → tool calls → executor → file changes
              ↑                              ↓
         verification              results back to model
              ↑                              ↓
         loop until done or max repairs reached
```

The agent runs an event-sourced loop backed by an append-only JSONL log (`.alix/sessions/<id>/events.jsonl`). Every tool result, model response, and verification check is recorded.

## Verification

ALiX discovers verification scripts from your `package.json`:

```bash
npm test         # runs first
npm run build    # runs if present
npm run typecheck # runs if present
npm run lint     # runs if present
```

Failed checks trigger the repair loop — the output is fed back to the model with a fix prompt. Docs tasks skip verification entirely.

## Configuration

Config files are loaded in priority order:

1. Project: `.alix/config.json`
2. User: `~/.config/alix/config.json`
3. Global: `/etc/alix/config.json`

Or use `alix config set-default-model` and `alix config set-key <provider>` for quick setup.

## Repository Layout

```
src/
  cli.ts              CLI entrypoint
  run.ts              Agent loop
  config/             Schema, defaults, loaders
  events/             JSONL event log
  mcp/                MCP manager, registry, deferral, transports
  providers/          12 provider adapters
  policy/             Policy engine
  patch/              Patch engine
  verifier/            Verification discovery
  tools/              Tool executor
  checkpoints/         File checkpoint
  server/             Inspector SSE server
  ui/                 Vanilla JS inspector UI
  utils/               Shared utilities
tests/                Node --test suite
docs/                 Specs, plans, PRDs
```

## License

MIT — see [LICENSE](LICENSE)