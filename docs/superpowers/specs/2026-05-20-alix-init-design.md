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

Create `AGENTS.md` at project root (not inside `.alix/`). This is the framework-agnostic onboarding doc — follows the [agents.md](https://agents.md) standard. Replace the existing AGENTS.md if present.

**Contents:**

```markdown
# [Project Name]

> Powered by ALiX. See `.alix/` for configuration.

## Setup

```bash
npm install
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

## Build & Test

```bash
npm run build   # Compile TypeScript
npm test        # Run tests
```

## Architecture

Key directories:
- `src/` — Source code
- `tests/` — Tests
- `docs/` — Documentation
- `.alix/` — ALiX configuration (not tracked in git)
```

---

## Exit

On success: `✓ ALiX initialized in <cwd>` + brief next steps:
```
Next steps:
  alix run "your first task"
  alix serve    # start UI inspector
  alix plan     # plan without executing
```
