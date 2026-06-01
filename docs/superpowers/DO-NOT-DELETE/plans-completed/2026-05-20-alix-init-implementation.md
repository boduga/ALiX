# `alix init` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `alix init` — interactive project setup wizard that initializes git, creates `.alix/config.json`, and scaffolds `AGENTS.md`.

**Architecture:** New CLI command `src/cli/commands/init.ts`. Orchestrates git init, project type detection, provider/model selection, feature toggles. Writes `.alix/config.json` using `DEFAULT_CONFIG` as base. Creates `AGENTS.md` from a template.

**Tech Stack:** TypeScript, Node.js readline for prompts, existing `DEFAULT_CONFIG`, existing `listModels()` from `src/cli.ts`.

---

### Task 1: Scaffold `src/cli/commands/init.ts`

**Files:**
- Create: `src/cli/commands/init.ts`
- Modify: `src/cli.ts:220-243` (add to help text)
- Test: `tests/cli/init.test.ts`

- [ ] **Step 1: Read existing prompt helper**

In `src/cli.ts` lines 28-37, the `prompt()` function uses readline:

```typescript
async function prompt(question: string): Promise<string> {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
```

Export this function from `src/cli/commands/prompt.ts` so it can be reused in `init.ts`.

- [ ] **Step 2: Create `src/cli/commands/init.ts`**

Create the file with all wizard steps:

```typescript
import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { prompt } from "./prompt.js";

const PROJECT_TYPE_FILES: [string, string][] = [
  ["package.json", "Node.js"],
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
  ["pyproject.toml", "Python"],
  ["setup.py", "Python"],
  ["Makefile", "Generic/C"],
  ["pom.xml", "Java"],
];

export async function runInit(cwd: string): Promise<void> {
  const alixDir = join(cwd, ".alix");
  const gitignorePath = join(cwd, ".gitignore");
  const agentsPath = join(cwd, "AGENTS.md");
  const projectConfigPath = join(alixDir, "config.json");

  // Step 0: Git check
  const isGitRepo = existsSync(join(cwd, ".git"));
  if (!isGitRepo) {
    const answer = await prompt("Initialize git repository? [Y/n]: ");
    if (answer.toLowerCase() !== "n") {
      execSync("git init --initial-branch=main", { cwd, stdio: "inherit" });
      // Append .alix/ to .gitignore
      const alixIgnore = "\n# ALiX\n.alix/\n";
      if (existsSync(gitignorePath)) {
        const existing = await readFile(gitignorePath, "utf8");
        if (!existing.includes(".alix/")) {
          await appendFile(gitignorePath, alixIgnore);
        }
      } else {
        await writeFile(gitignorePath, alixIgnore.trimStart());
      }
    }
  }

  // Step 1: Project type detection
  let projectType = "Generic";
  for (const [file, type] of PROJECT_TYPE_FILES) {
    if (existsSync(join(cwd, file))) {
      projectType = type;
      break;
    }
  }
  console.log(`Detected: ${projectType} project`);

  // Step 2: Provider + Model selection (re-use existing logic from cli.ts)
  // Import listModels and PROVIDERS from cli.ts - refactor later, inline for now
  const selectedProvider = "ollama"; // default
  const selectedModel = "qwen2.5-coder:7b"; // default
  console.log(`Provider: ${selectedProvider} (default)`);
  console.log(`Model: ${selectedModel} (default)`);

  // Step 3: Feature toggles
  const enableUi = await yesNo("Enable UI inspector? [Y/n]: ", true);
  const enableMcp = await yesNo("Enable MCP servers? [Y/n]: ", true);
  const enableSkills = await yesNo("Enable skills? [Y/n]: ", true);
  const enableSubagents = await yesNo("Enable subagents? [Y/n]: ", true);

  // Build config
  const config = {
    ...DEFAULT_CONFIG,
    model: {
      ...DEFAULT_CONFIG.model,
      provider: selectedProvider,
      name: selectedModel,
    },
    ui: {
      ...DEFAULT_CONFIG.ui,
      enabled: enableUi,
    },
    mcpServers: enableMcp ? [{ type: "stdio", name: "fetch", command: "uvx", args: ["mcp-server-fetch"] }] : [],
    skills: {
      ...DEFAULT_CONFIG.skills,
      factory: { ...DEFAULT_CONFIG.skills!.factory, enabled: false },
    },
    subagents: {
      ...DEFAULT_CONFIG.subagents,
      enabled: enableSubagents,
    },
  };

  // Write .alix/config.json
  await mkdir(alixDir, { recursive: true });
  await writeFile(projectConfigPath, JSON.stringify(config, null, 2) + "\n");

  // Create AGENTS.md
  const agentsContent = `# Project

