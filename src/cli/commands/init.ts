import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { prompt, yesNo } from "./prompt.js";

const PROJECT_TYPE_FILES: [string, string][] = [
  ["package.json", "Node.js"],
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
  ["pyproject.toml", "Python"],
  ["setup.py", "Python"],
  ["Makefile", "Generic/C"],
  ["pom.xml", "Java"],
];

export interface InitDependencies {
  yesNo: (question: string, defaultYes?: boolean) => Promise<boolean>;
  prompt: (question: string) => Promise<string>;
  cwd: string;
}

export async function runInit(cwd: string, deps?: Partial<InitDependencies>): Promise<void> {
  const {
    yesNo: yesNoFn = yesNo,
    prompt: promptFn = prompt,
    cwd: workDir = cwd,
  } = deps ?? {};

  const alixDir = join(workDir, ".alix");
  const gitignorePath = join(workDir, ".gitignore");
  const agentsPath = join(workDir, "AGENTS.md");
  const projectConfigPath = join(alixDir, "config.json");

  // Step 0: Git check
  const isGitRepo = existsSync(join(workDir, ".git"));
  if (!isGitRepo) {
    const initGit = await yesNoFn("Initialize git repository? [Y/n]: ", true);
    if (initGit) {
      try {
        execSync("git init --initial-branch=main", { cwd: workDir, stdio: "inherit" });
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

  // Step 2: Provider + Model (defaults for MVP)
  const selectedProvider = "ollama";
  const selectedModel = "qwen2.5-coder:7b";
  console.log(`Provider: ${selectedProvider} (default)`);
  console.log(`Model: ${selectedModel} (default)`);

  // Step 3: Feature toggles
  const enableUi = await yesNoFn("Enable UI inspector? [Y/n]: ", true);
  const enableMcp = await yesNoFn("Enable MCP servers? [Y/n]: ", true);
  const enableSkills = await yesNoFn("Enable skills? [Y/n]: ", true);
  const enableSubagents = await yesNoFn("Enable subagents? [Y/n]: ", true);

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
  const agentsContent = `# ALiX Project

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

  console.log(`\n✓ ALiX initialized in ${workDir}`);
  console.log(`\nNext steps:`);
  console.log(`  alix run "your first task"`);
  console.log(`  alix serve    # start UI inspector`);
}