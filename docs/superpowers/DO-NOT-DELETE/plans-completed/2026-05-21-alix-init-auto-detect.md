# Auto-Detect `alix init` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `alix init` fully auto-detect with zero prompts. The harness owns scaffolding decisions, not the LLM or user.

**Architecture:** `runInit()` auto-detects git status, project type, provider, and model from environment/file patterns. No interactive prompts. Config + AGENTS.md written in one pass.

**Tech Stack:** TypeScript, Node.js, existing `DEFAULT_CONFIG`.

---

### Task 1: Auto-detect provider from environment

**Files:**
- Modify: `src/cli/commands/init.ts`

- [ ] **Step 1: Add provider detection helper**

After line 16, add:

```typescript
const PROVIDER_DEFAULTS: [string, string, string][] = [
  ["anthropic", "ANTHROPIC_API_KEY", "claude-sonnet-4-20250514"],
  ["openai", "OPENAI_API_KEY", "gpt-4o"],
  ["google", "GEMINI_API_KEY", "gemini-2.5-flash"],
  ["openrouter", "OPENROUTER_API_KEY", "gpt-4o"],
  ["ollama", "OLLAMA_API_KEY", "qwen2.5-coder:7b"],
];

function detectProvider(): { provider: string; model: string } {
  for (const [id, env, defaultModel] of PROVIDER_DEFAULTS) {
    if (process.env[env]) {
      return { provider: id, model: defaultModel };
    }
  }
  // Fallback: ollama (local, no key needed)
  return { provider: "ollama", model: "qwen2.5-coder:7b" };
}
```

- [ ] **Step 2: Replace hardcoded provider with detectProvider()**

In `runInit()`, replace lines 68-72:

```typescript
// OLD (hardcoded):
const selectedProvider = "ollama";
const selectedModel = "qwen2.5-coder:7b";

// NEW (auto-detect):
const { provider: selectedProvider, model: selectedModel } = detectProvider();
```

- [ ] **Step 3: Run tests**

```bash
npm run build && npm run test:node 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/init.ts
git commit -m "feat(init): auto-detect provider from environment
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Remove feature toggle prompts

**Files:**
- Modify: `src/cli/commands/init.ts`

- [ ] **Step 1: Remove yesNo prompts for features**

Remove lines 74-78 (the yesNo prompts). Replace with defaults:

```typescript
// All features enabled by default (MVP decision)
const enableUi = true;
const enableMcp = true;
const enableSkills = true;
const enableSubagents = true;
```

- [ ] **Step 2: Update console output**

Update the output to reflect auto-detection:

```typescript
console.log(`Using: ${selectedProvider} / ${selectedModel} (auto-detected)`);
```

- [ ] **Step 3: Run tests and commit**

```bash
npm run build && npm run test:node 2>&1 | tail -5
git add src/cli/commands/init.ts
git commit -m "feat(init): remove feature toggle prompts, use defaults
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Auto-detect git (non-interactive)

**Files:**
- Modify: `src/cli/commands/init.ts`

- [ ] **Step 1: Auto-init git without prompt**

Replace the git init section (lines 36-56) with non-interactive logic:

```typescript
// Step 0: Git check (auto)
const isGitRepo = existsSync(join(workDir, ".git"));
if (!isGitRepo) {
  try {
    execSync("git init --initial-branch=main", { cwd: workDir, stdio: "inherit" });
    console.log("Git initialized");
    // Add .alix/ to .gitignore
    const alixIgnore = "\n# ALiX\n.alix/\n";
    if (existsSync(gitignorePath)) {
      const existing = await readFile(gitignorePath, "utf8");
      if (!existing.includes(".alix/")) {
        await appendFile(gitignorePath, alixIgnore);
      }
    } else {
      await writeFile(gitignorePath, alixIgnore.trimStart());
    }
  } catch {
    console.warn("Warning: git init failed, continuing anyway");
  }
}
```

- [ ] **Step 2: Update test for non-interactive git**

The test `runInit gitignore handling: accepts git init and skips duplication` should still pass since the behavior is the same (just without the prompt).

- [ ] **Step 3: Run tests and commit**

```bash
npm run build && npm run test:node 2>&1 | tail -5
git add src/cli/commands/init.ts
git commit -m "feat(init): auto-init git, no prompt
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Update AGENTS.md template

**Files:**
- Modify: `src/cli/commands/init.ts`

- [ ] **Step 1: Make AGENTS.md more useful**

Replace the AGENTS.md content (lines 107-133) with a more informative template:

```typescript
// Create AGENTS.md
const agentsContent = `# Project

> Powered by ALiX. See \`.alix/\` for configuration.

## Stack

Define your tech stack here:
- Language:
- Framework:
- Database:

## Rules

- Prefer explicit over implicit
- Add tests for new functionality
- Run lint before commit

## Commands

| Command | Description |
|---------|-------------|
| \`alix run "<task>"\` | Run a task with the agent |

## Build & Test

\`\`\`bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test
\`\`\`
`;
await writeFile(agentsPath, agentsContent);
```

- [ ] **Step 2: Run tests and commit**

```bash
git add src/cli/commands/init.ts
git commit -m "feat(init): improve AGENTS.md template
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Final integration test

**Files:**
- None (integration verification)

- [ ] **Step 1: Test in clean directory**

```bash
cd /tmp && rm -rf alix-test-clean && mkdir alix-test-clean && cd alix-test-clean
node /path/to/cli.js init
ls -la
cat .alix/config.json | head -20
cat AGENTS.md | head -20
```

Expected output:
```
Detected: New project (default: Node.js)
Using: ollama / qwen2.5-coder:7b (auto-detected)
Git initialized
✓ ALiX initialized in /tmp/alix-test-clean
```

- [ ] **Step 2: Verify files created**

```bash
ls -la
# Should have: .git/, .alix/, AGENTS.md, .gitignore
```

- [ ] **Step 3: Commit final**

```bash
git add .
git commit -m "chore: finalize auto-detect init
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Self-Review Checklist

- [ ] No prompts in `runInit()` — fully automated
- [ ] Provider detected from environment variables
- [ ] Git auto-initialized if not present
- [ ] .alix/config.json written with correct defaults
- [ ] AGENTS.md created with useful template
- [ ] All tests pass
- [ ] Integration test works in clean directory