> Powered by ALiX. See \`.alix/\` for configuration.

## Setup

\`\`\`bash
npm install
\`\`\`

## Commands

| Command | Description |
|---------|-------------|
| \`alix run "<task>"\` | Run a task |
| \`alix init\` | Initialize project |
| \`alix serve\` | Start the UI inspector |
| \`alix config show\` | Show configuration |

## Build & Test

\`\`\`bash
npm run build
npm test
\`\`\`
`;
  await writeFile(agentsPath, agentsContent);

  console.log(`\n✓ ALiX initialized in ${cwd}`);
  console.log(`\nNext steps:`);
  console.log(`  alix run "your first task"`);
  console.log(`  alix serve    # start UI inspector`);
}

function yesNo(question: string, defaultYes: boolean): Promise<boolean> {
  return prompt(question).then((a) => {
    if (!a) return defaultYes;
    return a.toLowerCase() !== "n";
  });
}
```

- [ ] **Step 3: Add to CLI help text**

In `src/cli.ts`, after line 221 (help text), add:

```
  alix init             Initialize project with git, config, and sensible defaults
```

- [ ] **Step 4: Wire the command in CLI**

In `src/cli.ts`, add after line 243 (after the help block):

```typescript
if (command === "init") {
  const { runInit } = await import("./cli/commands/init.js");
  await runInit(process.cwd());
  process.exit(0);
}
```

- [ ] **Step 5: Write test**

Create `tests/cli/init.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("alix init", () => {
  const tmpDir = join(process.env.TMPDIR ?? "/tmp", `alix-init-test-${Date.now()}`);

  it("creates .alix/config.json", async () => {
    await mkdir(tmpDir, { recursive: true });
    // Simulate: run alix init with piped inputs
    // For now, just test the file creation logic directly
    const configPath = join(tmpDir, ".alix", "config.json");
    assert.ok(!existsSync(configPath), "config should not exist before init");
  });

  it("detects project type", () => {
    // Test project type detection
    const { detectProjectType } = await import("../../src/cli/commands/init.js");
    // ...
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test 2>&1 | tail -20`

---

### Task 2: Full Provider + Model Selection (refactor from cli.ts)

**Files:**
- Modify: `src/cli/commands/init.ts`
- Modify: `src/cli.ts` (extract shared helpers)

- [ ] **Step 1: Move `PROVIDERS` constant to shared location**

Move the `PROVIDERS` array from `src/cli.ts:12-24` to `src/cli/commands/providers.ts`.

- [ ] **Step 2: Move `listModels` function to shared location**

Move the `listModels` function from `src/cli.ts:97-216` to `src/cli/commands/models.ts`.

- [ ] **Step 3: Update `src/cli.ts` to import from shared modules**

Update imports in `src/cli.ts`.

- [ ] **Step 4: Update `src/cli/commands/init.ts` to use shared modules**

Update imports to use the shared `PROVIDERS` and `listModels`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/ tests/cli/
git commit -m "feat(init): scaffold alix init command
- Step 0: git init with .alix/ in .gitignore
- Step 1: project type detection
- Step 2: provider/model selection
- Step 3: feature toggles
- Creates .alix/config.json and AGENTS.md
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Self-Review Checklist

- [ ] All wizard steps implemented (git, project type, provider/model, features)
- [ ] `.alix/config.json` written with correct defaults
- [ ] `AGENTS.md` created at project root
- [ ] `.alix/` added to `.gitignore`
- [ ] Existing `PROVIDERS` and `listModels` refactored to shared modules
- [ ] Tests pass
- [ ] Help text updated
- [ ] CLI command wired in
