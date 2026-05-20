# `alix init` Design

**Goal:** Interactive project setup wizard for ALiX.

**Architecture:** New CLI command that runs in cwd. Detects existing state, runs an interactive 3-step wizard, writes `.alix/config.json`, and optionally initializes git with `.alix/` in `.gitignore`.

---

## Step 0: Git Check

**Auto-detect:**
- If `process.cwd()` is already inside a git repo, skip entirely.
- If not in a git repo, prompt: `Initialize git repository? [Y/n]:`
  - Enter/empty = yes
  - `n` = skip git init

**If initializing:**
1. Run `git init` with `--initial-branch=main`
2. Create default `.gitignore` with:
   ```
   node_modules/
   dist/
   build/
   .alix/
   ```
   (Append to existing `.gitignore` if present, don't overwrite.)

---

## Step 1: Project Type Detection

Auto-detect by scanning cwd for common files:

| File | Project Type |
|------|-------------|
| `package.json` | Node.js |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `pyproject.toml` / `setup.py` | Python |
| `Makefile` | Generic/C |
| `pom.xml` | Java |
| `*.sln` / `*.csproj` | .NET |

Display: `Detected: Node.js project` (or "No recognized project type").

---

## Step 2: Provider + Model Selection

**Provider:**
1. Show providers that have API keys in env, mark with `✓ detected`
2. Offer numbered list + "Other" option
3. User selects or skips to accept detected default

**Model:**
- If API key available, fetch model list from provider API (same logic as `alix config set-default-model`)
- Show first 30 models with token limits, numbered
- User selects or skips to accept recommended default

**Recommended defaults:**
| Provider | Default Model |
|----------|--------------|
| ollama | qwen2.5-coder:7b |
| anthropic | claude-sonnet-4-20250514 |
| openai | gpt-4o |
| google | gemini-2.5-flash |
| (no key) | ollama / qwen2.5-coder:7b |

---

## Step 3: Feature Toggles

Present toggles with `[Y/n]` defaults:

1. **Enable UI inspector?** `alix serve` — default: `yes` (if in project)
2. **Enable MCP servers?** — default: `yes` (offers to install `fetch` server)
3. **Enable skills?** — default: `yes`
4. **Enable subagents?** — default: `yes`

For MCP, if yes: ask whether to install the `fetch` MCP server (available by default in defaults).

---

## Output

### `.alix/config.json`

Write with selected options, using `DEFAULT_CONFIG` as base:

```json
{
  "version": 1,
  "model": {
    "provider": "<selected-provider>",
    "name": "<selected-model>",
    "temperature": 0.2,
    "streaming": true
  },
  ...
}
```

### `AGENTS.md`

Create `AGENTS.md` at project root (not inside `.alix/`). This is the onboarding doc for any AI agent working in the codebase.

**Contents:**

```markdown
# ALiX — Agentic Coding Harness

> Powered by ALiX. See `.alix/` for configuration.

## Quick Start

```bash
# Run a task
alix run "fix the login bug"

# Start the UI inspector
alix serve

# Plan a task without executing
alix plan "add user authentication"

# Review pending plan
alix review

# Apply reviewed plan
alix apply
```

## Commands

| Command | Description |
|---------|-------------|
| `alix run "<task>"` | Classify intent → build context → run agent loop → patch → verify → repair |
| `alix init` | Initialize project with git, config, and sensible defaults |
| `alix plan "<task>"` | Generate a machine-readable plan without executing |
| `alix review` | Review pending plan — show diffs, affected files, risk |
| `alix apply` | Execute patches from reviewed plan |
| `alix serve` | Start the SSE inspector UI |
| `alix config show` | Show current configuration |
| `alix config set-key` | Set API key for a provider |
| `alix config set-default-model` | Select default model interactively |
| `alix mcp list` | List connected MCP servers |
| `alix mcp add` | Add an MCP server |
| `alix agent <role> "<prompt>"` | Spawn a read-only subagent |
| `alix memory list` | List memory entries |
| `alix memory add` | Add a memory entry |

## Task Loop

1. **Classify** — IntentClassifier determines task type (code, bugfix, refactor, docs, test, config)
2. **Context** — ContextCompiler builds ranked context bundle (mentioned files, deps, tests, config, semantic matches)
3. **Plan** — Model proposes edits to files based on intent
4. **Approve** — If scope expansion detected (files outside initial scope), user is prompted in `ask` mode
5. **Patch** — EditFormatPolicy selects provider-appropriate format (search_replace / structured_patch)
6. **Verify** — VerificationPlanner runs cheapest checks first (typecheck → lint → build → test)
7. **Repair** — If verification fails, model gets residual risk report and retries (up to 3 loops)
8. **Summarize** — Session digest saved to memory

## State Machine

```
idle → planning → executing → verifying → repairing → summarizing → completed
                    ↑
                    └── (scope expansion) ──→ wait for approval
```

- `idle` — waiting for task
- `planning` — model thinking about approach
- `executing` — running tool calls, applying patches
- `verifying` — running verification checks
- `repairing` — fixing verification failures
- `summarizing` — saving session digest

## Session Modes

- `ask` — Prompt for confirmation on scope expansion (default)
- `auto` — Auto-approve safe scope expansions
- `bypass` — Skip all approvals (use with caution)

Pass with `--mode=auto` or `--mode=ask` or `--mode=bypass`.

## Context Compilation

Context is ranked by:
1. Task-mentioned files (exact match = 100, fuzzy = 70, base match = 60)
2. Semantic search matches (symbol-level)
3. Dependency graph traversal (forward + reverse)
4. Git activity boosting (recently modified files get up to +20 score)
5. Pinned files (score: 200, always included)
6. Config files (score: 10, always included)
7. Test files for bugfix tasks (score: 5)

Token budget enforced. If budget exceeded, lowest-scoring items are dropped.

## MCP Servers

MCP servers are lazy-loaded per task via ToolSelector. Only task-relevant tools (scored by keyword + semantic overlap) are loaded, up to `toolConfig.maxTools`. Full catalog available via `mcp_search_tools` meta-tool.

## Configuration

See `.alix/config.json`. Precedence: project config > global config > XDG config.

## Features

- **Patch reliability** — Per-provider edit format policy. Full-file rewrite blocked for existing files.
- **Checkpoint + rollback** — Files checkpointed before patch, rolled back on failure.
- **Verification** — Cost-ordered (typecheck → lint → build → test), residual risk reported honestly.
- **Memory** — Session digests saved to `.alix/memory/`. Project/user/feedback/reference types.
- **Subagents** — Read-only roles (explorer, reviewer, test_investigator, docs_researcher). Write-capable worker role.
- **Skills** — Loaded from `~/.alix/skills` or project path. SkillFactory for auto-promotion.
- **Extensions** — Unified taxonomy: skills, hooks, recipes, subagents, plugins, MCP.

## Architecture

See `docs/agentic-harness-research.md` for the full research spec.

Key files:
- `src/run.ts` — Task loop entry point
- `src/repomap/context-compiler.ts` — Context compilation pipeline
- `src/autonomy/scope-tracker.ts` — Scope tracking and expansion detection
- `src/tools/executor.ts` — Tool execution with policy enforcement
- `src/patch/` — Patch application, format policy, checkpointing
- `src/verifier/` — Verification discovery and execution
- `src/events/` — Event log and session replay
```

**Note:** If `CLAUDE.md` already exists at project root, ALiX respects it. `AGENTS.md` is the fallback for non-Claude AI agents. Both can coexist — `AGENTS.md` is framework-agnostic.

---

## Exit

On success: `✓ ALiX initialized in <cwd>` + brief next steps:
```
Next steps:
  alix run "your first task"
  alix serve    # start UI inspector
  alix plan     # plan without executing
```
