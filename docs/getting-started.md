# Getting Started with ALiX

ALiX is an autonomous coding agent that runs locally on your machine. This guide gets you from `npm install` to your first completed task in under 5 minutes.

## 1. Install

```bash
npm install -g alix
```

(Or run from source: `git clone https://github.com/boduga/ALiX && cd ALiX && npm install && npm run build`.)

Requires Node 24+.

## 2. Set up an LLM provider

ALiX supports 12 providers. Pick one:

### Google Gemini (fast, free tier available)
```bash
export GEMINI_API_KEY="your-key"
alix config set-default-model google gemini-2.5-flash
```

### Anthropic Claude (recommended for coding)
```bash
export ANTHROPIC_API_KEY="your-key"
alix config set-default-model anthropic claude-opus-4-8
```

### OpenAI
```bash
export OPENAI_API_KEY="your-key"
alix config set-default-model openai gpt-4o
```

### Local Ollama (no API key)
```bash
# Start ollama
ollama serve &
# Then
alix config set-default-model ollama llama3.2
```

## 3. Initialize your project

```bash
cd your-project
alix init
```

This creates `.alix/config.json` with sensible defaults. It does NOT modify your source code.

## 4. Run your first task

```bash
alix run "find and fix any TypeScript errors in src/"
```

ALiX will:
1. Classify the task (`bugfix`)
2. Build a context bundle of relevant files
3. Call the LLM, get a plan
4. Execute file changes
5. Run `npm test` to verify
6. Repair failures (up to 3 times)
7. Report the final diff

## 5. View the session

While ALiX is running, open the Inspector UI:
```bash
alix inspector
# Then open http://127.0.0.1:4137
```

You'll see live event stream, current agent state, and a timeline of actions.

## 6. Add MCP servers (optional)

MCP servers extend ALiX with new tools. To add a server:

```bash
alix mcp add github --command "npx" --args "-y @modelcontextprotocol/server-github"
```

To list available servers: `alix mcp list-known`

## Common workflows

- `alix run "..."` — Run a task autonomously
- `alix chat` — Interactive chat mode
- `alix inspector` — Open the web UI
- `alix mcp list` — List configured MCP servers
- `alix config show` — Show current configuration
- `alix doctor` — Diagnose setup issues

## Next steps

- Read [Features](features.md) to see what ALiX can do
- Read [Configuration](configuration.md) for advanced config
- Browse [Examples](../examples/) for common task patterns
