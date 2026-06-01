# ALiX Features

A tour of ALiX's capabilities, each with a working example.

## Autonomous task execution

ALiX runs tasks end-to-end without asking permission. It plans, executes, verifies, and repairs — automatically.

```bash
alix run "add a /healthz endpoint that returns 200 OK with uptime"
```

ALiX will:
- Classify as `feature`
- Find relevant files (router, server setup)
- Make the change
- Run tests
- Repair up to 3 times if anything fails

## 12 LLM providers

Switch providers with one command:

```bash
alix config set-default-model anthropic claude-opus-4-8
alix config set-default-model openai gpt-4o
alix config set-default-model google gemini-2.5-flash
alix config set-default-model ollama llama3.2
alix config set-default-model deepseek deepseek-chat
alix config set-default-model groq llama-3.1-70b
```

Plus: perplexity, minimax, zhipuai, grokai, openrouter, mock.

## MCP (Model Context Protocol)

MCP servers extend ALiX with new tools. Built-in registry of popular servers:

```bash
alix mcp add github
alix mcp add filesystem
alix mcp add postgres
```

See `alix mcp list-known` for all 7+ supported servers.

## Multi-agent coordination

Spawn specialized subagents for parallel work:

```bash
alix run "find all uses of deprecated auth() and replace with the new pattern"
```

ALiX will dispatch:
- **explorer** subagents to find usages
- **worker** subagents to make changes
- **reviewer** subagent to verify

## Inspector UI

Live web UI showing what ALiX is doing:

```bash
alix inspector
```

Visit http://127.0.0.1:4137 to see:
- Event timeline
- Tool calls with args and results
- Subagent activity
- Diff viewer
- Cost tracking

## Self-extensibility

The agent can author new skills at runtime:

```
User: "create a skill for translating markdown to HTML"
ALiX: [calls create_skill tool]
ALiX: "Skill 'md-to-html' registered. Try `alix run 'use md-to-html for README.md'`"
```

Available tools:
- `create_skill` — author a new skill
- `list_extensions` — see what's loaded
- `inspect_extension` — get details

## Memory and context

ALiX remembers across sessions:
- **Project memory** — facts about the codebase
- **User preferences** — your style choices
- **Session memory** — what happened last session

## Policy gating

Dangerous operations require approval:
- File deletes
- Shell commands
- Network calls
- Secret access

You approve once, ALiX remembers for the session.

## Verification

ALiX auto-discovers verification from your `package.json`:
- `npm test`
- `npm run build`
- `npm run typecheck`
- `npm run lint`

After every change, it runs these. Failures trigger repair.

## Event log

Every action is recorded in `.alix/sessions/<id>/events.jsonl`:
- Tool calls (with args, results, duration)
- Model responses (text, tool calls, usage)
- Verification results
- Subagent activity
- Approvals and rejections

Replay any session for debugging.