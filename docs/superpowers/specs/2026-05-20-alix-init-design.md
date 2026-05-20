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

Write `.alix/config.json` with:

```json
{
  "version": 1,
  "model": {
    "provider": "<selected-provider>",
    "name": "<selected-model>",
    "temperature": 0.2,
    "streaming": true
  },
  "permissions": {
    "default": "ask",
    "tools": {
      "file.read": "allow",
      "file.write": "ask",
      "shell.run": "ask",
      "git.diff": "allow"
    },
    "protectedPaths": [".git/**", ".env", ".env.*", "secrets/**"],
    "allowNetworkDomains": [],
    "denyCommands": ["rm -rf /", "git push --force"],
    "sessionMode": "ask"
  },
  "context": {
    "repoMap": true,
    "repoMapMode": "lite",
    "maxRepoMapTokens": 4000,
    "semanticSearch": false,
    "includeGitStatus": true,
    "pinnedFiles": []
  },
  "runtime": {
    "provider": "process",
    "shell": "bash",
    "commandTimeoutMs": 120000,
    "envAllowlist": ["PATH", "HOME", "SHELL"]
  },
  "ui": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 4137,
    "transport": "sse"
  },
  "mcpServers": [
    { "type": "stdio", "name": "fetch", "command": "uvx", "args": ["mcp-server-fetch"] }
  ],
  "skills": {
    "factory": { "enabled": false, "provider": "ollama", "model": "llama3", "maxStore": 50, "maxCandidates": 20, "autoPromote": false },
    "store": { "enabled": true, "path": "<homedir>/.alix/skills" }
  },
  "extensions": {
    "store": { "enabled": true, "path": "<homedir>/.alix/extensions" }
  },
  "subagents": {
    "enabled": true,
    "thinking": { "provider": "ollama", "name": "phi4-mini-reasoning" },
    "coding": { "provider": "ollama", "name": "qwen2.5-coder:7b" },
    "fast": { "provider": "ollama", "name": "llama3.2:3b" },
    "roles": [
      { "role": "explorer", "mode": "read_only", "style": "fast", "retryCount": 1 },
      { "role": "reviewer", "mode": "read_only", "style": "thinking", "retryCount": 1 },
      { "role": "test_investigator", "mode": "read_only", "style": "thinking", "retryCount": 1 },
      { "role": "docs_researcher", "mode": "read_only", "style": "fast", "retryCount": 1 },
      { "role": "worker", "mode": "write", "style": "coding", "retryCount": 0 }
    ]
  }
}
```

Only non-default values need to be written. Use `DEFAULT_CONFIG` as the base and override selected fields.

---

## File Structure

- New: `src/cli/commands/init.ts` — wizard logic, self-contained
- Modify: `src/cli.ts` — add `if (command === "init")` branch

---

## Error Handling

- If cwd is not writable, exit with error
- If API key is missing and model fetch fails, offer to skip model selection
- If git init fails, warn but continue with config write
- If `.alix/config.json` already exists, prompt: `Update existing config? [y/N]:` — if yes, overwrite; if no, exit

---

## Exit

On success: `✓ ALiX initialized in <cwd>` + brief next steps:
```
Next steps:
  alix run "your first task"
  alix serve    # start UI inspector
```
