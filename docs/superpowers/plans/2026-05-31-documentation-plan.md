# Documentation Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add focused, example-driven documentation to lower the barrier to adoption. Specifically: getting-started guide, examples directory, and a feature tour.

**Architecture:** New docs and `examples/` directory. Markdown files. No code architecture changes.

**Tech Stack:** Markdown, existing `docs/` patterns.

---

## File Structure

**New files:**
- `docs/getting-started.md` — Step-by-step setup (~150 lines)
- `docs/features.md` — Feature tour with examples (~200 lines)
- `docs/configuration.md` — Config reference (~150 lines)
- `examples/README.md` — Examples overview
- `examples/bug-fix.md` — Example: fix a bug
- `examples/add-feature.md` — Example: add a feature
- `examples/use-mcp.md` — Example: use an MCP server

**Modified files:**
- `README.md` — Link to new docs, simplify the main readme

---

## Task 1: Write getting-started guide

**Files:**
- Create: `docs/getting-started.md`

- [ ] **Step 1: Create the file**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/getting-started.md
git commit -m "docs: add getting-started guide"
```

---

## Task 2: Write features tour

**Files:**
- Create: `docs/features.md`

- [ ] **Step 1: Create the file**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/features.md
git commit -m "docs: add features tour with examples"
```

---

## Task 3: Write configuration reference

**Files:**
- Create: `docs/configuration.md`

- [ ] **Step 1: Create the file**

```markdown
# Configuration

ALiX configuration lives in `.alix/config.json` (per-project) and `~/.alix/config.json` (global). Per-project overrides global.

## Config file format

```json
{
  "model": {
    "provider": "google",
    "name": "gemini-2.5-flash"
  },
  "ui": {
    "port": 4137
  },
  "permissions": {
    "protectedPaths": [".git/**", ".env"]
  },
  "mcpServers": [...],
  "subagents": {...},
  "skills": {...}
}
```

## CLI commands

```bash
# Show current config
alix config show

# Set model
alix config set-default-model <provider> <model>

# Set API key (writes to .alix/config.json)
alix config set-key <provider> <key>

# Doctor: diagnose config issues
alix config doctor
```

## Model tiers

ALiX uses 3 model tiers for subagents:

- **fast** (Ollama) — simple lookups, file reads
- **thinking** (configurable) — analysis, planning
- **coding** (configurable) — code generation, edits

Override in config:

```json
{
  "subagents": {
    "modelTiers": {
      "fast": { "provider": "ollama", "name": "llama3.2" },
      "thinking": { "provider": "anthropic", "name": "claude-opus-4-8" },
      "coding": { "provider": "anthropic", "name": "claude-opus-4-8" }
    }
  }
}
```

## Environment variables

- `GEMINI_API_KEY` — Google
- `ANTHROPIC_API_KEY` — Anthropic
- `OPENAI_API_KEY` — OpenAI
- `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, etc.

Env vars take precedence over config file values.

## Supply chain

ALiX pins all direct dependencies. Verify with:

```bash
npm run verify:deps
```

See [Supply-Chain Policy](../README.md#supply-chain-policy) for details.
```

- [ ] **Step 2: Commit**

```bash
git add docs/configuration.md
git commit -m "docs: add configuration reference"
```

---

## Task 4: Create examples directory

**Files:**
- Create: `examples/README.md`
- Create: `examples/bug-fix.md`
- Create: `examples/add-feature.md`
- Create: `examples/use-mcp.md`

- [ ] **Step 1: Create examples/README.md**

```markdown
# Examples

Common ALiX tasks with expected output.

- [Bug fix](bug-fix.md) — Find and fix a TypeScript error
- [Add feature](add-feature.md) — Add a new endpoint
- [Use MCP](use-mcp.md) — Add a GitHub MCP server
```

- [ ] **Step 2: Create examples/bug-fix.md**

```markdown
# Example: Fix a TypeScript error

**Task:**
```bash
alix run "fix the TS2322 error in src/auth.ts"
```

**What ALiX does:**

1. Classifies as `bugfix`
2. Reads `src/auth.ts`, finds the error
3. Makes the fix
4. Runs `tsc --noEmit` to verify
5. Reports the diff

**Expected output:**

```
Classified: bugfix
Context: src/auth.ts (245 lines)

Found: Property 'role' is missing in type 'User'
Fix: Add 'role: string' to User interface

Diff:
- export interface User { name: string; email: string; }
+ export interface User { name: string; email: string; role: string; }

Verification: ✓ TypeScript compiles
```

**Time:** ~30 seconds
```

- [ ] **Step 3: Create examples/add-feature.md**

```markdown
# Example: Add a /healthz endpoint

**Task:**
```bash
alix run "add a GET /healthz endpoint that returns 200 with { status: 'ok', uptime: process.uptime() }"
```

**What ALiX does:**

1. Classifies as `feature`
2. Finds the Express router setup
3. Adds the endpoint
4. Runs tests
5. Repairs if anything fails

**Expected output:**

```
Classified: feature
Context: src/server.ts, src/routes/

Added:
+ router.get('/healthz', (req, res) => {
+   res.json({ status: 'ok', uptime: process.uptime() });
+ });

Verification: ✓ Tests pass
```

**Time:** ~45 seconds
```

- [ ] **Step 4: Create examples/use-mcp.md**

```markdown
# Example: Use a GitHub MCP server

**Setup:**

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_..."
alix mcp add github
```

**Task:**
```bash
alix run "list open issues in this repo assigned to me, summarize the top 3"
```

**What ALiX does:**

1. Discovers the GitHub MCP server
2. Calls `list_issues` with filter `assignee=me, state=open`
3. Reads the top 3
4. Summarizes

**Expected output:**

```
Classified: research
Loaded MCP tools: github.list_issues, github.get_issue, ...

Found 7 open issues. Top 3:

1. #142: "Memory leak in src/cache.ts"
   - High priority, opened 3 days ago
   - Affects long-running sessions

2. #138: "Add tests for context compiler"
   - Medium priority, opened 1 week ago

3. #135: "TUI flickers on diff updates"
   - Low priority, opened 2 weeks ago
```

**Time:** ~10 seconds (after MCP server is loaded)
```

- [ ] **Step 5: Commit**

```bash
git add examples/
git commit -m "docs: add examples directory with 3 worked examples"
```

---

## Task 5: Update main README to link to new docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add links to new docs**

In `README.md`, after the "Quick Start" section, add:

```markdown
## Documentation

- **[Getting Started](docs/getting-started.md)** — install and run your first task
- **[Features](docs/features.md)** — tour of all capabilities
- **[Configuration](docs/configuration.md)** — config file reference
- **[Examples](examples/)** — worked task examples
- **[Architecture](docs/architecture/)** — how ALiX is built
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: link to new documentation from main README"
```

---

## Task 6: Final verification

- [ ] **Step 1: Verify all docs render**

```bash
ls -la docs/getting-started.md docs/features.md docs/configuration.md examples/
```

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore(docs): documentation pass complete

- Getting started guide
- Features tour with examples
- Configuration reference
- 3 worked examples
- README links to new docs"
```

---

## Self-Review

- [x] Getting started → Task 1
- [x] Features tour → Task 2
- [x] Config reference → Task 3
- [x] Examples directory → Task 4
- [x] README links → Task 5
- [x] Final → Task 6

Plan length: 6 tasks. No code changes. Pure docs. ✓
