import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../config/defaults.js";

const PROJECT_TYPE_FILES: [string, string][] = [
  ["package.json", "Node.js"],
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
  ["pyproject.toml", "Python"],
  ["setup.py", "Python"],
  ["Makefile", "Generic/C"],
  ["pom.xml", "Java"],
];

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
  return { provider: "ollama", model: "qwen2.5-coder:7b" };
}

export interface InitDependencies {
  cwd: string;
}

export async function runInit(cwd: string, deps?: Partial<InitDependencies>): Promise<void> {
  const {
    cwd: workDir = cwd,
  } = deps ?? {};

  const alixDir = join(workDir, ".alix");
  const gitignorePath = join(workDir, ".gitignore");
  const agentsPath = join(workDir, "AGENTS.md");
  const projectConfigPath = join(alixDir, "config.json");

  // Step 0: Git check (auto-init if not present)
  const isGitRepo = existsSync(join(workDir, ".git"));
  if (!isGitRepo) {
    try {
      execSync("git init --initial-branch=main", { cwd: workDir, stdio: "inherit" });
      console.log("Git initialized");
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

  // Step 1: Project type detection
  let projectType = "Generic";
  for (const [file, type] of PROJECT_TYPE_FILES) {
    if (existsSync(join(workDir, file))) {
      projectType = type;
      break;
    }
  }
  console.log(`Detected: ${projectType} project`);

  // Step 2: Provider + Model (auto-detect from environment)
  const { provider: selectedProvider, model: selectedModel } = detectProvider();
  console.log(`Using: ${selectedProvider} / ${selectedModel} (auto-detected)`);

  // Step 3: Feature toggles (all enabled by default)
  const enableUi = true;
  const enableMcp = true;
  const enableSkills = true;
  const enableSubagents = true;

  // Build config
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    model: {
      ...DEFAULT_CONFIG.model,
      provider: selectedProvider as any,
      name: selectedModel,
    },
    ui: {
      ...DEFAULT_CONFIG.ui,
      enabled: enableUi,
    },
    mcpServers: enableMcp ? [{ type: "stdio" as const, name: "fetch", command: "uvx", args: ["mcp-server-fetch"] }] : [],
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

  console.log(`\n✓ ALiX initialized in ${workDir}`);
  console.log(`\nNext steps:`);
  console.log(`  alix run "your first task"`);
  console.log(`  alix serve    # start UI inspector`);
}